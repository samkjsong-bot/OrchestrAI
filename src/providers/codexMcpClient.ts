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
  cacheReadInputTokens?: number      // codex MCP 또는 OpenAI server 가 노출한 prompt cache hit
  cacheCreationInputTokens?: number  // 새 cache 생성 비용 (있을 때만)
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

    // 호출 중 progress notifications 도 token 정보 박힐 수 있음 (codex 가 stream 도중 메타 발행 가능).
    const progressUsageHits: Array<{ input: number; output: number; cacheRead?: number; cacheCreation?: number; src: string }> = []
    try {
      const result = await this.client.callTool({
        name: this.toolName,
        arguments: args,
      }, undefined, {
        onprogress: (progress) => {
          const message = progress.message || `progress ${progress.progress}${progress.total ? `/${progress.total}` : ''}`
          log.info('codex-mcp', message)
          // 첫 호출 시 progress 전체 한 번 dump — codex 가 어디에 토큰 박는지 정찰용.
          if (!_loggedFirstProgress) {
            _loggedFirstProgress = true
            try {
              log.info('codex-mcp-debug', `first progress raw: ${safeStringify(progress).slice(0, 1500)}`)
            } catch {}
          }
          // progress 안에 토큰 정보 들어있나? 재귀 탐색.
          const hit = deepFindUsage(progress)
          if (hit) progressUsageHits.push({ ...hit, src: 'progress' })
        },
        resetTimeoutOnProgress: true,
      })
      if (aborted) throw new Error('aborted')

      // 첫 호출 시 result 전체 dump — codex 가 토큰 노출하는 위치 정찰. 추후 사용자가 로그 보고 알려주면 정확 추출 가능.
      if (!_loggedFirstResult) {
        _loggedFirstResult = true
        try {
          log.info('codex-mcp-debug', `first result raw: ${safeStringify(result).slice(0, 2000)}`)
        } catch {}
      }

      const content = 'content' in result && Array.isArray(result.content) ? result.content : []
      let text = ''
      for (const c of content) {
        if (c.type === 'text' && typeof c.text === 'string') text += c.text
      }
      if (opts.onProgress && text) opts.onProgress(text)

      // 1) 표준 후보 위치 확인 (_meta / meta / structuredContent.usage / usage)
      // 2) 그래도 못 찾으면 result 전체에서 input_tokens 등 키 재귀 탐색 (가장 적극적)
      // 3) 둘 다 없으면 progress notification 에서 본 토큰
      // 4) 다 없으면 한국어 인지 휴리스틱 fallback
      let usageMeta = extractCodexUsage(result) ?? deepFindUsage(result)
      if (!usageMeta && progressUsageHits.length > 0) {
        // 마지막 progress 가 가장 최신 값 — codex 가 stream 끝나며 final usage 보낼 가능성.
        usageMeta = progressUsageHits[progressUsageHits.length - 1]
      }
      const inputTokens = usageMeta?.input ?? estimateMixedTokens(opts.prompt)
      const outputTokens = usageMeta?.output ?? estimateMixedTokens(text)
      const cacheRead = usageMeta?.cacheRead ?? 0
      const cacheCreation = usageMeta?.cacheCreation ?? 0
      if (usageMeta) {
        log.info('codex-mcp', `usage from MCP (${(usageMeta as any).src ?? 'result'}): in=${inputTokens}, out=${outputTokens}${cacheRead ? `, cache_read=${cacheRead}` : ''}${cacheCreation ? `, cache_write=${cacheCreation}` : ''}`)
      } else {
        log.info('codex-mcp', `usage estimated (no MCP meta): in=${inputTokens}, out=${outputTokens}`)
      }

      if ('isError' in result && result.isError) {
        throw new Error(`Codex error: ${text.slice(0, 300)}`)
      }
      return { content: text, inputTokens, outputTokens, cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheCreation }
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

// codex MCP 가 토큰 어디 박는지 모르므로 첫 호출 한 번만 raw dump — 사용자가 OUTPUT 보고 알려주면 정확 추출 가능.
let _loggedFirstResult = false
let _loggedFirstProgress = false

function safeStringify(o: unknown): string {
  try { return JSON.stringify(o, (_k, v) => typeof v === 'bigint' ? String(v) : v) } catch { return String(o) }
}

// MCP 표준의 알려진 후보 위치 — 가장 흔한 곳들.
// 발견 시 {input, output} 반환, 못 찾으면 null. 추후 codex 가 노출 위치 바꾸면 여기만 수정.
function extractCodexUsage(result: unknown): { input: number; output: number; cacheRead?: number; cacheCreation?: number } | null {
  const r = result as any
  if (!r || typeof r !== 'object') return null
  // 1) result._meta?.usage / result.meta?.usage (MCP 표준 _meta 위치)
  const metaList = [r._meta, r.meta, r.structuredContent?.usage, r.structuredContent?._meta?.usage, r._meta?.usage]
  for (const m of metaList) {
    const hit = readUsageBag(m)
    if (hit) return hit
  }
  // 2) result.usage 자체에 박혀 있을 수도 있음 (codex 가 OpenAI 스타일로 잘못 넣는 경우)
  const direct = readUsageBag(r.usage) ?? readUsageBag(r.structuredContent)
  if (direct) return direct
  return null
}

// 객체 하나가 usage 형태인지 검사 — input/output 후보 키들 + cache 후보.
function readUsageBag(m: any): { input: number; output: number; cacheRead?: number; cacheCreation?: number } | null {
  if (!m || typeof m !== 'object') return null
  const inp = m.input_tokens ?? m.inputTokens ?? m.prompt_tokens ?? m.promptTokens ?? m.input
  const out = m.output_tokens ?? m.outputTokens ?? m.completion_tokens ?? m.completionTokens ?? m.output
  if (typeof inp !== 'number' || typeof out !== 'number') return null
  // cache 후보 키 (OpenAI / Anthropic 양쪽 네이밍)
  const cacheRead = m.cache_read_input_tokens ?? m.cached_input_tokens ?? m.cacheReadInputTokens
    ?? m.prompt_tokens_details?.cached_tokens  // OpenAI 형식
  const cacheCreation = m.cache_creation_input_tokens ?? m.cacheCreationInputTokens
  return {
    input: inp, output: out,
    cacheRead: typeof cacheRead === 'number' ? cacheRead : undefined,
    cacheCreation: typeof cacheCreation === 'number' ? cacheCreation : undefined,
  }
}

// result 전체를 재귀로 훑어 usage-shape 객체 찾기 (deeply nested 일 수 있음).
// 최대 6 depth — codex 가 어디든 박아도 잡힘. 첫 hit 반환.
function deepFindUsage(o: unknown, depth = 0): { input: number; output: number; cacheRead?: number; cacheCreation?: number } | null {
  if (!o || typeof o !== 'object' || depth > 6) return null
  const direct = readUsageBag(o)
  if (direct) return direct
  if (Array.isArray(o)) {
    for (const item of o) {
      const hit = deepFindUsage(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  for (const v of Object.values(o as Record<string, unknown>)) {
    const hit = deepFindUsage(v, depth + 1)
    if (hit) return hit
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
