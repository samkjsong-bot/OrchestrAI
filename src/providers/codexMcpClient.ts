// src/providers/codexMcpClient.ts
// Starts the Codex CLI as an MCP stdio server and calls its `codex` tool.

import * as path from 'path'
import * as fs from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { log } from '../util/log'

const CODEX_EXT_GLOB = 'openai.chatgpt-'

export interface CodexMcpRunOptions {
  prompt: string
  cwd: string
  baseInstructions?: string
  developerInstructions?: string
  model?: string
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  onProgress?: (text: string) => void
  abortSignal?: AbortSignal
}

export interface CodexMcpResult {
  content: string
  inputTokens: number
  outputTokens: number
}

function findCodexExe(): string | null {
  const userHome = process.env.USERPROFILE || process.env.HOME || ''
  const extDir = path.join(userHome, '.vscode', 'extensions')
  if (!fs.existsSync(extDir)) return null

  let candidates: string[] = []
  try {
    candidates = fs.readdirSync(extDir).filter(d => d.startsWith(CODEX_EXT_GLOB))
  } catch {
    return null
  }
  if (candidates.length === 0) return null

  candidates.sort()
  const latest = candidates[candidates.length - 1]
  const exeName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const platforms = process.platform === 'win32'
    ? ['windows-x86_64', 'windows-aarch64']
    : process.platform === 'darwin'
      ? ['darwin-aarch64', 'darwin-x86_64']
      : ['linux-x86_64', 'linux-aarch64']

  for (const platform of platforms) {
    const p = path.join(extDir, latest, 'bin', platform, exeName)
    if (fs.existsSync(p)) return p
  }
  return null
}

export class CodexMcpClient {
  private client?: Client
  private transport?: StdioClientTransport
  private starting?: Promise<void>
  private codexPath: string | null = null
  private toolName = 'codex'

  isAvailable(): boolean {
    if (!this.codexPath) this.codexPath = findCodexExe()
    return !!this.codexPath
  }

  getCodexPath(): string | null {
    if (!this.codexPath) this.codexPath = findCodexExe()
    return this.codexPath
  }

  private async ensureStarted(): Promise<void> {
    if (this.client) return
    if (this.starting) return this.starting
    this.starting = this._start()
    try { await this.starting } finally { this.starting = undefined }
  }

  private async _start(): Promise<void> {
    const exe = this.getCodexPath()
    if (!exe) throw new Error('Codex CLI binary not found. Install the OpenAI Codex/ChatGPT VSCode extension.')

    log.info('codex-mcp', `spawn ${exe} mcp-server`)
    const transport = new StdioClientTransport({
      command: exe,
      args: ['mcp-server'],
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      log.warn('codex-mcp', 'stderr:', chunk.toString('utf8').slice(0, 500))
    })
    transport.onclose = () => {
      log.info('codex-mcp', 'process closed')
      this.client = undefined
      this.transport = undefined
    }
    transport.onerror = (err) => log.error('codex-mcp', 'transport error:', err)

    const client = new Client({ name: 'orchestrai', version: '0.1.0' }, { capabilities: {} })
    await client.connect(transport)

    const server = client.getServerVersion()
    log.info('codex-mcp', `initialized, server=${server?.name} v${server?.version}`)

    const tools = await client.listTools()
    const codexTool = tools.tools.find(t => t.name === 'codex') ?? tools.tools[0]
    if (!codexTool) throw new Error('Codex MCP server has no tools')
    this.toolName = codexTool.name
    log.info('codex-mcp', `tool=${this.toolName}, tools=${tools.tools.map(t => t.name).join(', ')}`)

    this.client = client
    this.transport = transport
  }

