// src/providers/codexMcpClient.ts
// codex.exe를 stdio MCP server로 spawn해서 단순 JSON-RPC 통신.
// codex CLI가 자체적으로 OAuth, tool 호출, path, sandbox 다 처리 → 우리는 prompt 주고 결과 받기만.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { log } from '../util/log'

const CODEX_EXT_GLOB = 'openai.chatgpt-'

interface PendingCall {
  resolve: (result: any) => void
  reject: (err: Error) => void
}

export interface CodexMcpRunOptions {
  prompt: string
  cwd: string
  baseInstructions?: string
  developerInstructions?: string
  model?: string             // 'gpt-5.2', 'gpt-5.2-codex' 등. 안 주면 codex default
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never'
  onProgress?: (text: string) => void
  abortSignal?: AbortSignal
}

export interface CodexMcpResult {
  content: string
  inputTokens: number
  outputTokens: number
}

// 설치된 Codex 확장에서 codex.exe 경로 자동 발견
function findCodexExe(): string | null {
  const userHome = process.env.USERPROFILE || process.env.HOME || ''
  const extDir = path.join(userHome, '.vscode', 'extensions')
  if (!fs.existsSync(extDir)) return null
  let candidates: string[] = []
  try {
    candidates = fs.readdirSync(extDir).filter(d => d.startsWith(CODEX_EXT_GLOB))
  } catch { return null }
  if (candidates.length === 0) return null
  // 가장 최신 버전 선택 (이름에 버전 들어 있으니 sort 마지막)
  candidates.sort()
  const latest = candidates[candidates.length - 1]
  // platform별 binary
  const platform = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-aarch64' : 'linux-x86_64'
  const exeName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidatePath = path.join(extDir, latest, 'bin', platform, exeName)
  if (fs.existsSync(candidatePath)) return candidatePath
  // fallback: 일반 darwin/linux 폴더 이름 (확장 버전마다 다를 수 있음)
  for (const arch of ['darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'linux-aarch64']) {
    const p = path.join(extDir, latest, 'bin', arch, 'codex')
    if (fs.existsSync(p)) return p
  }
  return null
}

export class CodexMcpClient {
  private proc?: ChildProcessWithoutNullStreams
  private buf = ''
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private starting?: Promise<void>
  private codexPath: string | null = null

  isAvailable(): boolean {
    if (!this.codexPath) this.codexPath = findCodexExe()
    return !!this.codexPath
  }

  getCodexPath(): string | null {
    if (!this.codexPath) this.codexPath = findCodexExe()
    return this.codexPath
  }

  private async ensureStarted(): Promise<void> {
    if (this.proc && !this.proc.killed) return
    if (this.starting) return this.starting
    this.starting = this._start()
    try { await this.starting } finally { this.starting = undefined }
  }

  private async _start(): Promise<void> {
    const exe = this.getCodexPath()
    if (!exe) throw new Error('Codex CLI 바이너리를 찾을 수 없습니다. Codex VSCode 확장 설치 필요.')
    log.info('codex-mcp', `spawn ${exe} mcp-server`)
    const proc = spawn(exe, ['mcp-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc

    proc.stdout.on('data', (chunk) => this._onStdout(chunk.toString('utf8')))
    proc.stderr.on('data', (chunk) => log.warn('codex-mcp', 'stderr:', chunk.toString('utf8').slice(0, 500)))
    proc.on('exit', (code) => {
      log.info('codex-mcp', `process exited code=${code}`)
      this.proc = undefined
      // 모든 pending reject
      for (const [, p] of this.pending) p.reject(new Error('codex mcp-server exited'))
      this.pending.clear()
    })
    proc.on('error', (err) => {
      log.error('codex-mcp', 'spawn error:', err)
      this.proc = undefined
    })

    // MCP handshake
    const initResult = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { roots: {}, sampling: {} },
      clientInfo: { name: 'orchestrai', version: '0.1.0' },
    })
    log.info('codex-mcp', `initialized, server=${initResult?.serverInfo?.name} v${initResult?.serverInfo?.version}`)
    this._notify('notifications/initialized')
  }

  private _onStdout(data: string) {
    this.buf += data
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let msg: any
      try { msg = JSON.parse(line) } catch { continue }
      // response
      if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
        const pending = this.pending.get(msg.id)
        if (pending) {
          this.pending.delete(msg.id)
          if (msg.error) pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
          else pending.resolve(msg.result)
        }
        continue
      }
      // notification (progress 등)
      if (msg.method === 'notifications/progress') {
        // 진행 상황 노출은 호출자가 처리
        // 별도 dispatcher 둘 수 있지만 일단 로그만
        log.info('codex-mcp', `progress: ${JSON.stringify(msg.params).slice(0, 200)}`)
      } else if (msg.method) {
        log.info('codex-mcp', `notification: ${msg.method}`)
      }
    }
  }

  private _send(obj: any) {
    if (!this.proc) throw new Error('codex mcp-server not started')
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  private _request(method: string, params?: any): Promise<any> {
    const id = this.nextId++
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this._send({ jsonrpc: '2.0', id, method, params: params ?? {} })
    return promise
  }

  private _notify(method: string, params?: any) {
    this._send({ jsonrpc: '2.0', method, params: params ?? {} })
  }

  // codex tool 호출 — prompt 주고 결과 받기
  async run(opts: CodexMcpRunOptions): Promise<CodexMcpResult> {
    await this.ensureStarted()

    const args: any = {
      prompt: opts.prompt,
      cwd: opts.cwd,
      'approval-policy': opts.approvalPolicy ?? 'never',
    }
    if (opts.baseInstructions) args['base-instructions'] = opts.baseInstructions
    if (opts.developerInstructions) args['developer-instructions'] = opts.developerInstructions
    if (opts.model) args.model = opts.model

    // abort signal 처리
    let aborted = false
    const onAbort = () => { aborted = true }
    opts.abortSignal?.addEventListener('abort', onAbort)

    try {
      const result = await this._request('tools/call', {
        name: 'codex',
        arguments: args,
      })
      if (aborted) throw new Error('aborted')

      // MCP CallToolResult: { content: [{type: 'text', text}], isError? }
      const content: any[] = result?.content ?? []
      let text = ''
      for (const c of content) {
        if (c.type === 'text' && typeof c.text === 'string') text += c.text
      }
      // progress callback이 있으면 마지막에 한 번에 stream (batch — 향후 progress notification 처리로 개선)
      if (opts.onProgress && text) opts.onProgress(text)

      // codex는 usage 메타 안 줌 — 토큰 추정 (대충 4 char/token)
      const inputTokens = Math.ceil(opts.prompt.length / 4)
      const outputTokens = Math.ceil(text.length / 4)

      if (result?.isError) {
        throw new Error(`Codex error: ${text.slice(0, 300)}`)
      }
      return { content: text, inputTokens, outputTokens }
    } finally {
      opts.abortSignal?.removeEventListener('abort', onAbort)
    }
  }

  dispose() {
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill() } catch {}
    }
    this.proc = undefined
    for (const [, p] of this.pending) p.reject(new Error('disposed'))
    this.pending.clear()
  }
}

// 싱글톤 — extension 전체에서 하나만 (codex.exe 한 번만 spawn)
let _instance: CodexMcpClient | null = null
export function getCodexMcpClient(): CodexMcpClient {
  if (!_instance) _instance = new CodexMcpClient()
  return _instance
}
export function disposeCodexMcpClient() {
  if (_instance) { _instance.dispose(); _instance = null }
}
