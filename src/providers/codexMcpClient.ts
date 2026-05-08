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

      const inputTokens = Math.ceil(opts.prompt.length / 4)
      const outputTokens = Math.ceil(text.length / 4)

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