  async run(opts: CodexMcpRunOptions): Promise<CodexMcpResult> {
    await this.ensureStarted()
    if (!this.client) throw new Error('codex mcp-server not started')

    const args: any = {
      prompt: opts.prompt,
      cwd: opts.cwd,
      'approval-policy': opts.approvalPolicy ?? 'never',
    }
    if (opts.baseInstructions) args['base-instructions'] = opts.baseInstructions
    if (opts.developerInstructions) args['developer-instructions'] = opts.developerInstructions
    if (opts.model) args.model = opts.model

    let aborted = false
    const onAbort = () => { aborted = true }
    opts.abortSignal?.addEventListener('abort', onAbort)

    try {
      const result = await this.client.callTool({
        name: this.toolName,
        arguments: args,
      }, undefined, {
        onprogress: (progress) => {
          const message = progress.message || `progress ${progress.progress}${progress.total ? `/${progress.total}` : ''}`
          log.info('codex-mcp', message)
        },
        resetTimeoutOnProgress: true,
      })
      if (aborted) throw new Error('aborted')

      const content = 'content' in result && Array.isArray(result.content) ? result.content : []
      let text = ''
      for (const c of content) {
        if (c.type === 'text' && typeof c.text === 'string') text += c.text
      }
      if (opts.onProgress && text) opts.onProgress(text)

      // codex.exe mcp-server 가 usage 메타를 노출하는지 확인 — MCP 표준의 _meta + structuredContent + 흔한 위치들 다 봄.
      // 발견하면 실측치 사용, 못 찾으면 한국어 인지 휴리스틱 (한글 1tok/char, 그 외 4char/tok).
      const usageMeta = extractCodexUsage(result)
      const inputTokens = usageMeta?.input ?? estimateMixedTokens(opts.prompt)
      const outputTokens = usageMeta?.output ?? estimateMixedTokens(text)
      if (usageMeta) {
        log.info('codex-mcp', `usage from MCP: in=${usageMeta.input}, out=${usageMeta.output}`)
      } else {
        log.info('codex-mcp', `usage estimated (no MCP meta): in=${inputTokens}, out=${outputTokens}`)
      }

      if ('isError' in result && result.isError) {
        throw new Error(`Codex error: ${text.slice(0, 300)}`)
      }
      return { content: text, inputTokens, outputTokens }
    } finally {
      opts.abortSignal?.removeEventListener('abort', onAbort)
    }
  }

  dispose() {
    const transport = this.transport
    if (transport) void transport.close().catch(err => log.warn('codex-mcp', 'close failed:', err))
    this.client = undefined
    this.transport = undefined
  }
}

let _instance: CodexMcpClient | null = null
export function getCodexMcpClient(): CodexMcpClient {
  if (!_instance) _instance = new CodexMcpClient()
  return _instance
}

export function disposeCodexMcpClient() {
  if (_instance) { _instance.dispose(); _instance = null }
}

// codex.exe mcp-server 의 result 구조 — usage 메타가 표준 위치에 있을 수 있는 후보들 다 봄.
// 발견 시 {input, output} 반환, 못 찾으면 null. 추후 codex 가 노출 위치 바꾸면 여기만 수정.
function extractCodexUsage(result: unknown): { input: number; output: number } | null {
  const r = result as any
  if (!r || typeof r !== 'object') return null
  // 1) result._meta?.usage / result.meta?.usage (MCP 표준 _meta 위치)
  const metaList = [r._meta, r.meta, r.structuredContent?.usage, r.structuredContent?._meta?.usage]
  for (const m of metaList) {
    if (m && typeof m === 'object') {
      // 다양한 네이밍 호환: {input_tokens, output_tokens} / {prompt_tokens, completion_tokens} / {input, output}
      const inp = m.input_tokens ?? m.inputTokens ?? m.prompt_tokens ?? m.promptTokens ?? m.input
      const out = m.output_tokens ?? m.outputTokens ?? m.completion_tokens ?? m.completionTokens ?? m.output
      if (typeof inp === 'number' && typeof out === 'number') return { input: inp, output: out }
    }
  }
  // 2) result.usage 자체에 박혀 있을 수도 있음 (codex 가 OpenAI 스타일로 잘못 넣는 경우)
  if (r.usage && typeof r.usage === 'object') {
    const u = r.usage
    const inp = u.input_tokens ?? u.prompt_tokens ?? u.input
    const out = u.output_tokens ?? u.completion_tokens ?? u.output
    if (typeof inp === 'number' && typeof out === 'number') return { input: inp, output: out }
  }
  return null
}

// 한국어 인지 토큰 추정 — 한글 1tok/char, 그 외 4char/tok.
// 영어 prompt 면 기존과 동일, 한국어가 섞이면 더 정확해짐.
function estimateMixedTokens(text: string | undefined | null): number {
  if (!text) return 0
  const korean = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - korean
  return Math.ceil(korean + other / 4)
}
