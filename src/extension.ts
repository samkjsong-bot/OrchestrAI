// src/extension.ts
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Orchestrator, inferEffort, parseAllMentions } from './router/orchestrator'
import { callClaude, setClaudeFallbackNotifier } from './providers/claudeProvider'
import { callCodex, setCodexFallbackNotifier } from './providers/codexProvider'
import { getCodexMcpClient, disposeCodexMcpClient } from './providers/codexMcpClient'
import { OrchestrAICompletionProvider } from './providers/inlineCompletion'
import { callGemini, setGeminiFallbackNotifier, setGeminiApiKey } from './providers/geminiProvider'
import { ChatMessage, RouterMode, RoutingDecision, Model, Effort, ChangeSummary } from './router/types'
import { AuthStorage } from './auth/storage'
import { ClaudeAuth } from './auth/claudeAuth'
import { CodexAuth } from './auth/codexAuth'
import { GeminiAuth } from './auth/geminiAuth'
import { UsageTracker, PLAN_INFO } from './util/usage'
import { judgeTurn } from './router/judge'
import { log } from './util/log'
import { buildTaggedHistory, setContextWindowPreset } from './util/history'
import { buildIndex, loadIndex, reindexFile, type CodebaseIndex } from './util/codebaseIndex'
import { retrieve } from './util/retriever'
import { planBoomerang } from './util/boomerang'
import { fetchAgentFromUrl, loadAgentStore, addAgent, removeAgent, setActiveAgent, getActiveAgent } from './util/agentMarketplace'
import { isQuotaError, summarizeQuotaError } from './util/quota'
import { TelegramBridge } from './telegram/bridge'
import { TelegramClient } from './telegram/client'
import { buildTeamMcpServer } from './team/teamMcp'
import { shouldCompact, compactMessages, CompactionState } from './util/compaction'

// ── 영속 저장 ─────────────────────────────────────────────
// 폴더별로 별도 파일에 저장 — Claude Code와 동일한 방식.
// workspaceState는 사이즈 제한·비동기 flush 이슈 있어서 fs로 직접 씀.
const GLOBAL_CHAT_STATE_KEY = 'orchestrai.chat.__global__'

function chatStateKey(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) return GLOBAL_CHAT_STATE_KEY
  // 정규화 — 같은 폴더라도 URI 다르게 들어오면 hash 어긋나는 거 방지
  // - Windows는 case-insensitive — 소문자 통일
  // - trailing slash ?쒓굅
  let key = folder.uri.fsPath
  if (process.platform === 'win32') key = key.toLowerCase()
  key = key.replace(/[\\/]+$/, '')
  return `orchestrai.chat.${key}`
}

// Multi-IDE sync: setting으로 sync 폴더 지정 시 그쪽 사용
function getStorageRoot(context: vscode.ExtensionContext): string {
  const syncDir = vscode.workspace.getConfiguration('orchestrai').get<string>('syncDir')
  if (syncDir && syncDir.trim()) {
    const expanded = syncDir.replace(/^~/, process.env.USERPROFILE || process.env.HOME || '~')
    try { fs.mkdirSync(expanded, { recursive: true }) } catch {}
    if (fs.existsSync(expanded)) return expanded
  }
  return context.globalStorageUri.fsPath
}

function chatStateFilePath(context: vscode.ExtensionContext): string {
  const key = chatStateKey()
  const hash = require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16)
  const dir = path.join(getStorageRoot(context), 'chats')
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return path.join(dir, `${hash}.json`)
}

interface ChatStorage {
  messages: ChatMessage[]
  compaction?: CompactionState
  workspaceKey?: string
  workspacePath?: string
  updatedAt?: number
}

function readChatFile(filePath: string): ChatStorage | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { messages: parsed }
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      compaction: parsed.compaction,
    }
  } catch {
    return null
  }
}

function loadChatStorage(context: vscode.ExtensionContext): ChatStorage {
  const file = chatStateFilePath(context)
  // 1) 현재 키 파일 우선
  if (fs.existsSync(file)) {
    const loaded = readChatFile(file)
    if (loaded) {
      log.info('persist', `loaded ${loaded.messages.length} messages from ${file}`)
      return loaded
    }
  }
  // 2) 옛 workspaceState 마이그레이션
  try {
    const old = context.workspaceState.get<ChatMessage[]>(chatStateKey())
    if (old && old.length > 0) {
      const storage: ChatStorage = { messages: old }
      fs.writeFileSync(file, JSON.stringify(storage))
      log.info('persist', `migrated ${old.length} from workspaceState ??${file}`)
      return storage
    }
  } catch {}
  // Workspace-scoped history: never pull another folder's latest chat automatically.
  return { messages: [] }
}

function saveChatStorage(context: vscode.ExtensionContext, storage: ChatStorage): void {
  try {
    const file = chatStateFilePath(context)
    const folder = vscode.workspace.workspaceFolders?.[0]
    const next: ChatStorage = {
      ...storage,
      workspaceKey: chatStateKey(),
      workspacePath: folder?.uri.fsPath,
      updatedAt: Date.now(),
    }
    fs.writeFileSync(file, JSON.stringify(next))
    log.info('persist', `saved ${storage.messages.length} messages, compaction=${storage.compaction ? 'yes' : 'no'} ??${file}`)
  } catch (err) {
    log.error('persist', 'save failed:', err)
  }
}

// ── 컨텍스트 수집 ─────────────────────────────────
const MAX_FILE_CHARS = 80000   // 큰 파일도 통째로 컨텍스트 (옛 8k → 80k, ~2500줄)

interface FileContext {
  fileName: string
  language: string
  content: string
  selectedText?: string
  cursorLine?: number
  isTruncated: boolean
}

type CodexToolName = 'list_files' | 'read_file' | 'write_file' | 'replace_in_file' | 'mcp'

interface CodexToolCall {
  tool: CodexToolName
  path?: string
  content?: string
  oldText?: string
  newText?: string
  recursive?: boolean
  server?: string
  name?: string
  args?: Record<string, unknown>
}

interface ImageAttachment {
  name: string
  mime: string
  dataUrl: string
}

type PermissionMode = 'ask' | 'auto-edit' | 'plan' | 'smart-auto'

interface FileSnapshot {
  path: string
  before: string | null
}

interface ChangedFile {
  turnId: string
  path: string
  status: 'added' | 'modified' | 'deleted'
  additions: number
  deletions: number
  preview: Array<{
    type: 'add' | 'del' | 'ctx'
    oldLine?: number
    newLine?: number
    text: string
  }>
}

interface PendingApproval {
  id: string
  title: string
  detail: string
  resolve: (approved: boolean) => void
}

interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

interface McpToolInfo {
  server: string
  name: string
  description?: string
}

// 무한 루프 안전장치 — 정상 작업은 절대 도달 못 하는 수. Claude Code CLI와 동등.
const MAX_CODEX_TOOL_TURNS = 100
const MAX_TOOL_READ_CHARS = 40000
const MAX_TOOL_LIST_ITEMS = 250

// ORCHESTRAI.md 또는 .orchestrai/rules.md 자동 로드 — 프로젝트별 룰을 모든 모델에 주입.
// 우선순위: ORCHESTRAI.md (root) > .orchestrai/rules.md > .orchestrai-rules.md
// 5분 캐시 (매 호출마다 디스크 읽기 부담 ↓), 파일 mtime 변경 시 자동 갱신
let _rulesCache: { content: string; mtime: number; checked: number } | null = null
function loadProjectRules(): string {
  const root = getWorkspaceRoot()
  if (!root) return ''
  const candidates = ['ORCHESTRAI.md', '.orchestrai/rules.md', '.orchestrai-rules.md']
  let target: string | null = null
  let mtime = 0
  for (const c of candidates) {
    const full = path.join(root, c)
    try {
      const st = fs.statSync(full)
      if (st.isFile()) { target = full; mtime = st.mtimeMs; break }
    } catch {}
  }
  if (!target) return ''
  const now = Date.now()
  if (_rulesCache && _rulesCache.mtime === mtime && (now - _rulesCache.checked) < 5 * 60_000) {
    return _rulesCache.content
  }
  try {
    const content = fs.readFileSync(target, 'utf8').trim()
    // 너무 길면 잘라 (모든 turn 의 system prompt 에 들어가니 토큰 비용 ↑)
    const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n\n[...truncated, file > 8KB]' : content
    _rulesCache = { content: truncated, mtime, checked: now }
    return truncated
  } catch {
    return ''
  }
}

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
}

function resolveWorkspacePath(relPath?: string): string {
  const root = getWorkspaceRoot()
  if (!root) throw new Error('워크스페이스 폴더가 열려 있지 않습니다.')

  let cleaned = (relPath ?? '.').replace(/\\/g, '/').replace(/^\/+/, '')

  // 모델이 workspace 폴더명을 prefix로 또 붙이는 케이스 자동 strip
  // (예: workspace=orchestrai 인데 Codex가 'orchestrai/test/foo.md' 라고 생성)
  const rootBase = path.basename(root).toLowerCase()
  const firstSeg = cleaned.split('/')[0]?.toLowerCase()
  if (firstSeg && firstSeg === rootBase) {
    const stripped = cleaned.split('/').slice(1).join('/')
    if (stripped) cleaned = stripped
  }

  const resolved = path.resolve(root, cleaned)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`워크스페이스 밖 경로에는 접근할 수 없습니다: ${relPath}`)
  }
  return resolved
}

function expandMcpValue(value: string): string {
  const root = getWorkspaceRoot() ?? ''
  return value
    .replace(/\$\{workspaceFolder\}/g, root)
    .replace(/\$\{cwd\}/g, root)
}

function expandMcpConfig(cfg: McpServerConfig): McpServerConfig {
  return {
    command: expandMcpValue(cfg.command),
    args: cfg.args?.map(expandMcpValue),
    env: cfg.env
      ? Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, expandMcpValue(v)]))
      : undefined,
    cwd: cfg.cwd ? expandMcpValue(cfg.cwd) : undefined,
  }
}

const VALID_TOOLS: readonly CodexToolName[] = [
  'list_files', 'read_file', 'write_file', 'replace_in_file', 'mcp',
]

function tryParseTool(raw: string): CodexToolCall | null {
  try {
    const parsed = JSON.parse(raw) as CodexToolCall
    if (parsed && VALID_TOOLS.includes(parsed.tool)) return parsed
  } catch {}
  return null
}

// Format tool activity for the webview without spending model tokens on UI chrome.
function fileLinkMd(p?: string): string {
  if (!p) return '?'
  const base = p.split(/[\\/]+/).filter(Boolean).pop() || p
  return `[${base}](orchestrai-open:${encodeURIComponent(p)})`
}
function formatCodexToolCall(call: CodexToolCall): string {
  switch (call.tool) {
    case 'list_files':
      return `list_files(${call.path ?? '.'}${call.recursive === false ? '' : ', recursive'})`
    case 'read_file':
      return `read_file(${fileLinkMd(call.path)})`
    case 'write_file':
      return `write_file(${fileLinkMd(call.path)} · ${call.content?.length ?? 0} chars)`
    case 'replace_in_file':
      return `replace_in_file(${fileLinkMd(call.path)})`
    case 'mcp':
      return `mcp(${call.server ?? '?'}.${call.name ?? '?'})`
    default:
      return `${(call as any).tool ?? 'tool'}(?)`
  }
}

// 모든 fenced block (orchestrai-tool / json)과 첫 JSON 객체를 잡아 첫 유효한 거 반환
function parseCodexToolCall(text: string): CodexToolCall | null {
  const re = /```(?:orchestrai-tool|json)\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const hit = tryParseTool(match[1].trim())
    if (hit) return hit
  }
  // fenced 없이 순수 JSON만 응답한 경우
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const hit = tryParseTool(trimmed)
    if (hit) return hit
  }
  return null
}

async function listWorkspaceFiles(dir: string, recursive: boolean): Promise<string[]> {
  const root = getWorkspaceRoot()
  if (!root) throw new Error('워크스페이스 폴더가 열려 있지 않습니다.')
  const workspaceRoot = root

  const results: string[] = []
  const ignored = new Set(['.git', 'node_modules', 'dist', '.vscode-test'])

  async function walk(current: string) {
    if (results.length >= MAX_TOOL_LIST_ITEMS) return
    const entries = await fs.promises.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= MAX_TOOL_LIST_ITEMS) break
      if (ignored.has(entry.name)) continue

      const full = path.join(current, entry.name)
      const rel = path.relative(workspaceRoot, full).replace(/\\/g, '/')
      results.push(entry.isDirectory() ? `${rel}/` : rel)

      if (recursive && entry.isDirectory()) {
        await walk(full)
      }
    }
  }

  await walk(dir)
  return results
}

async function executeCodexTool(
  call: CodexToolCall,
  onBeforeWrite?: (relPath: string, before: string | null) => void,
  onMcpCall?: (server: string, name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  if (call.tool === 'mcp') {
    if (!call.server || !call.name) throw new Error('mcp 도구는 server와 name이 필요합니다.')
    if (!onMcpCall) throw new Error('MCP client가 준비되지 않았습니다.')
    return onMcpCall(call.server, call.name, call.args ?? {})
  }

  if (call.tool === 'list_files') {
    const target = resolveWorkspacePath(call.path)
    const files = await listWorkspaceFiles(target, call.recursive ?? true)
    return files.join('\n') || '(empty)'
  }

  if (!call.path) throw new Error(`${call.tool}에는 path가 필요합니다.`)
  const target = resolveWorkspacePath(call.path)

  if (call.tool === 'read_file') {
    const text = await fs.promises.readFile(target, 'utf8')
    return text.length > MAX_TOOL_READ_CHARS
      ? `${text.slice(0, MAX_TOOL_READ_CHARS)}\n\n[truncated at ${MAX_TOOL_READ_CHARS} chars]`
      : text
  }

  if (call.tool === 'write_file') {
    if (typeof call.content !== 'string') throw new Error('write_file에는 content가 필요합니다.')
    const before = await fs.promises.readFile(target, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    onBeforeWrite?.(call.path, before)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, call.content, 'utf8')
    return `wrote ${call.path}`
  }

  if (call.tool === 'replace_in_file') {
    if (typeof call.oldText !== 'string' || typeof call.newText !== 'string') {
      throw new Error('replace_in_file에는 oldText와 newText가 필요합니다.')
    }
    const text = await fs.promises.readFile(target, 'utf8')
    const index = text.indexOf(call.oldText)
    if (index < 0) throw new Error(`oldText를 찾지 못했습니다: ${call.path}`)

    onBeforeWrite?.(call.path, text)
    const updated = text.slice(0, index) + call.newText + text.slice(index + call.oldText.length)
    await fs.promises.writeFile(target, updated, 'utf8')
    return `replaced text in ${call.path}`
  }

  throw new Error(`지원하지 않는 도구입니다: ${call.tool}`)
}

function stringifyMcpResult(result: any): string {
  if (!result) return ''
  const content = Array.isArray(result.content) ? result.content : []
  const rendered = content.map((part: any) => {
    if (part?.type === 'text') return part.text ?? ''
    if (part?.type === 'image') return `[image ${part.mimeType ?? ''} ${String(part.data ?? '').length} bytes]`
    if (part?.type === 'audio') return `[audio ${part.mimeType ?? ''} ${String(part.data ?? '').length} bytes]`
    if (part?.type === 'resource') return `[resource ${part.resource?.uri ?? ''}]`
    return JSON.stringify(part)
  }).filter(Boolean).join('\n')

  const structured = result.structuredContent
    ? `\n\n<structured>\n${JSON.stringify(result.structuredContent, null, 2)}\n</structured>`
    : ''
  return `${rendered}${structured}`.trim() || JSON.stringify(result, null, 2)
}

class McpManager implements vscode.Disposable {
  private clients = new Map<string, { client: Client; transport: StdioClientTransport }>()
  private toolsCache = new Map<string, McpToolInfo[]>()

  constructor(private readonly getConfig: () => Record<string, McpServerConfig>) {}

  dispose() {
    for (const entry of this.clients.values()) {
      entry.transport.close().catch(() => undefined)
    }
    this.clients.clear()
    this.toolsCache.clear()
  }

  configuredServers(): string[] {
    return Object.keys(this.getConfig() ?? {})
  }

  async listTools(): Promise<McpToolInfo[]> {
    const all: McpToolInfo[] = []
    for (const server of this.configuredServers()) {
      const tools = await this.listServerTools(server).catch((err) => {
        log.warn('mcp', `list tools failed for ${server}:`, err)
        return []
      })
      all.push(...tools)
    }
    return all
  }

  async listServerTools(server: string): Promise<McpToolInfo[]> {
    const cached = this.toolsCache.get(server)
    if (cached) return cached

    const client = await this.getClient(server)
    const result = await client.listTools()
    const tools = result.tools.map(t => ({
      server,
      name: t.name,
      description: t.description,
    }))
    this.toolsCache.set(server, tools)
    return tools
  }

  async callTool(server: string, name: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<string> {
    const client = await this.getClient(server)
    // MCP 서버가 hang 시 익스텐션 전체 멈추는 거 차단 — Promise.race로 timeout 강제
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`MCP timeout after ${timeoutMs}ms (server=${server}, tool=${name})`)), timeoutMs)),
    ])
    return stringifyMcpResult(result)
  }

  async refresh() {
    for (const entry of this.clients.values()) {
      await entry.transport.close().catch(() => undefined)
    }
    this.clients.clear()
    this.toolsCache.clear()
  }

  private async getClient(server: string): Promise<Client> {
    const existing = this.clients.get(server)
    if (existing) return existing.client

    const rawCfg = this.getConfig()[server]
      if (!rawCfg?.command) throw new Error(`MCP server 설정이 없습니다: ${server}`)
    const cfg = expandMcpConfig(rawCfg)

    const root = getWorkspaceRoot()
    const client = new Client({ name: 'orchestrai', version: '0.1.0' }, { capabilities: {} })
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      cwd: cfg.cwd ?? root ?? process.cwd(),
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => log.warn('mcp', `[${server}] ${String(chunk)}`))
    await client.connect(transport)
    this.clients.set(server, { client, transport })
    return client
  }
}

function getActiveFileContext(): FileContext | null {
  const editor = vscode.window.activeTextEditor
  if (!editor) return null

  const doc = editor.document
  const fullText = doc.getText()
  const cursorLine = editor.selection.active.line  // 0-based

  let content: string
  let isTruncated = false

  if (fullText.length > MAX_FILE_CHARS) {
    isTruncated = true
    const lines = fullText.split('\n')
    const start = Math.max(0, cursorLine - 80)
    const end = Math.min(lines.length, cursorLine + 160)
    content = lines.slice(start, end).join('\n').slice(0, MAX_FILE_CHARS)
  } else {
    content = fullText
  }

  const selection = editor.selection
  const selectedText = selection.isEmpty ? undefined : doc.getText(selection)

  return {
    fileName: path.basename(doc.fileName),
    language: doc.languageId,
    content,
    selectedText,
    cursorLine: cursorLine + 1,
    isTruncated,
  }
}

function buildContextBlock(ctx: FileContext): string {
  const attrs = ctx.isTruncated
    ? ` truncated="true" note="cursor-centered excerpt"`
    : ''
  const lines = [
    `<file name="${ctx.fileName}" lang="${ctx.language}"${attrs}>`,
    ctx.content,
    '</file>',
  ]
  if (ctx.selectedText) {
    lines.push(
      `<selection lines="around-line-${ctx.cursorLine}">`,
      ctx.selectedText,
      '</selection>',
    )
  }
  return lines.join('\n')
}

function modelLabel(m: Model): string {
  return m === 'claude' ? 'Claude (Anthropic)'
    : m === 'codex' ? 'Codex (OpenAI GPT-5)'
    : 'Gemini (Google)'
}

// 모델 + effort → 실제 backend가 호출하는 모델 ID. UI 표시용 (어떤 변종으로 통했는지 명확히)
export function actualModelName(model: Model, effort: Effort): string {
  if (model === 'claude') {
    if (effort === 'high' || effort === 'extra-high') return 'claude-opus-4-6'
    return 'claude-sonnet-4-6'
  }
  if (model === 'codex') {
    if (effort === 'low') return 'gpt-5.4-mini'
    if (effort === 'high' || effort === 'extra-high') return 'gpt-5.5'
    return 'gpt-5.4'
  }
  // gemini
  if (effort === 'high' || effort === 'extra-high') return 'gemini-2.5-pro'
  return 'gemini-2.5-flash'
}

// ventriloquism 후처리 — 라인 시작뿐 아니라 inline 도 잡음.
// "blah blah **[Codex]** xxx **[Gemini]** yyy" 같은 한 줄 형식도 처리.
// 알고리즘: tag 매치 위치로 content split → self segment / peer segment 분리 → peer 만 drop.
function stripVentriloquizedLines(content: string, selfModel: Model): { sanitized: string; stripped: boolean } {
  const selfName = ({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' } as const)[selfModel].toLowerCase()
  // 인라인 매치 — 라인 시작 ^ 강제 안 함. markdown bold/italic/code 변형도 같이.
  const tagRe = /[*_`]{0,4}\s*\[\s*(Claude|Codex|Gemini)\s*(?:→\s*\w+\s*)?\]\s*[*_`]{0,4}/gi

  type Seg = { model: string | null; text: string }
  const segs: Seg[] = []
  let lastIdx = 0
  let m: RegExpExecArray | null
  let firstHead = ''
  while ((m = tagRe.exec(content)) !== null) {
    const before = content.slice(lastIdx, m.index)
    if (segs.length === 0) {
      // 첫 tag 이전 텍스트 — 누가 말한 건지 명확하지 않지만 본인 발언으로 간주 (보존)
      firstHead = before
    } else {
      segs[segs.length - 1].text += before
    }
    segs.push({ model: m[1].toLowerCase(), text: '' })
    lastIdx = m.index + m[0].length
  }
  // 마지막 tail
  if (segs.length > 0) segs[segs.length - 1].text += content.slice(lastIdx)

  if (segs.length === 0) {
    // tag 자체 없음 → 원본 그대로
    return { sanitized: content, stripped: false }
  }

  const out: string[] = []
  if (firstHead.trim()) out.push(firstHead.trim())
  let stripped = false
  for (const seg of segs) {
    if (seg.model === selfName) {
      // 본인 발언 — 본문만 keep (tag 자체는 drop)
      const t = seg.text.trim()
      if (t) out.push(t)
    } else {
      // peer ventriloquism → drop
      stripped = true
    }
  }
  let sanitized = out.join('\n\n').trim()
  if (stripped) {
    sanitized += '\n\n> ⚠ 다른 모델 발언 부분은 자동 제거됨 — 셋 다 답을 원하면 argue/team 모드를 쓰세요.'
  }
  if (!sanitized) sanitized = content  // 전부 strip 됐으면 원본 보존 (안전망)
  return { sanitized, stripped }
}

function buildSystemPrompt(
  ctx: FileContext | null,
  model: Model = 'claude',
  collabHint?: 'first' | 'reply',
  mcpTools?: McpToolInfo[],
  permissionMode: PermissionMode = 'auto-edit',
  teamRole?: 'architect' | 'implementer' | 'reviewer',
): string {
  const selfName = modelLabel(model)
  const peers: Model[] = (['claude', 'codex', 'gemini'] as Model[]).filter(m => m !== model)
  const peerNames = peers.map(modelLabel).join(' and ')

  // team 모드 역할별 지침 (teamRole이 지정됐을 때만)
  // 새 설계: Claude orchestrator가 consult_codex/consult_gemini/generate_image 툴로 동료에게 위임.
  // implementer/reviewer는 더 이상 직접 응답하지 않고, Claude가 consult로 부름.
  const teamRoleBlock =
    teamRole === 'architect'
      ? `\n\nTEAM MODE — you are the ORCHESTRATOR (architect + final reviewer). The user explicitly chose team mode because they want to SEE Codex and Gemini contribute. Hogging all the work yourself defeats the purpose.

Your team:
- **You (Claude)**: plan, delegate, integrate, FINAL REVIEW. Do NOT write code or do file analysis yourself when a teammate fits.
- **Codex (GPT-5)**: implementer. Call via \`consult_codex(task)\` tool. Codex edits files itself. Use for ALL of: writing code, implementing features, fixing bugs, scaffolding, refactors, test writing, generating boilerplate.
- **Gemini**: specialist. Call via \`consult_gemini(question)\` for ALL of: long-context analysis (whole codebase scan), summarization, multi-file reading, web/doc lookups, "explain this large thing". Call \`generate_image(prompt, save_to)\` for any image creation.

MANDATORY DELEGATION (do this every team-mode turn):
- If user asks for code changes / new files / fixes / features: you MUST call consult_codex. Do NOT write the code yourself.
- If user asks to analyze/summarize/read large content: you MUST call consult_gemini.
- If user asks for image/visual: you MUST call generate_image.
- You may chain multiple consults in one turn (e.g. consult_gemini for context → consult_codex for impl).
- Brief plan FIRST (2-4 lines max), then call the tool(s), then short final summary. Don't write the implementation in your own message.

When you can answer directly (skip delegation):
- Pure conceptual questions ("what does X mean", "which is faster"), where no file work and no image is needed.
- One-line trivial fixes you can do with Edit tool faster than describing it to Codex.
- Status check / questions about your own prior reply.

Output style — STRICT:
- Brief plan (1-3 lines) → tool calls → STOP. After tools return, your wrap-up is OPTIONAL and must be ≤40 chars total.
- Examples of valid wrap-up: "셋 다 답함", "✅ 완료", "OK", "Codex 가 처리". Or empty.
- FORBIDDEN after tools: tables comparing models, "[Codex] xxx" / "[Gemini] xxx" lines, recap of what peers said, verdicts, "현황:" / "최종 판정:" / "정리:" headers, multi-paragraph summaries.
- Reason: Codex/Gemini answers ALREADY render in their own bubbles next to yours. The user reads them directly. Your recap is noise + ventriloquism risk.
- If you feel compelled to summarize, ignore that compulsion. Stop talking.
- Each consult_codex(task) = ONE focused job with concrete paths + acceptance criteria, NOT the whole user message.`
      : ''

  // argue 모드 힌트 (team은 아닐 때만)
  const argueBlock = !teamRole && (
    collabHint === 'reply'
      ? `\n\nARGUE MODE — a peer just answered above. Add your own angle naturally: agree, disagree, build on it, whatever feels right. Keep it conversational and tight.`
      : collabHint === 'first'
      ? `\n\nARGUE MODE — your peers (${peerNames}) will reply after you. Give your take, they'll respond.`
      : ''
  )

  const collabBlock = teamRoleBlock || argueBlock

  const base = `You are the ${selfName} backend of OrchestrAI —a VSCode extension that orchestrates multiple AI models.

CONTEXT YOU MUST KEEP IN MIND
- The user runs Claude Max + ChatGPT Pro + Gemini (Google) subscriptions. OrchestrAI routes each request to whichever model fits the task best.
- You are ${selfName}. Your peers are ${peerNames}. All three can appear in the same chat thread.
- You are ${selfName}. Speak as yourself in first person. Don't pretend to be ${peerNames}.
- Prior assistant messages in the history are wrapped in <prior_turn from="..."> ... </prior_turn> tags — that's a system meta-tag identifying who said what. Don't replicate that XML format in your output, just write plain text as yourself.
- If user asks about a peer's opinion that isn't actually in the history, just say so honestly ("이 대화엔 X 응답이 없네요") — don't make up quotes. But you CAN naturally reference what's actually visible.
- Rough division: Claude —architecture, multi-file refactoring, deep debugging, code review, nuanced reasoning. Codex —fast implementation, boilerplate, CLI, simple fixes. Gemini —long-context (whole codebase, big files), multimodal (images/PDFs/diagrams), summarization.
- When asked "which model should I use?" —answer in terms of THIS three-model setup, do NOT give generic comparisons.${collabBlock}

HOW TO THINK BEFORE ANSWERING
- Pause and plan. Identify what the user actually needs (a fix? an explanation? a decision?). Pick the 2-3 points that matter and skip the rest.
- If the request is ambiguous, ask ONE sharp clarifying question instead of guessing wide.
- For code questions: state the root cause first, then the fix. Don't dump every possibility.

AGENT AUTONOMY — for code tasks, work end-to-end in ONE turn (Claude Code style):
- When user asks to make/fix/build/implement something, do the WHOLE thing in this turn. Don't stop midway and wait for next prompt.
- Use Read → Edit/Write → Bash (build/test) → verify → report. All inside one response, multiple tool calls.
- DO NOT ask "shall I proceed?" / "이렇게 할까요?" mid-task. State the plan in 2-4 lines, then execute immediately.
- If build fails or test breaks, fix it yourself and re-run. Don't hand off to the user with "build failed, please fix".
- Only stop when the success criteria is met (file written + build green + or what user asked for is done).
- Mid-task progress notes are fine ("read X, editing Y, running build...") — but never gate on user reply.
- Exception: only ask if the request is so ambiguous that a wrong assumption would cost real rework (then ask ONE sharp question and wait).

REFINE VAGUE PROMPTS — only when truly under-specified
The user is a vibe-coder. Short prompts are normal. Default to ACTING: pick reasonable defaults and proceed (AGENT AUTONOMY above).
ONLY refine when the request is so under-specified that a wrong default would cost real rework — typically: brand-new app from scratch with no stack pinned, or open-ended creative work.
For everyday fixes/edits/small features, just do them. Don't propose a refined version every time.

When you DO need to refine:
1. Detect when a request is under-specified for a quality result (missing: stack, features, scope, constraints, success criteria).
2. BEFORE starting, propose a sharper version of the prompt as a markdown blockquote with concrete details:
   - 스택 (framework, language, version)
   - 핵심 메커니즘·기능 (구체적으로)
   - 디자인·톤 (레퍼런스 있으면 더 좋음)
   - 제약 (의존성, 성능, 플랫폼)
   - "완료" 기준 (어떻게 동작하면 끝인지)
3. WHY 섹션으로 왜 그 다듬은 버전이 더 좋은지 짧게 설명. 보통 "추측 줄여서 재작업 적음".
4. 마지막에 묻기: "이대로 진행할까요? 다른 방향이면 알려주세요. **'그냥 해'** 라고 하시면 위 안으로 바로 진행합니다."

응답 템플릿 예시 (게임 만들기 시나리오):
> 짧게 그대로면 너무 자유도가 커져서 마음에 안 드실 수 있어요. 이렇게 다듬으면 어떨까요?
>
> > **Phaser 3 + TypeScript + Vite**로 모바일 세로형 런닝 게임. 탭으로 점프·슬라이드 조작, 씬 3종(직선/지그재그/추적), 아이템 픽업, 오픈 사이버펑크 비주얼, 60fps 모바일 브라우저 타깃.
>
> **이렇게 하는 이유**:
> - 스택을 못 박아야 라이브러리 갈래·버전 차이 ↓
> - 씬·조작 방식·비주얼까지 정해주면 의사결정 ↓ 속도 ↑
> - 완성도 높은 결과 한 번에 나오니 재작업 적음
>
> 이대로 진행할까요? **'그냥 해'** 라고 하시면 바로 시작합니다.

When NOT to refine:
- 명백하고 구체적인 요청 ("이 함수 typo 고쳐", "버튼 색을 빨강으로", "console.log 추가")
- 단순 질문 ("이거 뭐야?", "왜 이래?")
- 이미 앞 대화에서 다듬은 안을 사용자가 OK했거나 작업 진행 중
PROACTIVELY UPGRADE THE USER'S SETUP
The user is a vibe-coder —they often don't know what tools exist or could help. When you notice the workflow could benefit from setup changes, SAY SO. Specifically:
- **Missing MCP that fits the task** — recommend a concrete MCP server with name and what it would unlock. Examples: NotebookLM MCP for research/note synthesis, GitHub MCP for repo management, Postgres MCP for DB work, Playwright MCP for browser automation, Linear MCP for ticketing.
- **Missing Gemini API key when image gen would help** — say "이미지가 필요한 작업인데 Gemini API 키가 없어요. 설정 → 계정 연결 → 🎨 Gemini API 키에서 등록하면 generate_image 활성화됩니다."
- **Workspace structure improvements** —if you notice missing .gitignore, no README, no CI config, missing tsconfig strict, etc., point it out briefly.
- **Capability requests** — if you literally CAN'T do something the user wants and a tool would fix it, ask: "X를 하려면 Y MCP가 필요한데 붙여드릴까요?" Don't silently fail.
Be useful, not preachy. Don't mention this every turn —only when relevant to the actual task.

RESPONSE STYLE — Claude Code CLI 톤. WORK REPORT, not chat.
- **Open with action verb**, not greeting. GOOD: "Read 3 files → X 발견". "Editing src/foo.ts:42 — 1줄 변경". "테스트 실패: Y 라인". BAD: "좋은 질문이에요", "확인해볼게요", "알겠습니다", "물론입니다", "도와드릴게요".
- **Result FIRST, reasoning only if asked.** "왜?" 질문 받기 전엔 설명 X. 사용자가 명시적으로 "왜?", "이유?", "explain" 했을 때만 reasoning.
- **Prose paragraphs banned for non-WHY questions.** 작업 요청·코드 질문엔 산문 X. 작업 보고·짧은 bullet·코드만.
- **No filler closers.** 응답 끝에 "도와드릴까요?", "더 필요한 거 있으세요?", "위에서 설명한 바와 같이..." 금지. 끝은 항상 concrete: \`다음: npm test\` / \`확인 필요: X 동작\` / \`완료\`.
- **File references = markdown links.** \`[filename.ts:42](src/filename.ts#L42)\`. NEVER bare \`src/filename.ts\`.
- Korean when user writes Korean. Direct tone. No hedging ("잘 모르겠지만", "아마도", "가능할 것 같습니다" 금지 — 모르면 "확인 필요" 한 줄).
- No emojis unless user uses them first.
- 응답 길이: 단순 작업 = 3~5줄. 복잡 = 짧은 bullet 5~10개. 산문 paragraph 2개 이상 = 너무 김.

OUTPUT FORMATTING — STRICT
- Code → fenced block with language tag (\`ts\`, \`py\`, \`bash\`, \`json\`).
- Markdown block elements (headers, fences, lists, hr) on own line with blank line above/below.
- Bullets one line each.
- Tables for comparison.
- Inline \`code\` for symbols.`

  let localTools = ''
  if (model === 'codex' || model === 'gemini') {
    const wsRoot = getWorkspaceRoot() ?? '(no workspace open)'
    const wsBase = wsRoot !== '(no workspace open)' ? path.basename(wsRoot) : ''
    localTools = `

LOCAL WORKSPACE TOOLS
You can inspect and edit the user's currently open VSCode workspace through OrchestrAI.
When you need a tool, output EXACTLY one fenced block and nothing else:

\`\`\`orchestrai-tool
{"tool":"list_files","path":".","recursive":true}
\`\`\`

Available tools:
- list_files: {"tool":"list_files","path":".","recursive":true}
- read_file: {"tool":"read_file","path":"src/file.ts"}
- write_file: {"tool":"write_file","path":"src/file.ts","content":"full new file content"}
- replace_in_file: {"tool":"replace_in_file","path":"src/file.ts","oldText":"exact text","newText":"replacement"}
- mcp: {"tool":"mcp","server":"serverName","name":"toolName","args":{"key":"value"}}

WORKSPACE ROOT (CRITICAL for path):
${wsRoot}

PATH RULES:
- All paths are RELATIVE to the workspace root above.
- Correct: "test/foo.md", "src/util.ts", "package.json"${wsBase ? `
- WRONG:   "${wsBase}/test/foo.md", "/${wsBase}/src/util.ts" — that prefixes the workspace name and the file ends up at workspace/${wsBase}/${wsBase}/...` : ''}
- Use list_files first if you're unsure of the structure.

Other rules:
- Prefer read_file before editing existing files.
- Prefer replace_in_file for focused edits and write_file for new files or full rewrites.
- Use mcp only when the user asks for external MCP-backed capabilities or the needed tool is not one of the local workspace tools.
- After tool results are returned, continue until the task is complete, then answer normally with a concise summary.`
  } else if (model === 'claude') {
    localTools = `

LOCAL WORKSPACE TOOLS
You have access to Claude Code's built-in tools: Read, Write, Edit, Bash, Grep, Glob, etc.
Use them directly to read and modify the user's workspace. You can:
- Read existing files before editing.
- Edit/Write files to make changes (the system auto-accepts edits in auto-edit / smart-auto modes).
- Run Bash commands for builds, tests, searches.

Keep tool use purposeful —each call should advance the task. After completing changes, summarize what changed with markdown links to the modified files.`
  }

  // MCP 서버가 설정돼 있으면 사용 가능한 툴 목록을 프롬프트에 주입
  const mcpBlock = mcpTools && mcpTools.length > 0
    ? `\n\nMCP SERVERS AVAILABLE\n${
        mcpTools.map(t => `- ${t.server}.${t.name}${t.description ? ` —${t.description}` : ''}`).join('\n')
      }\nCall with: {"tool":"mcp","server":"serverName","name":"toolName","args":{...}}`
    : ''

  let modeBlock = ''
  if (permissionMode === 'plan') {
    const ts = Date.now()
    modeBlock = `\n\nPLAN MODE (STRICT —user enabled)
The user wants a plan BEFORE any file changes. You MUST NOT modify files yet.

Required workflow:
1. Analyze the request. Identify the actual problem and cleanest approach.
2. read_file is OK for grounding, but no write_file/replace_in_file on code files.
3. Write a markdown plan via write_file to: \`docs/plans/orchestrai-${ts}.md\`
4. Plan must include:
   - # Goal (1 line)
   - ## Steps (numbered, concrete, actionable)
   - ## Files (path + what changes + why)
   - ## Risks (edge cases, breaking changes, rollback notes)
5. After write_file succeeds, FINAL response: one sentence + markdown link to the plan path. Nothing else.

DO NOT: write_file to any other path, replace_in_file on code, execute further tools. User will review and re-prompt in a new turn.`
  } else if (permissionMode === 'ask') {
    modeBlock = `\n\nASK-BEFORE-EDITS MODE (user enabled)
Before calling write_file or replace_in_file, you MUST:
1. Show the proposed change as a fenced diff or code block.
2. Explain what will change in 1 line.
3. End with a clear question: "이대로 진행할까요?" — and STOP. Do NOT call the tool yet.
4. Wait for the user's next message. If they confirm, call the tool in the next turn.

read_file and list_files do not need confirmation. MCP tool calls do not need confirmation unless they modify external state.`
  } else if (permissionMode === 'smart-auto') {
    modeBlock = `\n\nSMART AUTO MODE (user enabled)
Choose per action:
- Trivial/reversible edits (adding a line, fixing typos, stylistic) —execute immediately.
- Risky changes (deleting code >10 lines, schema/config changes, security-relevant, irreversible) —show diff first, ask confirmation.
- When in doubt, ask.`
  }
  // 'auto-edit'은 추가 지침 없음 (기본 동작)

  // 프로젝트 룰 — workspace 의 ORCHESTRAI.md 또는 .orchestrai/rules.md 자동 prepend
  // 사용자 정의 컨벤션 / 금지 사항 / 스택 등을 모든 모델에 통합 주입
  const projectRules = loadProjectRules()
  const rulesBlock = projectRules
    ? `\n\nPROJECT RULES (from ORCHESTRAI.md — these are the user's convention guardrails. follow them strictly):\n${projectRules}\n`
    : ''

  const prompt = `${base}${rulesBlock}${localTools}${mcpBlock}${modeBlock}`

  if (!ctx) return prompt

  return `${prompt}

The user has this file open:
${buildContextBlock(ctx)}
${ctx.cursorLine ? `Cursor at line ${ctx.cursorLine}.` : ''}
${ctx.selectedText ? 'User has selected code —prioritize that selection.' : ''}

Answer questions about this file directly. Show modified code for edits.`
}

// ?? WebView Provider ??????????????????????????????????????????????
class OrchestrAIViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private _view?: vscode.WebviewView
  private _messages: ChatMessage[] = []
  private _chatKey = chatStateKey()
  private _override: RouterMode = 'auto'
  private _useFileContext = true
  private _authStorage: AuthStorage
  private _claudeAuth: ClaudeAuth
  private _codexAuth: CodexAuth
  private _geminiAuth: GeminiAuth
  private _usage: UsageTracker
  private _mcp: McpManager
  private _subscriptions: vscode.Disposable[] = []
  private _isSending = false
  private _argueStop = false
  private _inArgue = false
  private _permissionMode: PermissionMode = 'auto-edit'
  // 유저가 수동 override한 effort. null이면 inferEffort로 자동 결정
  private _effortOverride: Effort | null = null
  private _fileSnapshotsByTurn = new Map<string, FileSnapshot[]>()
  private _pendingApproval?: PendingApproval
  private _compaction?: CompactionState  // 압축본 저장 — 각 model에 [요약 + 최근원문] 으로 보냄
  private _compactingNow = false
  private _currentAbort?: AbortController  // 현재 진행 중인 generation 중단용
  private _statusBarItem: vscode.StatusBarItem
  private _telegramBridge?: TelegramBridge
  private _codebaseIndex: CodebaseIndex | null = null
  private _indexing = false
  private _indexFileWatcher?: vscode.FileSystemWatcher
  private _reindexQueue = new Set<string>()
  private _reindexTimer?: NodeJS.Timeout
  // 백그라운드 작업 상태 트래킹 (UI 패널용)
  private _backgroundTasks = new Map<string, { id: string; preview: string; startedAt: number; status: 'running' | 'done' | 'failed'; result?: string; error?: string }>()

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._authStorage = new AuthStorage(_context.secrets)
    this._claudeAuth = new ClaudeAuth(this._authStorage)
    this._codexAuth = new CodexAuth(this._authStorage)
    this._geminiAuth = new GeminiAuth(this._authStorage)
    this._usage = new UsageTracker()
    this._mcp = new McpManager(() => this._cfg<Record<string, McpServerConfig>>('mcpServers') ?? {})
    this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    this._statusBarItem.command = 'orchestrai.openChat'
    // 컨텍스트 윈도우 setting 적용 + 변경 감지
    this._applyContextWindow()
    this._subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('orchestrai.contextWindow')) this._applyContextWindow()
      }),
    )
    // 이전에 연결됐던 Telegram 봇 자동 재접속 (cfg가 SecretStorage에 있으면)
    void this._autoStartTelegram()

    // 모델 내부 폴백(intra-provider) 발생 시 webview에 알림 — 어떤 모델이 답했는지 명확히
    setGeminiFallbackNotifier((from, to, reason) => {
      this._post({ type: 'modelFallback', from, to, reason, model: 'gemini' })
    })
    setClaudeFallbackNotifier((from, to, reason) => {
      this._post({ type: 'modelFallback', from, to, reason, model: 'claude' })
    })
    setCodexFallbackNotifier((from, to, reason) => {
      this._post({ type: 'modelFallback', from, to, reason, model: 'codex' })
    })

    // 사용자가 입력한 Gemini API key 가 있으면 텍스트 호출 시 그쪽 사용 (Code Assist OAuth tier 보다 한도 큼).
    // 이미지 생성 / RAG 인덱싱용으로만 쓰이던 거 텍스트에도 활용 — 사용자 추가 작업 0.
    void this._authStorage.getGeminiApiKey().then(k => setGeminiApiKey(k ?? null))

    // 코드베이스 인덱스 로드 (이미 인덱싱돼있으면 즉시 사용 가능)
    const root = getWorkspaceRoot()
    if (root) {
      this._codebaseIndex = loadIndex(_context.globalStorageUri.fsPath, root)
      if (this._codebaseIndex) {
        log.info('index', `loaded ${this._codebaseIndex.totalChunks} chunks (${this._codebaseIndex.totalFiles} files)`)
      }
      // 파일 변경 감지 → 자동 re-index (debounced, RAG 활성 시만)
      this._indexFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,mjs,cjs,py,rb,go,rs,java,kt,swift,c,cc,cpp,h,hpp,cs,html,css,scss,vue,svelte,md,mdx,json,yaml,yml,toml,sh,ps1,sql}')
      const onChanged = (uri: vscode.Uri) => {
        if (!this._codebaseIndex) return
        if (this._cfg<boolean>('codebaseRag.autoIndex') === false) return
        this._reindexQueue.add(uri.fsPath)
        if (this._reindexTimer) clearTimeout(this._reindexTimer)
        this._reindexTimer = setTimeout(() => void this._processReindexQueue(), 3000)
      }
      this._indexFileWatcher.onDidChange(onChanged)
      this._indexFileWatcher.onDidCreate(onChanged)
      this._indexFileWatcher.onDidDelete(onChanged)
      this._subscriptions.push(this._indexFileWatcher)
    }
  }

  // 변경된 파일들 batched re-index
  private async _processReindexQueue() {
    if (!this._codebaseIndex || this._indexing) return
    const apiKey = await this._authStorage.getGeminiApiKey()
    if (!apiKey) return
    const files = [...this._reindexQueue]
    this._reindexQueue.clear()
    for (const f of files) {
      try {
        this._codebaseIndex = await reindexFile(this._codebaseIndex, f, apiKey, this._context.globalStorageUri.fsPath)
      } catch (err) {
        log.warn('index', `reindex failed for ${f}:`, err)
      }
    }
  }

  async getGeminiApiKey(): Promise<string | null> {
    return this._authStorage.getGeminiApiKey()
  }

  // 명시적 인덱싱 트리거 (명령 또는 첫 사용 시)
  async indexCodebase() {
    const root = getWorkspaceRoot()
    if (!root) {
      vscode.window.showWarningMessage('워크스페이스가 열려있지 않습니다.')
      return
    }
    const apiKey = await this._authStorage.getGeminiApiKey()
    if (!apiKey) {
      vscode.window.showWarningMessage('코드베이스 인덱싱에는 Gemini API 키가 필요합니다. 설정 → 계정 연결 → Gemini API 키.')
      return
    }
    if (this._indexing) {
      vscode.window.showInformationMessage('이미 인덱싱 진행 중입니다.')
      return
    }
    this._indexing = true
    const ctrl = new AbortController()
    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'OrchestrAI: 코드베이스 인덱싱 중...',
        cancellable: true,
      }, async (progress, token) => {
        token.onCancellationRequested(() => ctrl.abort())
        this._codebaseIndex = await buildIndex(
          root,
          this._context.globalStorageUri.fsPath,
          apiKey,
          (p) => {
            const msg = p.phase === 'scanning' ? `파일 스캔 중 (${p.files ?? 0})`
              : p.phase === 'chunking' ? `청크 생성 중 (${p.files} 파일)`
              : p.phase === 'embedding' ? `임베딩 중 ${p.embeddedChunks}/${p.chunks}`
              : p.phase === 'saving' ? '저장 중...'
              : '완료'
            const pct = p.phase === 'embedding' && p.chunks ? (p.embeddedChunks ?? 0) / p.chunks * 100 : undefined
            progress.report({ message: msg, increment: pct })
          },
          ctrl.signal,
        )
      })
      vscode.window.showInformationMessage(`✓ 코드베이스 인덱싱 완료 — ${this._codebaseIndex?.totalChunks ?? 0} chunks (${this._codebaseIndex?.totalFiles ?? 0} files)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg !== 'aborted') vscode.window.showErrorMessage(`인덱싱 실패: ${msg}`)
    } finally {
      this._indexing = false
    }
  }

  private _applyContextWindow() {
    const preset = this._cfg<string>('contextWindow') ?? 'default'
    if (preset === 'narrow' || preset === 'default' || preset === 'wide') {
      setContextWindowPreset(preset)
      log.info('context', `window preset = ${preset}`)
    }
  }

  // routingDecision post 시 actualModel 자동 주입 — UI에 항상 어떤 모델 변종 갔는지 보임
  private _postRoutingDecision(d: RoutingDecision) {
    const enriched = d.actualModel ? d : { ...d, actualModel: actualModelName(d.model, d.effort) }
    this._post({ type: 'routingDecision', decision: enriched })
  }

  // ?? Telegram ?????????????????????????????????????????????????????

  private async _autoStartTelegram(attempt = 0): Promise<void> {
    const MAX_ATTEMPTS = 4
    try {
      const cfg = await this._authStorage.getTelegramConfig()
      if (!cfg) {
        log.info('telegram', `auto-start skip (no saved config) attempt=${attempt}`)
        if (attempt < 1) setTimeout(() => void this._autoStartTelegram(attempt + 1), 3000)
        return
      }
      log.info('telegram', `auto-start beginning (attempt ${attempt}, workspace="${cfg.workspaceName}", topics=${!!cfg.useTopics})`)
      this._telegramBridge = new TelegramBridge(this, cfg.token, cfg.chatId, cfg.workspaceName, !!cfg.useTopics)
      await this._telegramBridge.start()
      log.info('telegram', `auto-started successfully (attempt ${attempt})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('telegram', `auto-start failed (attempt ${attempt}): ${msg}`)
      try { await this._telegramBridge?.dispose() } catch {}
      this._telegramBridge = undefined
      if (attempt < MAX_ATTEMPTS - 1) {
        const delayMs = [5000, 15000, 45000][attempt] ?? 60000
        log.info('telegram', `retry in ${delayMs}ms`)
        setTimeout(() => void this._autoStartTelegram(attempt + 1), delayMs)
      } else {
        vscode.window.showWarningMessage(
          `Telegram 자동 연결 실패 (${MAX_ATTEMPTS}회 시도): ${msg}
설정 → Telegram 연결에서 수동으로 다시 시도해주세요.`,
        )
      }
    }
  }

  async _showTelegramMenu() {
    const existing = await this._authStorage.getTelegramConfig()
    const items: Array<vscode.QuickPickItem & { action: string }> = []
    if (existing) {
      items.push(
        { label: '$(circle-filled) Connected', description: `${existing.workspaceName} - chat:${existing.chatId}`, action: 'status' },
        { label: '$(comment) Send test message', description: 'Ping the connected chat', action: 'test' },
        { label: '$(debug-disconnect) Disconnect', description: 'Stop polling and remove config', action: 'disconnect' },
        { label: '$(edit) Reconfigure', description: 'Enter token/chat_id again', action: 'configure' },
      )
    } else {
      items.push(
        { label: '$(add) Connect Telegram bot', description: 'Enter token, chat_id, and workspace name', action: 'configure' },
        { label: '$(info) Help', description: 'How to create a bot', action: 'help' },
      )
    }

    const picked = await vscode.window.showQuickPick(items, { title: 'Telegram ?곌껐' })
    if (!picked) return

    switch (picked.action) {
      case 'configure':   await this._configureTelegram(); break
      case 'disconnect':  await this._disconnectTelegram(); break
      case 'test':        await this._testTelegram(); break
      case 'status':      await this._telegramStatus(); break
      case 'help':        await this._telegramHelp(); break
    }
  }

  private async _configureTelegram() {
    // 1) 紐⑤뱶 ?좏깮
    const modePick = await vscode.window.showQuickPick(
      [
        { label: '💬 DM 모드', description: '1:1 채팅. 단순. /use 로 작업 전환', value: 'dm' as const },
        { label: '📋 Topics 모드 (추천)', description: '그룹 + 폴더별 자동 분리 토픽. 봇을 그룹 관리자로 추가 필요', value: 'topics' as const },
      ],
      { title: 'Telegram 연결 방식 선택' },
    )
    if (!modePick) return
    const useTopics = modePick.value === 'topics'

    if (useTopics) {
      const proceed = await vscode.window.showInformationMessage(
        'Topics 모드 준비사항:\n\n' +
        '1. Telegram에서 그룹 생성\n' +
        '2. 그룹 설정 → "Topics" 활성화\n' +
        '3. 봇을 그룹에 추가 후 관리자로 승격 → "Manage Topics" 권한 부여\n' +
        '4. 그룹에서 메시지 하나 보낸 후 chat_id 획득\n' +
        '5. chat_id는 음수(-100으로 시작)인 경우가 대부분\n\n' +
        '준비됐나요?',
        { modal: true }, '준비 완료',
      )
      if (proceed !== '준비 완료') return
    }

    const token = await vscode.window.showInputBox({
      title: 'Telegram bot token',
      prompt: 'Token issued by @BotFather /newbot',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => !v?.trim() ? 'Token is required' : /^\d+:[A-Za-z0-9_-]+$/.test(v.trim()) ? null : 'Invalid token format',
    })
    if (!token) return

    const chatId = await vscode.window.showInputBox({
      title: useTopics ? 'Group chat_id' : 'Personal chat_id',
      prompt: useTopics
        ? 'Group chat_id, often negative. Check getUpdates.'
        : 'Your numeric chat_id',
      ignoreFocusOut: true,
      validateInput: (v) => !v?.trim() ? 'chat_id is required' : /^-?\d+$/.test(v.trim()) ? null : 'chat_id must be numeric',
    })
    if (!chatId) return

    const defaultName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace'
    const workspaceName = await vscode.window.showInputBox({
      title: 'Workspace name',
      prompt: 'Used as the topic name when Telegram topics are enabled.',
      value: defaultName,
      ignoreFocusOut: true,
      validateInput: (v) => !v?.trim() ? 'Name is required' : null,
    })
    if (!workspaceName) return

    await this._telegramBridge?.dispose()
    this._telegramBridge = undefined

    try {
      const bridge = new TelegramBridge(this, token.trim(), chatId.trim(), workspaceName.trim(), useTopics)
      await bridge.start()
      await this._authStorage.setTelegramConfig({
        token: token.trim(),
        chatId: chatId.trim(),
        workspaceName: workspaceName.trim(),
        useTopics,
      })
      this._telegramBridge = bridge
      vscode.window.showInformationMessage(
        `✓ Telegram 연결 완료 (${workspaceName.trim()}) · ${useTopics ? 'Topics 모드' : 'DM 모드'}`,
      )
    } catch (err) {
      vscode.window.showErrorMessage(
        `Telegram 연결 실패: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async _disconnectTelegram() {
    const confirm = await vscode.window.showWarningMessage(
      'Disconnect Telegram bot?', { modal: true }, 'Disconnect',
    )
    if (confirm !== 'Disconnect') return
    await this._telegramBridge?.dispose()
    this._telegramBridge = undefined
    await this._authStorage.deleteTelegramConfig()
    vscode.window.showInformationMessage('Telegram disconnected')
  }

  private async _testTelegram() {
    const cfg = await this._authStorage.getTelegramConfig()
    if (!cfg) return
    try {
      const client = new TelegramClient(cfg.token)
      await client.sendMessage(cfg.chatId, `ping from ${cfg.workspaceName} (${new Date().toLocaleTimeString()})`)
      vscode.window.showInformationMessage('Test message sent')
    } catch (err) {
      vscode.window.showErrorMessage(`Send failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async _telegramStatus() {
    const cfg = await this._authStorage.getTelegramConfig()
    if (!cfg) {
      vscode.window.showInformationMessage('Telegram is not connected')
      return
    }
    const running = !!this._telegramBridge
    vscode.window.showInformationMessage(
      `Telegram: ${running ? 'running' : 'stopped'}\n` +
      `workspace: ${cfg.workspaceName}\n` +
      `chat_id: ${cfg.chatId}`,
    )
  }

  private async _telegramHelp() {
    await vscode.env.openExternal(vscode.Uri.parse('https://core.telegram.org/bots#creating-a-new-bot'))
  }

  private async _persistMessages() {
    saveChatStorage(this._context, { messages: this._messages, compaction: this._compaction })
    this._postContextGauge()
  }

  // 현재 대화의 전체 토큰 추정 + 모델별 컨텍스트 시드 → UI 게이지
  private _postContextGauge() {
    let used = 0
    for (const m of this._messages) {
      if (m.role === 'user' || m.role === 'assistant') {
    // history.ts의 estimateTokens와 동일 휴리스틱
    const korean = (m.content.match(/[가-힣]/g) ?? []).length
        const other = m.content.length - korean
        used += Math.ceil(korean + other / 4)
      }
    }
    const max = 200_000
    this._post({ type: 'contextGauge', used, max })
  }

  private _cfg<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration('orchestrai').get<T>(key)
  }

  async clearChat() {
    this._messages = []
    this._compaction = undefined
    this._fileSnapshotsByTurn.clear()
    // 삭제 전 archives/ 폴더로 이동 — 실수로 잃어도 참고용으로 보존
    try {
      const file = chatStateFilePath(this._context)
      if (fs.existsSync(file)) {
        const archiveDir = path.join(path.dirname(file), 'archives')
        fs.mkdirSync(archiveDir, { recursive: true })
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const archivePath = path.join(archiveDir, `${path.basename(file, '.json')}-${ts}.json`)
        fs.renameSync(file, archivePath)
        log.info('persist', `archived ??${archivePath}`)
      }
    } catch (err) {
      log.warn('persist', 'archive failed:', err)
    }
    await this._context.workspaceState.update(this._chatKey, undefined)
    await this._context.workspaceState.update(GLOBAL_CHAT_STATE_KEY, undefined)
    this._post({ type: 'cleared' })
    this._updateUsageStatusBar()
  }

  // 현재 로그인된 LLM 계정 정보 표시 — 이메일·플랜 등 토큰에서 디코드 가능한 정보
  async showAccounts() {
    const decodeJwt = (token: string): any => {
      try {
        const parts = token.split('.')
        if (parts.length < 2) return null
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      } catch { return null }
    }
    const lines: string[] = []

    // Claude — Claude Code CLI 가 ~/.claude/.credentials.json 에 OAuth 저장
    try {
      const credsPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', '.credentials.json')
      if (fs.existsSync(credsPath)) {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))
        const oauth = creds.claudeAiOauth ?? {}
        const claims = decodeJwt(oauth.accessToken ?? '')
        const email = claims?.email ?? claims?.['https://anthropic.com/email'] ?? '(이메일 정보 없음)'
        const plan = oauth.subscriptionType ?? '(플랜 정보 없음)'
        const rateTier = oauth.rateLimitTier ?? '(rate tier 없음)'
        const orgUuid = creds.organizationUuid ? creds.organizationUuid.slice(0, 8) + '...' : '-'
        lines.push(`✅ **Claude** (Anthropic OAuth)`)
        lines.push(`   이메일: ${email}`)
        lines.push(`   플랜: ${plan}`)
        lines.push(`   Rate limit tier: ${rateTier}`)
        lines.push(`   Organization: ${orgUuid}`)
      } else {
        lines.push(`❌ **Claude** — \`~/.claude/.credentials.json\` 없음. \`claude\` CLI 설치/로그인 필요`)
      }
    } catch (err) {
      lines.push(`⚠ Claude 정보 조회 실패: ${err instanceof Error ? err.message : err}`)
    }

    // Codex — ChatGPT OAuth (OpenAI JWT 에 profile namespace claim)
    try {
      const tok = await this._codexAuth.getAccessToken()
      const accountId = await this._codexAuth.getAccountId()
      if (tok) {
        const claims = decodeJwt(tok)
        const profile = claims?.['https://api.openai.com/profile'] ?? {}
        const auth = claims?.['https://api.openai.com/auth'] ?? {}
        const email = profile.email ?? claims?.email ?? '(이메일 정보 없음)'
        const plan = auth.chatgpt_plan_type ?? auth.plan_type ?? auth.plan ?? '(플랜 정보 없음)'
        lines.push(``)
        lines.push(`✅ **Codex** (ChatGPT OAuth)`)
        lines.push(`   이메일: ${email}`)
        lines.push(`   플랜: ${plan}`)
        if (accountId) lines.push(`   계정 ID: ${accountId.slice(0, 12)}...`)
      } else {
        lines.push(``)
        lines.push(`❌ **Codex** — 로그인 안 됨`)
      }
    } catch (err) {
      lines.push(`⚠ Codex 정보 조회 실패: ${err instanceof Error ? err.message : err}`)
    }

    // Gemini — gemini-cli 가 ~/.gemini/oauth_creds.json 에 저장. id_token JWT 에 email
    try {
      const loggedIn = await this._geminiAuth.isLoggedIn()
      if (loggedIn) {
        const credsPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'oauth_creds.json')
        let email = '(이메일 정보 없음)'
        try {
          if (fs.existsSync(credsPath)) {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))
            const claims = decodeJwt(creds.id_token ?? '')
            email = claims?.email ?? '(id_token 디코드 실패)'
          }
        } catch {}
        lines.push(``)
        lines.push(`✅ **Gemini** (Google OAuth — gemini-cli 무료 tier)`)
        lines.push(`   이메일: ${email}`)
        lines.push(`   플랜: oauth-personal (무료 tier, 안전 필터 BLOCK_NONE 불가)`)
      } else {
        lines.push(``)
        lines.push(`❌ **Gemini** — 로그인 안 됨`)
      }
    } catch (err) {
      lines.push(`⚠ Gemini 정보 조회 실패: ${err instanceof Error ? err.message : err}`)
    }

    // 결과 — 별도 unsaved markdown 문서로 보여주기 (긴 내용 + 복사 가능)
    const doc = await vscode.workspace.openTextDocument({
      content: `# OrchestrAI 로그인 계정\n\n` + lines.join('\n') + '\n',
      language: 'markdown',
    })
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside })
  }

  // 아카이브 폴더 열기 — 파일 탐색기로
  async openArchives() {
    const file = chatStateFilePath(this._context)
    const archiveDir = path.join(path.dirname(file), 'archives')
    try { fs.mkdirSync(archiveDir, { recursive: true }) } catch {}
    await vscode.env.openExternal(vscode.Uri.file(archiveDir))
  }

  // 아카이브 + 다른 워크스페이스 채팅 파일 전부 후보로 띄워서 선택해서 현재 대화로 복원
  async restoreArchive() {
    const file = chatStateFilePath(this._context)
    const chatsDir = path.dirname(file)
    const archiveDir = path.join(chatsDir, 'archives')

    type Candidate = { fullPath: string; isArchive: boolean; isCurrent: boolean; basename: string }
    const candidates: Candidate[] = []

    // 현재 chats/ 폴더의 모든 .json (현재 워크스페이스 + 다른 워크스페이스들)
    if (fs.existsSync(chatsDir)) {
      for (const f of fs.readdirSync(chatsDir)) {
        if (!f.endsWith('.json')) continue
        const fullPath = path.join(chatsDir, f)
        candidates.push({
          fullPath,
          isArchive: false,
          isCurrent: fullPath === file,
          basename: f,
        })
      }
    }
    if (fs.existsSync(archiveDir)) {
      for (const f of fs.readdirSync(archiveDir)) {
        if (!f.endsWith('.json')) continue
        candidates.push({
          fullPath: path.join(archiveDir, f),
          isArchive: true,
          isCurrent: false,
          basename: f,
        })
      }
    }

    if (candidates.length === 0) {
      vscode.window.showInformationMessage('복원할 대화가 없습니다.')
      return
    }

    // 메타데이터 읽기
    const items = candidates.map(c => {
      let count = 0
      let preview = ''
      let mtime = ''
      try {
        const raw = fs.readFileSync(c.fullPath, 'utf8')
        const parsed = JSON.parse(raw)
        const msgs: ChatMessage[] = Array.isArray(parsed) ? parsed : (parsed.messages ?? [])
        count = msgs.length
        const firstUser = msgs.find(m => m.role === 'user')
        preview = firstUser?.content.slice(0, 60) ?? ''
        const stat = fs.statSync(c.fullPath)
        mtime = new Date(stat.mtime).toISOString().slice(0, 19).replace('T', ' ')
      } catch {}
      const tag = c.isCurrent ? '🟢 현재' : c.isArchive ? '📦 아카이브' : '📁 다른 워크스페이스'
      return {
        label: `${tag} · ${count}msg · ${mtime}`,
        description: preview || c.basename,
        candidate: c,
        sortKey: mtime,
      }
    })
    // 최신 수정 순 정렬
    items.sort((a, b) => b.sortKey.localeCompare(a.sortKey))

    const picked = await vscode.window.showQuickPick(items, {
      title: '대화 복원 (현재 대화는 archive로 옮기고 선택본으로 교체)',
      placeHolder: '복원할 대화 선택',
    })
    if (!picked) return

    if (picked.candidate.isCurrent) {
      vscode.window.showInformationMessage('이미 현재 대화입니다.')
      return
    }

    const confirm = await vscode.window.showWarningMessage(
      `${picked.label}\n\n현재 대화는 archive로 옮기고 이걸로 교체할까요?`,
      { modal: true }, '복원',
    )
    if (confirm !== '복원') return

    await this.clearChat()
    try {
      const raw = fs.readFileSync(picked.candidate.fullPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this._messages = parsed
        this._compaction = undefined
      } else {
        this._messages = parsed.messages ?? []
        this._compaction = parsed.compaction
      }
      saveChatStorage(this._context, { messages: this._messages, compaction: this._compaction })
      this._post({ type: 'rehydrate', messages: this._messages })
      vscode.window.showInformationMessage(`✓ 복원됨 (${this._messages.length} msg)`)
    } catch (err) {
      vscode.window.showErrorMessage(`복원 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private _updateUsageStatusBar() {
    const usageText = this._usage.getFormattedSessionUsage()
    if (usageText) {
      this._statusBarItem.text = `$(notebook-cells-execute) ${usageText}`
    this._statusBarItem.tooltip = '현재 세션 AI 토큰 사용량 · 클릭해서 채팅 열기'
      this._statusBarItem.show()
    } else {
      this._statusBarItem.hide()
    }
  }

  setOverrideMode(mode: RouterMode) {
    this._override = mode
    this._post({ type: 'overrideChanged', mode })
  }

  setPermissionMode(mode: PermissionMode) {
    this._permissionMode = mode
    this._post({ type: 'permissionModeState', mode })
  }

  resolvePendingApproval(approved: boolean): boolean {
    const pending = this._pendingApproval
    if (!pending) return false
    this._pendingApproval = undefined
    pending.resolve(approved)
    this._post({ type: 'approvalResolved', id: pending.id, approved })
    return true
  }

  toggleFileContext() {
    this._useFileContext = !this._useFileContext
    this._post({ type: 'contextToggleState', enabled: this._useFileContext })
    this._notifyContextChange()
  }

  async showMcpTools() {
    const servers = this._mcp.configuredServers()
    if (servers.length === 0) {
      vscode.window.showInformationMessage('OrchestrAI MCP 서버가 설정되어 있지 않습니다.')
      return
    }

    const tools = await this._mcp.listTools()
    if (tools.length === 0) {
      vscode.window.showInformationMessage(`MCP 서버 ${servers.length}개가 설정됐지만 도구를 가져오지 못했어요.`)
      return
    }

    const picked = await vscode.window.showQuickPick(
      tools.map(t => ({
        label: `${t.server}.${t.name}`,
        description: t.description,
      })),
      { title: 'OrchestrAI MCP Tools' },
    )
    if (picked) vscode.window.showInformationMessage(picked.label)
  }

  async refreshMcp() {
    await this._mcp.refresh()
    const count = (await this._mcp.listTools()).length
    vscode.window.showInformationMessage(`OrchestrAI MCP refreshed: ${count} tools`)
  }

  dispose() {
    this._subscriptions.forEach(d => d.dispose())
    this._mcp.dispose()
    this._statusBarItem.dispose()
    void this._telegramBridge?.dispose()
    disposeCodexMcpClient()
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView
    this._chatKey = chatStateKey()
    const storage = loadChatStorage(this._context)
    this._messages = storage.messages
    this._compaction = storage.compaction
    this._webviewReady = false  // 새 webview면 다시 ready 신호 받아야 함
    this._lastWebviewReadyInstance = undefined
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    }
    webviewView.webview.html = this._getHtml()

    // 사이드바 가시성 바뀌어 webview 다시 그려질 때 (retainContextWhenHidden=true면 살아있어야 함)
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._webviewReady) {
        void this._pushWebviewState('visible')
      }
    })

    this._subscriptions.push(
      webviewView.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
          case 'webviewReady':
            if (msg.instanceId && msg.instanceId === this._lastWebviewReadyInstance) {
              log.info('persist', `webviewReady duplicate ignored (${msg.instanceId})`)
              break
            }
            this._webviewReady = true
            this._lastWebviewReadyInstance = msg.instanceId
            await this._pushWebviewState(`ready${msg.instanceId ? `:${msg.instanceId}` : ''}`)
            // Reload Window 직후 webview 의 message 핸들러가 100ms 안에 등록 안 돼 첫 push 가
            // 손실되는 케이스 방지 — 500ms / 1.5s 후 한 번씩 더 보낸다 (idempotent).
            setTimeout(() => void this._pushWebviewState('ready-retry-500ms'), 500)
            setTimeout(() => void this._pushWebviewState('ready-retry-1500ms'), 1500)
            break
          case 'requestRehydrate':
            // webview 가 비어있는데 disk 엔 데이터 있다고 판단되면 한 번 더 요청 (safety net)
            log.info('persist', `webview requested rehydrate explicitly`)
            await this._pushWebviewState('webview-request')
            break
          case 'send':          await this._handleSend(msg.text, msg.attachments ?? []); break
          case 'mentionCommand': await this._handleMentionCommand(msg.cmd); break
          case 'createPR':       await this._handleCreatePR(msg.titleHint ?? ''); break
          case 'setOverride':   this._override = msg.mode; break
          case 'toggleContext': this._useFileContext = msg.enabled; break
          case 'clearChat':
            await this.clearChat()
            break
          case 'requestUsage':
            this._post({ type: 'usage', session: this._usage.getSession(), plans: PLAN_INFO, startedAt: this._usage.sessionStartedAt })
            break
          case 'resetSessionUsage':
            this._usage.resetSession()
            this._updateUsageStatusBar()
            this._post({ type: 'usage', session: this._usage.getSession(), plans: PLAN_INFO, startedAt: this._usage.sessionStartedAt })
            break
          case 'loginClaude':
            await this._claudeAuth.login()
            await this._sendAuthStatus()
            break
          case 'loginCodex':
            await this._codexAuth.login()
            await this._sendAuthStatus()
            break
          case 'logoutClaude':
            await this._claudeAuth.logout()
            await this._sendAuthStatus()
            break
          case 'logoutCodex':
            await this._codexAuth.logout()
            await this._sendAuthStatus()
            break
          case 'loginGemini':
            await this._geminiAuth.login()
            await this._sendAuthStatus()
            break
          case 'logoutGemini':
            await this._geminiAuth.logout()
            await this._sendAuthStatus()
            break
          case 'openSettings':
            // 옛 경로 (호환). 새 webview는 인라인 모달 → settingsAction 보냄.
            await this._showAccountMenu()
            break
          case 'settingsAction':
            await this._handleSettingsAction(msg.action)
            break
          case 'stopArgue':
            this._argueStop = true
            break
          case 'stopGeneration':
            // 현재 진행 중인 모든 LLM 호출·툴 루프 즉시 중단
            this._argueStop = true   // argue도 같이 멈춤
            this._currentAbort?.abort()
            this._post({ type: 'generationStopped' })
            break
          case 'setPermissionMode':
            if (['ask', 'auto-edit', 'plan', 'smart-auto'].includes(msg.mode)) {
              this._permissionMode = msg.mode
              this._post({ type: 'permissionModeState', mode: this._permissionMode })
            }
            break
          case 'setEffortOverride':
            // null이면 자동 추론으로 복귀
            this._effortOverride = msg.effort ?? null
            this._post({ type: 'effortOverrideState', effort: this._effortOverride })
            break
          case 'requestModeState':
            this._post({ type: 'permissionModeState', mode: this._permissionMode })
            this._post({ type: 'effortOverrideState', effort: this._effortOverride })
            break
          case 'rollbackTurn':
            await this._rollbackTurn(msg.userId)
            break
          case 'openFile':
            await this._openWorkspaceFile(msg.path, msg.line)
            break
          case 'runCommand': {
            const term = vscode.window.createTerminal({ name: 'OrchestrAI Run', cwd: getWorkspaceRoot() ?? undefined })
            term.show()
            term.sendText(msg.command)
            break
          }
          case 'gitRevertToCommitParent':
            await this._gitRevertToCommitParent(msg.hash)
            break
          case 'gitShowCommit':
            await this._gitShowCommit(msg.hash)
            break
          case 'requestIndexCodebase':
            await this.indexCodebase()
            break
          case 'sendBackground': {
            // 백그라운드 작업 — _isSending lock 안 걸리는 별도 큐. 여러 개 동시 가능
            const text = msg.text ?? ''
            await this._startBackgroundTask(text)
            break
          }
          case 'requestBackgroundTasks':
            this._post({ type: 'backgroundTasks', tasks: [...this._backgroundTasks.values()] })
            break
          case 'cancelBackgroundTask':
            this._cancelBackgroundTask(msg.id)
            break
          case 'agentImport': {
            const url = msg.url ?? ''
            try {
              const agent = await fetchAgentFromUrl(url)
              addAgent(getStorageRoot(this._context), agent)
              setActiveAgent(getStorageRoot(this._context), agent.name)
              this._post({ type: 'toast', message: `✓ Agent "${agent.name}" import + 활성화` })
            } catch (err) {
              this._post({ type: 'toast', message: `Agent import 실패: ${err instanceof Error ? err.message : String(err)}` })
            }
            break
          }
          case 'agentList': {
            const store = loadAgentStore(getStorageRoot(this._context))
            this._post({ type: 'agentList', agents: store.agents, activeAgent: store.activeAgent })
            break
          }
          case 'agentSetActive':
            setActiveAgent(getStorageRoot(this._context), msg.name || undefined)
            this._post({ type: 'toast', message: msg.name ? `✓ Agent "${msg.name}" 활성화` : '활성 agent 해제' })
            break
          case 'agentRemove':
            removeAgent(getStorageRoot(this._context), msg.name)
            this._post({ type: 'toast', message: `Agent 삭제: ${msg.name}` })
            break
          case 'multiModelReview':
            this._isSending = true
            this._currentAbort = new AbortController()
            this._post({ type: 'generationStart' })
            try {
              await this.runMultiModelReview(msg.scope ?? 'lastCommit')
            } finally {
              this._isSending = false
              this._currentAbort = undefined
              this._post({ type: 'generationEnd' })
            }
            break
          case 'reviewChanges':
            await this._reviewChanges(msg.turnId, msg.path)
            break
        }
      }),
      // 에디터 변경 감지 - subscriptions에 등록해서 메모리 누수 방지
      vscode.window.onDidChangeActiveTextEditor(() => this._notifyContextChange()),
      vscode.window.onDidChangeTextEditorSelection(() => this._notifyContextChange()),
    )

    // 초기 상태 푸시는 webview의 webviewReady 시그널 받고 처리 (race 방지)
    // 안전망: 1.5초 안에 ready가 안 오면 그냥 보냄 (호환용)
    setTimeout(() => {
      if (!this._webviewReady) {
        log.warn('persist', 'webviewReady not received in 1.5s, force-sending initial state')
        void this._pushWebviewState('ready-timeout')
      }
    }, 1500)
  }

  private async _pushWebviewState(reason: string) {
    // 메모리 _messages가 빈 배열인데 디스크에는 살아있을 수 있음 (resolveWebviewView race / SDK 초기화 timing).
    // 매번 디스크에서 freshly 로드해서 메모리가 더 적으면 디스크 기준으로 sync.
    const fresh = loadChatStorage(this._context)
    if (fresh.messages.length > this._messages.length) {
      log.warn('persist', `memory had ${this._messages.length} but disk has ${fresh.messages.length} — restoring from disk`)
      this._messages = fresh.messages
      this._compaction = fresh.compaction
    }
    log.info('persist', `push webview state (${reason}) messages=${this._messages.length}, key=${this._chatKey}`)
    await this._sendAuthStatus()
    this._notifyContextChange()
    this._postContextGauge()
    this._post({ type: 'permissionModeState', mode: this._permissionMode })
    this._post({ type: 'effortOverrideState', effort: this._effortOverride })
    this._post({ type: 'rehydrate', messages: this._messages })
  }

  // ?? Auth ?????????????????????????????????????????????????????????

  private async _sendAuthStatus() {
    const status = await this._authStorage.getStatus()
    this._post({ type: 'authStatus', ...status })
  }

  private _recordSnapshot(turnId: string | undefined, relPath: string, before: string | null) {
    if (!turnId) return
    const snapshots = this._fileSnapshotsByTurn.get(turnId) ?? []
    const isFirstForTurn = snapshots.length === 0
    if (!snapshots.some(s => s.path === relPath)) {
      snapshots.push({ path: relPath, before })
      this._fileSnapshotsByTurn.set(turnId, snapshots)
      // 턴 당 첫 번째 파일 변경 시 자동 vscode.diff 열기 (setting on일 때만)
      if (isFirstForTurn && this._cfg<boolean>('autoOpenDiff') !== false) {
        void this._openLiveDiff(turnId, relPath, before).catch(err => log.warn('diff', 'auto-open failed:', err))
      }
    }
  }

  // 첫 변경 파일을 자동 vscode.diff 에디터로 열기 — Claude Code for VSCode 처럼 즉시 검토 가능
  private async _openLiveDiff(turnId: string, relPath: string, before: string | null) {
    try {
      const currentPath = resolveWorkspacePath(relPath)
      const reviewDir = path.join(this._context.globalStorageUri.fsPath, 'reviews', turnId)
      await fs.promises.mkdir(reviewDir, { recursive: true })
      const beforeName = relPath.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      const beforePath = path.join(reviewDir, `${beforeName}.before`)
      // 이미 있으면 덮어쓰지 않음 (같은 턴 같은 파일 재호출 방지)
      if (!fs.existsSync(beforePath)) {
        await fs.promises.writeFile(beforePath, before ?? '', 'utf8')
      }
      // 파일이 디스크에 쓰일 시간 약간 줌 (executeCodexTool은 바로 쓰지만 SDK 경로는 비동기)
      await new Promise(r => setTimeout(r, 100))
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(beforePath),
        vscode.Uri.file(currentPath),
        `OrchestrAI: ${relPath} (변경 검토)`,
        { preview: true, viewColumn: vscode.ViewColumn.Beside },
      )
    } catch (err) {
      log.warn('diff', `open live diff failed for ${relPath}:`, err)
    }
  }

  private _changedFilesForTurn(turnId: string | undefined): ChangedFile[] {
    if (!turnId) return []
    return (this._fileSnapshotsByTurn.get(turnId) ?? []).map(s => {
      let after = ''
      try {
        const target = resolveWorkspacePath(s.path)
        after = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
      } catch {}
      const stats = this._lineChangeStats(s.before, after)
      return {
        turnId,
        path: s.path,
        status: s.before === null ? 'added' : 'modified',
        additions: stats.additions,
        deletions: stats.deletions,
        preview: this._changePreview(s.before, after),
      }
    })
  }

  private _splitLines(value: string): string[] {
    const lines = value.replace(/\r\n/g, '\n').split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }

  private _lineChangeStats(before: string | null, after: string): { additions: number; deletions: number } {
    if (before === null) {
      return { additions: this._splitLines(after).length, deletions: 0 }
    }

    const oldLines = this._splitLines(before)
    const newLines = this._splitLines(after)
    let start = 0
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++

    let oldEnd = oldLines.length - 1
    let newEnd = newLines.length - 1
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
      oldEnd--
      newEnd--
    }

    return {
      additions: Math.max(0, newEnd - start + 1),
      deletions: Math.max(0, oldEnd - start + 1),
    }
  }

  private _changePreview(before: string | null, after: string, maxLines = 18): ChangedFile['preview'] {
    const oldLines = before === null ? [] : this._splitLines(before)
    const newLines = this._splitLines(after)
    const preview: ChangedFile['preview'] = []

    if (before === null) {
      for (let i = 0; i < Math.min(maxLines, newLines.length); i++) {
        preview.push({ type: 'add', newLine: i + 1, text: newLines[i] })
      }
      return preview
    }

    let start = 0
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++

    let oldEnd = oldLines.length - 1
    let newEnd = newLines.length - 1
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
      oldEnd--
      newEnd--
    }

    const beforeContext = Math.max(0, start - 3)
    for (let i = beforeContext; i < start && preview.length < maxLines; i++) {
      preview.push({ type: 'ctx', oldLine: i + 1, newLine: i + 1, text: oldLines[i] })
    }

    for (let i = start; i <= oldEnd && preview.length < maxLines; i++) {
      preview.push({ type: 'del', oldLine: i + 1, text: oldLines[i] })
    }

    for (let i = start; i <= newEnd && preview.length < maxLines; i++) {
      preview.push({ type: 'add', newLine: i + 1, text: newLines[i] })
    }

    const afterStart = Math.max(oldEnd + 1, start)
    for (let i = afterStart; i < oldLines.length && preview.length < maxLines; i++) {
      const newLine = i + (newEnd - oldEnd)
      preview.push({ type: 'ctx', oldLine: i + 1, newLine: newLine + 1, text: oldLines[i] })
    }

    return preview
  }

  private _changeSummaryForTurn(turnId: string | undefined): ChangeSummary | undefined {
    if (!turnId) return undefined
    const snapshots = this._fileSnapshotsByTurn.get(turnId) ?? []
    if (snapshots.length === 0) return undefined

    let additions = 0
    let deletions = 0
    const paths: string[] = []

    for (const snap of snapshots) {
      paths.push(snap.path)
      let after = ''
      try {
        const target = resolveWorkspacePath(snap.path)
        after = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
      } catch {}
      const stats = this._lineChangeStats(snap.before, after)
      additions += stats.additions
      deletions += stats.deletions
    }

    return {
      turnId,
      files: paths.length,
      additions,
      deletions,
      paths,
    }
  }

  private async _reviewChanges(turnId?: string, requestedPath?: string) {
    const snapshots = turnId ? (this._fileSnapshotsByTurn.get(turnId) ?? []) : []
    const paths = snapshots.map(s => s.path)

    if (snapshots.length === 0) {
      await vscode.commands.executeCommand('workbench.view.scm')
      this._post({ type: 'toast', message: 'Source Control에서 변경 사항을 확인하세요.' })
      return
    }

    let selectedPath = requestedPath
    if (!selectedPath && snapshots.length > 1) {
      const picked = await vscode.window.showQuickPick(
        paths.map(p => ({ label: p, path: p })),
        { title: '변경 사항 검토' },
      )
      selectedPath = picked?.path
    } else if (!selectedPath) {
      selectedPath = snapshots[0].path
    }
    if (!selectedPath) return

    const snap = snapshots.find(s => s.path === selectedPath)
    if (!snap) return

    try {
      const currentPath = resolveWorkspacePath(snap.path)
      const reviewDir = path.join(this._context.globalStorageUri.fsPath, 'reviews', turnId ?? 'latest')
      await fs.promises.mkdir(reviewDir, { recursive: true })
      const beforeName = snap.path.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      const beforePath = path.join(reviewDir, `${beforeName}.before`)
      await fs.promises.writeFile(beforePath, snap.before ?? '', 'utf8')
      await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(beforePath),
        vscode.Uri.file(currentPath),
        `OrchestrAI Changes: ${snap.path}`,
        { preview: false },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this._post({ type: 'toast', message: `변경 사항 검토 실패: ${message}` })
    }
  }

  private async _openWorkspaceFile(rawPath: string, line?: number | null) {
    try {
      const isAbsolute = /^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith('/') || rawPath.startsWith('\\\\')
      const root = getWorkspaceRoot() ?? process.cwd()

      // 후보 경로 여러 개 시도 — 첫 번째 존재하는 파일 사용
      const candidates: string[] = []
      if (isAbsolute) {
        candidates.push(rawPath)
      } else {
        const normalized = rawPath.replace(/^[\\/]+/, '').replace(/\\/g, '/')
        // 1. 워크스페이스 루트 기준
        candidates.push(path.resolve(root, normalized))
        // 2. 첫 segment가 워크스페이스 폴더명과 같거나 비슷하면 그 segment 빼고 시도 (모델이 prefix 잘못 붙이는 케이스)
        const parts = normalized.split('/')
        if (parts.length > 1) {
          const tail = parts.slice(1).join('/')
          candidates.push(path.resolve(root, tail))
        }
        // 3. 워크스페이스 부모 기준 (rare)
        candidates.push(path.resolve(path.dirname(root), normalized))
        // 4. cwd 기준 (절대경로 아닌데 위 다 fail 시)
        candidates.push(path.resolve(process.cwd(), normalized))
      }

      // 워크스페이스 boundary 존중 — 절대경로지만 워크스페이스 밖이면 거부
      const target = candidates.find(p => {
        if (!fs.existsSync(p)) return false
        if (!isAbsolute) {
          // 상대경로 후보는 워크스페이스 내부여야
          const rel = path.relative(root, p)
          if (rel.startsWith('..')) return false
        }
        return true
      })

      if (!target) {
        this._post({ type: 'toast', message: `파일 없음: ${rawPath}` })
        return
      }

      const doc = await vscode.workspace.openTextDocument(target)
      const editor = await vscode.window.showTextDocument(doc, { preview: false })
      // 라인 정보 있으면 해당 라인으로 점프
      if (typeof line === 'number' && line > 0) {
        const pos = new vscode.Position(Math.max(0, line - 1), 0)
        editor.selection = new vscode.Selection(pos, pos)
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this._post({ type: 'toast', message: `열기 실패: ${message}` })
    }
  }

  private async _rollbackTurn(userId: string) {
    const startIndex = this._messages.findIndex(m => m.id === userId && m.role === 'user')
    if (startIndex < 0) {
      this._post({ type: 'rollbackResult', ok: false, message: '되돌릴 메시지를 찾지 못했어요.' })
      return
    }

    const turnIds = this._messages
      .slice(startIndex)
      .filter(m => m.role === 'user')
      .map(m => m.id)

    const snapshots = turnIds.flatMap(id => this._fileSnapshotsByTurn.get(id) ?? []).reverse()
    let restored = 0

    for (const snap of snapshots) {
      const target = resolveWorkspacePath(snap.path)
      if (snap.before === null) {
        await fs.promises.rm(target, { force: true }).catch(() => undefined)
      } else {
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await fs.promises.writeFile(target, snap.before, 'utf8')
      }
      restored++
    }

    for (const id of turnIds) this._fileSnapshotsByTurn.delete(id)
    this._messages = this._messages.slice(0, startIndex)
    await this._persistMessages()
    this._post({ type: 'rehydrate', messages: this._messages })
    this._post({ type: 'rollbackResult', ok: true, message: `${restored}개 파일 변경을 되돌렸어요.` })
  }

  // 인라인 설정 모달에서 보낸 액션 처리 — VSCode QuickPick 안 띄우고 바로 서브플로로 진입
  private async _handleSettingsAction(action: string) {
    switch (action) {
      case 'accounts':       await this._showAccountSubmenu(); break
      case 'mcp':            await this._showMcpMenu(); break
      case 'telegram':       await this._showTelegramMenu(); break
      case 'restoreArchive': await this.restoreArchive(); break
      case 'openArchives':   await this.openArchives(); break
      case 'logs':           log.show(); break
      case 'resetUsage':
        this._usage.resetSession()
        this._updateUsageStatusBar()
        this._post({ type: 'usage', session: this._usage.getSession(), plans: PLAN_INFO, startedAt: this._usage.sessionStartedAt })
        vscode.window.showInformationMessage('Session usage reset')
        break
    }
  }

  // 계층화된 설정 메뉴 — 채팅창 좌하단 톱니 버튼에서 호출 (옛 호환)
  private async _showAccountMenu() {
    const status = await this._authStorage.getStatus()
    const mcpCount = this._mcp.configuredServers().length

    const tgCfg = await this._authStorage.getTelegramConfig()
    const items: Array<vscode.QuickPickItem & { action: string }> = [
      { label: '$(account) Accounts', description: `Claude ${status.claude ? 'on' : 'off'} - Codex ${status.codex ? 'on' : 'off'} - Gemini ${status.gemini ? 'on' : 'off'}`, action: 'accounts' },
      { label: '$(plug) MCP servers', description: `${mcpCount} configured`, action: 'mcp' },
      { label: '$(send) Telegram', description: tgCfg ? `Connected (${tgCfg.workspaceName})` : 'Connect remote chat', action: 'telegram' },
      { label: '$(history) Restore archive', description: 'Restore a saved chat archive', action: 'restoreArchive' },
      { label: '$(folder-opened) Open archives folder', description: 'Open saved JSON chat files', action: 'openArchives' },
      { label: '$(output) Show logs', description: 'OrchestrAI Output Channel', action: 'logs' },
      { label: '$(refresh) Reset usage', description: 'Reset session token counters', action: 'resetUsage' },
    ]
    const picked = await vscode.window.showQuickPick(items, { title: 'OrchestrAI 설정' })
    if (!picked) return

    switch (picked.action) {
      case 'accounts':       await this._showAccountSubmenu(); break
      case 'mcp':            await this._showMcpMenu(); break
      case 'telegram':       await this._showTelegramMenu(); break
      case 'restoreArchive': await this.restoreArchive(); break
      case 'openArchives':   await this.openArchives(); break
      case 'logs':           log.show(); break
      case 'resetUsage':
        this._usage.resetSession()
        this._updateUsageStatusBar()
        this._post({ type: 'usage', session: this._usage.getSession(), plans: PLAN_INFO, startedAt: this._usage.sessionStartedAt })
        vscode.window.showInformationMessage('Session usage reset')
        break
    }
  }

  private async _showAccountSubmenu() {
    const status = await this._authStorage.getStatus()
    const items: Array<vscode.QuickPickItem & { action: string }> = [
      { label: '$(info) 계정 정보 보기', description: '이메일·플랜 표시', action: 'viewInfo' },
      { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' } as any,
      status.claude
        ? { label: 'Claude logout', description: 'Connected', action: 'logoutClaude' }
        : { label: 'Claude login', description: 'Use local Claude Code auth', action: 'loginClaude' },
      status.codex
        ? { label: 'Codex logout', description: 'Connected with ChatGPT', action: 'logoutCodex' }
        : { label: 'Codex login', description: 'Sign in with ChatGPT', action: 'loginCodex' },
      status.gemini
        ? { label: 'Gemini logout', description: 'Connected', action: 'logoutGemini' }
        : { label: 'Gemini login', description: 'Use local Gemini CLI auth', action: 'loginGemini' },
      { label: 'Gemini API key', description: 'Optional image generation key', action: 'geminiApiKey' },
    ]
    const picked = await vscode.window.showQuickPick(items, { title: 'OrchestrAI 계정' })
    if (!picked) return
    switch (picked.action) {
      case 'viewInfo':     await this.showAccounts();        break
      case 'loginClaude':  await this._claudeAuth.login();  break
      case 'logoutClaude': await this._claudeAuth.logout(); break
      case 'loginCodex':   await this._codexAuth.login();   break
      case 'logoutCodex':  await this._codexAuth.logout();  break
      case 'loginGemini':  await this._geminiAuth.login();  break
      case 'logoutGemini': await this._geminiAuth.logout(); break
      case 'geminiApiKey': await this._configureGeminiApiKey(); break
    }
    await this._sendAuthStatus()
  }

  private async _configureGeminiApiKey() {
    const existing = await this._authStorage.getGeminiApiKey()
    if (existing) {
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(edit) Replace', action: 'replace' as const },
          { label: '$(trash) Delete', action: 'delete' as const },
          { label: '$(check) Show masked key', action: 'show' as const },
        ],
        { title: 'Gemini API key' },
      )
      if (!action) return
      if (action.action === 'show') {
        const masked = `${existing.slice(0, 4)}...${existing.slice(-4)} (${existing.length} chars)`
        vscode.window.showInformationMessage(`Saved key: ${masked}`)
        return
      }
      if (action.action === 'delete') {
        await this._authStorage.deleteGeminiApiKey()
        setGeminiApiKey(null)
        vscode.window.showInformationMessage('Gemini API key deleted')
        return
      }
    }
    const key = await vscode.window.showInputBox({
      title: 'Gemini API key',
      prompt: 'Starts with AIzaSy... from https://aistudio.google.com/apikey',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => !v?.trim() ? 'Key is required' : v.trim().length < 20 ? 'Key is too short' : null,
    })
    if (!key) return
    await this._authStorage.setGeminiApiKey(key.trim())
    setGeminiApiKey(key.trim())
    vscode.window.showInformationMessage('Gemini API key saved — 텍스트 호출에도 사용됩니다 (한도 ↑)')
  }

  // ── MCP 서버 관리 ──────────────────────────────
  private async _showMcpMenu() {
    const servers = this._cfg<Record<string, McpServerConfig>>('mcpServers') ?? {}
    const names = Object.keys(servers)

    const items: Array<vscode.QuickPickItem & { action: string; key?: string }> = [
      { label: '$(add) Add MCP server', description: 'Enter name, command, args, and env', action: 'add' },
      { label: '$(list-tree) Show available tools', description: `${names.length} servers configured`, action: 'tools' },
      { label: '$(refresh) Refresh MCP servers', description: 'Clear cache and reconnect', action: 'refresh' },
      ...names.map(name => ({
        label: `$(server-process) ${name}`,
        description: `${servers[name].command} ${(servers[name].args ?? []).join(' ')}`.slice(0, 80),
        action: 'edit',
        key: name,
      })),
    ]

    const picked = await vscode.window.showQuickPick(items, { title: 'MCP servers' })
    if (!picked) return

    switch (picked.action) {
      case 'add':     await this._addMcpServer(); break
      case 'tools':   await this.showMcpTools(); break
      case 'refresh': await this.refreshMcp(); break
      case 'edit':    if (picked.key) await this._editMcpServer(picked.key); break
    }
  }

  private async _addMcpServer() {
    const name = await vscode.window.showInputBox({
      title: 'Add MCP server - name',
      prompt: 'Alias for this server, e.g. filesystem or github',
      validateInput: (v) => !v.trim() ? 'Name is required' : null,
    })
    if (!name) return

    const command = await vscode.window.showInputBox({
      title: `Add MCP server (${name}) - command`,
      prompt: 'Command to run, e.g. npx, node, python',
      validateInput: (v) => !v.trim() ? 'Command is required' : null,
    })
    if (!command) return

    const argsRaw = await vscode.window.showInputBox({
      title: `Add MCP server (${name}) - args`,
      prompt: 'Space-separated args. ${workspaceFolder} is supported.',
      value: '',
    })
    if (argsRaw === undefined) return
    const args = argsRaw.trim() ? argsRaw.trim().split(/\s+/) : []

    const envRaw = await vscode.window.showInputBox({
      title: `Add MCP server (${name}) - env (optional)`,
      prompt: 'JSON object, e.g. {"API_KEY":"xxx"}. Empty to skip.',
      value: '',
    })
    if (envRaw === undefined) return
    let env: Record<string, string> | undefined
    if (envRaw.trim()) {
      try { env = JSON.parse(envRaw) } catch {
        vscode.window.showErrorMessage('env must be valid JSON.')
        return
      }
    }

    const existing = this._cfg<Record<string, McpServerConfig>>('mcpServers') ?? {}
    const next = { ...existing, [name]: { command, args, ...(env ? { env } : {}) } }
    await vscode.workspace.getConfiguration('orchestrai').update(
      'mcpServers',
      next,
      vscode.ConfigurationTarget.Global,
    )
    await this._mcp.refresh()
    vscode.window.showInformationMessage(`MCP server "${name}" added`)
  }

  private async _editMcpServer(key: string) {
    const existing = this._cfg<Record<string, McpServerConfig>>('mcpServers') ?? {}
    const cfg = existing[key]
    if (!cfg) return

    const action = await vscode.window.showQuickPick(
      [
        { label: '$(trash) Delete', action: 'delete' as const },
        { label: '$(edit) Edit in settings.json', action: 'openSettings' as const },
      ],
      { title: `MCP: ${key}` },
    )
    if (!action) return

    if (action.action === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `Delete MCP server "${key}"?`, { modal: true }, 'Delete',
      )
      if (confirm !== 'Delete') return
      const next = { ...existing }
      delete next[key]
      await vscode.workspace.getConfiguration('orchestrai').update(
        'mcpServers', next, vscode.ConfigurationTarget.Global,
      )
      await this._mcp.refresh()
      vscode.window.showInformationMessage(`MCP server "${key}" deleted`)
    } else {
      await vscode.commands.executeCommand('workbench.action.openSettingsJson')
    }
  }

  // ?? Context ??????????????????????????????????????????????????????

  private _notifyContextChange() {
    const ctx = getActiveFileContext()
    const selectionLines = ctx?.selectedText ? ctx.selectedText.split('\n').length : 0
    this._post({
      type: 'contextChanged',
      fileName: ctx?.fileName ?? null,
      language: ctx?.language ?? null,
      hasSelection: !!ctx?.selectedText,
      selectionLines,
      cursorLine: ctx?.cursorLine ?? null,
    })
  }

  // ?? Send ?????????????????????????????????????????????????????????

  // /pr [title] — 현재 branch 의 commit 들 보고 AI 가 title/body 생성 + gh pr create
  // log 변수와 log import 가 같은 이름이라 helper 로 분리
  private async _handleCreatePR(titleHint: string) {
    const log_warn_pr = (err: unknown) => log.warn('pr', `AI title 생성 실패: ${err instanceof Error ? err.message : err}`)
    const root = getWorkspaceRoot()
    if (!root) { vscode.window.showWarningMessage('워크스페이스 없음'); return }
    const { spawn } = require('child_process') as typeof import('child_process')
    const run = (cmd: string, args: string[]): Promise<{ out: string; code: number }> => new Promise(resolve => {
      const p = spawn(cmd, args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, shell: process.platform === 'win32' })
      let out = ''
      p.stdout.on('data', (c: Buffer) => out += c.toString('utf8'))
      p.stderr.on('data', (c: Buffer) => out += c.toString('utf8'))
      p.on('exit', (code) => resolve({ out, code: code ?? 1 }))
      p.on('error', () => resolve({ out: '', code: 1 }))
    })

    // 1. gh CLI 있는지 확인
    const ghCheck = await run('gh', ['--version'])
    if (ghCheck.code !== 0) {
      vscode.window.showErrorMessage('gh CLI 가 설치 안 됨. https://cli.github.com 에서 설치 후 `gh auth login`')
      return
    }

    // 2. 현재 branch 정보
    const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
    if (!branch || branch === 'HEAD') {
      vscode.window.showErrorMessage('현재 detached HEAD — branch 에 있을 때 PR 생성 가능')
      return
    }

    // 3. main 과의 diff
    const baseBranch = (await run('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'])).out.trim().replace('refs/remotes/origin/', '') || 'main'
    const commits = (await run('git', ['log', `${baseBranch}..HEAD`, '--oneline'])).out.trim()
    const diffStat = (await run('git', ['diff', '--stat', `${baseBranch}..HEAD`])).out.trim()

    if (!commits) {
      vscode.window.showWarningMessage(`${branch} 가 ${baseBranch} 와 같음. PR 만들 commit 없음`)
      return
    }

    // 4. push 안 했으면 push
    const pushResult = await run('git', ['push', '-u', 'origin', branch])
    if (pushResult.code !== 0 && !pushResult.out.includes('up-to-date')) {
      vscode.window.showWarningMessage(`git push 실패: ${pushResult.out.slice(0, 200)}`)
      // 그래도 PR 생성 시도 — 이미 push 된 상태일 수 있음
    }

    // 5. AI 한테 title/body 생성 요청 (Haiku 사용 — 빠르고 싸고)
    const claudeToken = await this._claudeAuth.getAccessToken()
    if (!claudeToken) {
      // Claude 없으면 사용자한테 직접 입력 받음
      const title = titleHint || await vscode.window.showInputBox({ title: 'PR title', value: branch.replace(/[-_/]/g, ' ') }) || branch
      const body = `Branch: \`${branch}\`\n\n## Commits\n\`\`\`\n${commits}\n\`\`\`\n\n## Diff stat\n\`\`\`\n${diffStat}\n\`\`\``
      const create = await run('gh', ['pr', 'create', '--title', title, '--body', body])
      if (create.code === 0) {
        vscode.window.showInformationMessage('✅ PR 생성됨', 'Open').then(s => { if (s) vscode.env.openExternal(vscode.Uri.parse(create.out.trim())) })
      } else {
        vscode.window.showErrorMessage(`PR 생성 실패: ${create.out.slice(0, 300)}`)
      }
      return
    }

    // Claude Haiku 로 title/body 생성
    vscode.window.showInformationMessage('🤖 PR title/body 생성 중...')
    let aiTitle = titleHint, aiBody = ''
    try {
      const sysPrompt = `Generate a PR title and body from these commits. Return EXACTLY this format:
TITLE: <one-line summary, ≤72 chars>
BODY:
<markdown body — bullet list of changes + test plan checklist>

Be concise. Use conventional commit style if commits do.`
      const userPrompt = `Branch: ${branch} → ${baseBranch}\n\nCommits:\n${commits}\n\nDiff stat:\n${diffStat}\n\n${titleHint ? `Hint: ${titleHint}` : ''}`
      const res = await callClaude(
        [{ role: 'user', content: userPrompt }],
        'low',
        claudeToken,
        () => {},
        sysPrompt,
        'auto-edit',
        undefined,
        undefined,
      )
      const m = res.content.match(/TITLE:\s*(.+?)\s*\n+BODY:\s*([\s\S]*)/i)
      if (m) {
        aiTitle = m[1].trim()
        aiBody = m[2].trim()
      } else {
        aiTitle = titleHint || branch
        aiBody = res.content
      }
    } catch (err) {
      log_warn_pr(err)
      aiTitle = titleHint || branch
      aiBody = `## Commits\n\`\`\`\n${commits}\n\`\`\``
    }

    // 6. gh pr create
    const create = await run('gh', ['pr', 'create', '--title', aiTitle, '--body', aiBody])
    if (create.code === 0) {
      const url = create.out.trim()
      vscode.window.showInformationMessage(`✅ PR 생성됨: ${aiTitle}`, 'Open in browser').then(s => {
        if (s) vscode.env.openExternal(vscode.Uri.parse(url))
      })
      this._post({ type: 'toast', message: `✅ PR 생성: ${url}` })
    } else {
      vscode.window.showErrorMessage(`PR 생성 실패: ${create.out.slice(0, 300)}`)
    }
  }

  // @ commands — 입력창에 첨부 텍스트 삽입 후 사용자가 보내기 (Continue 스타일).
  private async _handleMentionCommand(cmd: string) {
    const root = getWorkspaceRoot()
    let attachText: string | null = null

    try {
      switch (cmd) {
        case 'file': {
          // 파일 picker — 워크스페이스 안 파일 다중 선택 가능
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: root ? vscode.Uri.file(root) : undefined,
            openLabel: 'Attach to chat',
          })
          if (!picked || picked.length === 0) return
          const blocks: string[] = []
          for (const uri of picked.slice(0, 5)) {  // 최대 5개
            try {
              const content = fs.readFileSync(uri.fsPath, 'utf8')
              const rel = root ? path.relative(root, uri.fsPath).replace(/\\/g, '/') : path.basename(uri.fsPath)
              const lang = (rel.split('.').pop() ?? '').toLowerCase()
              blocks.push(`### ${rel}\n\`\`\`${lang}\n${content.slice(0, 50_000)}\n\`\`\``)
            } catch (err) {
              blocks.push(`### ${uri.fsPath}\n(read failed: ${err instanceof Error ? err.message : err})`)
            }
          }
          attachText = blocks.join('\n\n')
          break
        }
        case 'codebase': {
          // 사용자에게 검색어 받음 → RAG 검색 결과 첨부
          const query = await vscode.window.showInputBox({
            title: '@codebase — 검색어',
            prompt: '어떤 코드를 찾을까요? (예: "OAuth flow", "database connection")',
            ignoreFocusOut: true,
          })
          if (!query) return
          if (!this._codebaseIndex) {
            vscode.window.showWarningMessage('코드베이스 인덱싱 안 됨. Command Palette → "OrchestrAI: 코드베이스 인덱싱"')
            return
          }
          const apiKey = await this._authStorage.getGeminiApiKey()
          if (!apiKey) {
            vscode.window.showWarningMessage('Gemini API key 필요 (RAG 검색용). 계정 설정에서 입력.')
            return
          }
          const result = await retrieve(this._codebaseIndex, query, apiKey, { topK: 8 })
          if (result.chunks.length === 0) {
            attachText = `(@codebase "${query}" — 결과 없음)`
          } else {
            attachText = `## @codebase: ${query}\n\n` + result.chunks.map(h =>
              `### ${h.path}:${h.startLine}-${h.endLine} (score ${h.score.toFixed(2)})\n\`\`\`\n${h.text.slice(0, 2000)}\n\`\`\``,
            ).join('\n\n')
          }
          break
        }
        case 'terminal': {
          // 활성 terminal 의 select 영역 — 사용자가 미리 select 해놨어야 함.
          // VSCode API 가 terminal selection 직접 노출 안 함 → copySelection 명령으로 클립보드에 복사 후 읽기
          await vscode.commands.executeCommand('workbench.action.terminal.copySelection').then(undefined, () => {})
          const clip = await vscode.env.clipboard.readText()
          if (!clip || !clip.trim()) {
            vscode.window.showWarningMessage('터미널에서 텍스트 먼저 select 해주세요. (Ctrl+A 로 전체 선택 가능)')
            return
          }
          attachText = `## @terminal\n\`\`\`\n${clip.slice(0, 30_000)}\n\`\`\``
          break
        }
        case 'git': {
          // git status + diff 를 첨부
          if (!root) { vscode.window.showWarningMessage('워크스페이스 없음'); return }
          const { spawn } = require('child_process') as typeof import('child_process')
          const run = (args: string[]): Promise<string> => new Promise(resolve => {
            const p = spawn('git', args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
            let out = ''
            p.stdout.on('data', (c: Buffer) => out += c.toString('utf8'))
            p.stderr.on('data', (c: Buffer) => out += c.toString('utf8'))
            p.on('exit', () => resolve(out))
            p.on('error', () => resolve(''))
          })
          const status = await run(['status', '-sb'])
          const diff = await run(['diff', '--stat'])
          const log = await run(['log', '--oneline', '-10'])
          attachText = `## @git\n\n### status\n\`\`\`\n${status.slice(0, 5000)}\n\`\`\`\n\n### diff (stat)\n\`\`\`\n${diff.slice(0, 5000)}\n\`\`\`\n\n### last 10 commits\n\`\`\`\n${log.slice(0, 5000)}\n\`\`\``
          break
        }
        case 'web': {
          const url = await vscode.window.showInputBox({
            title: '@web — URL fetch',
            prompt: 'fetch 할 URL 입력',
            ignoreFocusOut: true,
            validateInput: (v) => /^https?:\/\//.test(v?.trim() ?? '') ? null : 'http(s):// 로 시작해야 함',
          })
          if (!url) return
          try {
            const r = await fetch(url)
            const text = await r.text()
            // HTML → 대충 plain (간단 stripping; 정교 파싱은 사용자가 모델한테 시키면 됨)
            const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            attachText = `## @web ${url}\n\n${stripped.slice(0, 30_000)}`
          } catch (err) {
            attachText = `## @web ${url}\n\n(fetch 실패: ${err instanceof Error ? err.message : err})`
          }
          break
        }
        case 'problem': {
          // VS Code Problems 패널의 진단 (전체 워크스페이스)
          const all = vscode.languages.getDiagnostics()
          const lines: string[] = []
          for (const [uri, diags] of all) {
            if (diags.length === 0) continue
            const rel = root ? path.relative(root, uri.fsPath).replace(/\\/g, '/') : uri.fsPath
            for (const d of diags) {
              const sev = d.severity === 0 ? 'ERROR' : d.severity === 1 ? 'WARN' : 'INFO'
              lines.push(`[${sev}] ${rel}:${d.range.start.line + 1}:${d.range.start.character + 1} — ${d.message}`)
            }
          }
          attachText = lines.length > 0
            ? `## @problem (${lines.length} diagnostics)\n\`\`\`\n${lines.slice(0, 100).join('\n')}\n\`\`\``
            : '## @problem\n(현재 진단 없음 — 깨끗합니다)'
          break
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`@${cmd} 실패: ${err instanceof Error ? err.message : err}`)
      return
    }

    if (attachText) {
      // webview 입력창에 attach text append
      this._post({ type: 'appendInput', text: attachText })
    }
  }

  private async _handleSend(userText: string, attachments: ImageAttachment[] = []) {
    if (!userText.trim() && attachments.length === 0) return

    if (this._isSending) {
      this._post({ type: 'blocked', reason: 'Wait for the current response to finish' })
      return
    }
    this._isSending = true
    // 새 generation 시작 시 abort 가능하게 controller 초기화
    this._currentAbort = new AbortController()
    this._post({ type: 'generationStart' })  // UI: stop 버튼 켜기

    // 자동 diff: send 동안 변경된 첫 파일을 git.openChange로 띄움 (engine 무관)
    const autoDiff = this._cfg<boolean>('autoOpenDiff') !== false
    let watcher: vscode.FileSystemWatcher | undefined
    let diffOpenedThisTurn = false
    if (autoDiff) {
      try {
        watcher = vscode.workspace.createFileSystemWatcher('**')
        const tryOpenDiff = async (uri: vscode.Uri) => {
          if (diffOpenedThisTurn) return
          if (uri.scheme !== 'file') return
          const root = getWorkspaceRoot()
          if (!root) return
          // 워크스페이스 안 파일만
          const rel = path.relative(root, uri.fsPath)
          if (rel.startsWith('..') || path.isAbsolute(rel)) return
          // node_modules / .git 등 무시
          if (/(?:^|[\\/])(node_modules|\.git|dist|out|\.vscode)[\\/]/.test(rel)) return
          diffOpenedThisTurn = true
          try {
            await vscode.commands.executeCommand('git.openChange', uri)
            log.info('diff', `auto-opened diff for ${rel}`)
          } catch (err) {
            log.warn('diff', `git.openChange failed (no git? falling back to file open):`, err)
            try { await vscode.commands.executeCommand('vscode.open', uri) } catch {}
          }
        }
        watcher.onDidChange(tryOpenDiff)
        watcher.onDidCreate(tryOpenDiff)
      } catch (err) {
        log.warn('diff', 'failed to create file watcher:', err)
      }
    }

    try {
      await this._doSend(userText, attachments)
    } finally {
      this._isSending = false
      this._currentAbort = undefined
      this._post({ type: 'sendUnlocked' })
      this._post({ type: 'generationEnd' })  // UI: stop 버튼 끄기
      if (watcher) watcher.dispose()
    }
  }

  private async _doSend(userText: string, attachments: ImageAttachment[] = []) {
    const fileCtx = this._useFileContext ? getActiveFileContext() : null
    // 유저가 수동 override 있으면 그거 우선, 없으면 본문에서 추론
    const inferredEffort: Effort = this._effortOverride ?? inferEffort(userText)

    // RAG: 코드베이스 인덱스가 있으면 관련 파일 자동 검색 → 시스템 프롬프트에 첨부
    let ragContext = ''
    if (this._codebaseIndex && this._cfg<boolean>('codebaseRag.enabled') !== false) {
      const apiKey = await this._authStorage.getGeminiApiKey()
      if (apiKey) {
        try {
          const result = await retrieve(this._codebaseIndex, userText, apiKey, { topK: 6 })
          if (result.contextBlock) {
            ragContext = result.contextBlock
            this._post({
              type: 'ragRetrieved',
              chunks: result.chunks.map(c => ({ path: c.path, startLine: c.startLine, endLine: c.endLine, score: c.score })),
            })
          }
        } catch (err) {
          log.warn('rag', `retrieve failed:`, err)
        }
      }
    }
    // ragContext는 system prompt에 첨부됨 (buildSystemPrompt + 별도 prepend로)
    ;(this as any)._ragContextForCurrentTurn = ragContext

    if (fileCtx) {
      this._post({
        type: 'contextUsed',
        fileName: fileCtx.fileName,
        hasSelection: !!fileCtx.selectedText,
        isTruncated: fileCtx.isTruncated,
      })
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
      attachments,
      timestamp: Date.now(),
    }
    this._messages.push(userMsg)
    await this._persistMessages()
    this._post({ type: 'userMessage', message: userMsg })

    // auto-argue escalate 는 비활성화 — 사용자 짜증 유발. 멀티모델 원하면 argue 버튼 직접 누르기.
    const runtimeOverride = this._override

    // ── argue 모드: 로그인된 모델들이 라운드 로빈으로 서로 반박/보완 ──
    // 매 턴마다 Claude Haiku 판정이 0~10점 채점 → UI 스코어보드로 실시간 노출
    if (runtimeOverride === 'argue') {
      const status = await this._authStorage.getStatus()
      const order: Model[] = []
      if (status.claude) order.push('claude')
      if (status.codex)  order.push('codex')
      if (status.gemini) order.push('gemini')

      if (order.length < 2) {
        this._post({ type: 'streamError', id: 'argue', error: 'argue 모드는 최소 2개 모델 로그인 필요' })
        return
      }

      this._argueStop = false
      this._inArgue = true
      this._usage.resetArgue()
      this._post({ type: 'argueStart', models: order })
      const MAX_TURNS = 6
      const argueTurns: Array<{ model: Model; text: string; msgIndex: number }> = []
      const scoresByModel: Record<Model, { total: number; turns: number }> = {
        claude: { total: 0, turns: 0 },
        codex:  { total: 0, turns: 0 },
        gemini: { total: 0, turns: 0 },
      }

      const skippedModels = new Set<Model>()
      for (let i = 0; i < MAX_TURNS; i++) {
        if (this._argueStop) break
        const model = order[i % order.length]
        // 한 번 실패한 모델은 이 argue 세션에서 스킵 (같은 safety 필터면 계속 막힐 가능성)
        if (skippedModels.has(model)) continue
        const decision: RoutingDecision = {
          model, effort: inferredEffort, confidence: 1.0,
          reason: i === 0 ? 'argue-open' : 'argue-reply',
        }
        this._postRoutingDecision(decision)
        const prevLen = this._messages.length
        // argue 는 모델 분담이 의미 — fallback 으로 다른 모델이 답하면 hallucination 유발 → noFallback
        const ok = await this._runTurn(decision, fileCtx, i === 0 ? 'first' : 'reply', userMsg.id, undefined, true)
        if (!ok) {
          // 다른 모델은 계속 돌려야 하니 여기 break 안 하고 그 모델만 스킵
          skippedModels.add(model)
          // 모든 모델 스킵됐으면 argue 종료
          if (skippedModels.size >= order.length) break
          continue
        }

        // 방금 추가된 assistant 메시지 찾기
        const lastMsg = this._messages[this._messages.length - 1]
        if (lastMsg?.role === 'assistant') {
          argueTurns.push({ model: lastMsg.model ?? model, text: lastMsg.content, msgIndex: prevLen })

        // 판정 호출 (비동기로 돌려도 되지만 UX는 라인별로 점수 다는 게 직관적)
          const priorForJudge = argueTurns.slice(0, -1).map(t => ({ model: t.model, text: t.text }))
          this._post({ type: 'argueJudging', model })
          const verdict = await judgeTurn(userText, model, lastMsg.content, priorForJudge)
          if (verdict) {
            scoresByModel[model].total += verdict.score
            scoresByModel[model].turns += 1
            this._post({
              type: 'argueScore',
              msgId: lastMsg.id,
              verdict,
              scoreboard: scoresByModel,
            })
          }
        }
      }

      this._inArgue = false
      this._post({ type: 'argueEnd', scoreboard: scoresByModel })
      return
    }

    // ── loop 모드 (Ralph Wiggum): "될 때까지" 반복. 모델이 결과 확인 후 부족하면 자동 다음 iteration ──
    if (this._override === 'loop') {
      const MAX_ITERATIONS = 5
      const status = await this._authStorage.getStatus()
      // 메인 모델은 Claude 우선 (Claude가 자체 검증 잘 함), 없으면 가능한 모델
      const mainModel: Model = status.claude ? 'claude' : status.codex ? 'codex' : status.gemini ? 'gemini' : 'claude'
      let lastResult = ''
      for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
        if (this._currentAbort?.signal.aborted) break
        const decision: RoutingDecision = {
          model: mainModel,
          effort: inferredEffort,
          confidence: 1.0,
          reason: iter === 1 ? 'loop-start' : `loop-iter-${iter}`,
          ruleMatched: `iteration ${iter}/${MAX_ITERATIONS}`,
        }
        this._postRoutingDecision(decision)
        const ok = await this._runTurn(decision, iter === 1 ? fileCtx : null, iter === 1 ? 'first' : 'reply', userMsg.id, undefined)
        if (!ok) break

        const last = this._messages[this._messages.length - 1]
        if (!last || last.role !== 'assistant') break
        lastResult = last.content

        // 모델이 'DONE' 또는 '완료' 명시했으면 종료
        const tail = lastResult.trim().slice(-200).toLowerCase()
        if (/\bdone\b|✅\s*완료|^완료$|task complete|finished/.test(tail)) {
          this._post({ type: 'toast', message: `🔁 loop: ${iter}회 만에 완료` })
          break
        }

        // max 도달
        if (iter >= MAX_ITERATIONS) {
          this._post({ type: 'toast', message: `🔁 loop: max ${MAX_ITERATIONS}회 도달` })
          break
        }

        // 다음 iteration 자동 trigger — 사용자 메시지처럼 끼워 넣음
        this._messages.push({
          id: `loop-${iter}-${Date.now()}`,
          role: 'user',
          content: `[자동 iteration ${iter + 1}/${MAX_ITERATIONS}] 위 결과를 검토하고: (1) 작업이 완료됐으면 마지막 줄에 "✅ 완료" 명시. (2) 부족하면 부족한 점 식별하고 그것만 수정. 똑같은 작업 반복 금지.`,
          timestamp: Date.now(),
        })
        await this._persistMessages()
      }
      return
    }

    // ── boomerang 모드: 큰 작업 자동 분할 → 병렬 위임 → 종합 ──
    if (this._override === 'boomerang') {
      this._post({ type: 'toast', message: '🪃 boomerang: 작업 분할 중...' })
      const plan = await planBoomerang(userText)
      if (!plan || plan.subTasks.length === 0) {
        this._post({ type: 'streamError', id: 'boomerang', error: 'boomerang plan 생성 실패. 일반 모드로 진행하려면 force를 auto로.' })
        return
      }
      // plan을 사용자에게 표시
      this._post({ type: 'boomerangPlan', plan })

      // 각 sub-task 결과 누적
      const results = new Map<string, string>()
      for (const group of plan.parallelGroups) {
        if (this._currentAbort?.signal.aborted) break
        await Promise.all(group.map(async (taskId) => {
          const task = plan.subTasks.find(t => t.id === taskId)
          if (!task) return
          // 의존성 결과를 task prompt에 prepend
          const depResults = (task.dependsOn ?? []).map(d => `[${d} 결과]\n${results.get(d) ?? '(missing)'}`)
            .join('\n\n')
          const fullPrompt = depResults ? `${task.prompt}\n\n${depResults}` : task.prompt

          const decision: RoutingDecision = {
            model: task.model, effort: task.effort, confidence: 1, reason: 'boomerang-task',
            ruleMatched: `${task.id} · ${task.title}`,
            actualModel: actualModelName(task.model, task.effort),
          }
          const subMsgId = `boom-${task.id}-${Date.now()}`
          this._postRoutingDecision(decision)
          this._post({ type: 'streamStart', id: subMsgId, decision })
          let collected = ''
          const onChunk = (text: string) => {
            collected += text
            this._post({ type: 'streamChunk', id: subMsgId, text })
          }
          try {
            const sysPrompt = `You are handling sub-task "${task.title}" of larger goal: "${plan.goal}". Be focused and concrete.`
            let result: { content: string; inputTokens: number; outputTokens: number }
            if (task.model === 'claude') {
              const tok = await this._claudeAuth.getAccessToken()
              if (!tok) throw new Error('Claude not logged in')
              result = await callClaude([{ role: 'user', content: fullPrompt }], task.effort, tok, onChunk, sysPrompt, this._permissionMode, undefined, this._currentAbort?.signal)
            } else if (task.model === 'codex') {
              const tok = await this._codexAuth.getAccessToken()
              const accountId = await this._codexAuth.getAccountId()
              if (!tok) throw new Error('Codex not logged in')
              result = await this._runCodexAgent([{ role: 'user', content: fullPrompt }], task.effort, tok, accountId ?? undefined, sysPrompt, onChunk, subMsgId, userMsg.id)
            } else {
              result = await this._runGeminiAgent([{ role: 'user', content: fullPrompt }], task.effort, sysPrompt, onChunk, subMsgId, userMsg.id)
            }
            this._post({ type: 'streamEnd', id: subMsgId, tokens: result.outputTokens, actualModel: decision.actualModel })
            results.set(task.id, collected || result.content)
            const assistantMsg: ChatMessage = {
              id: subMsgId, role: 'assistant', content: collected || result.content,
              model: task.model, effort: task.effort, actualModel: decision.actualModel,
              routing: decision, timestamp: Date.now(),
            }
            this._messages.push(assistantMsg)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            this._post({ type: 'streamError', id: subMsgId, error: errMsg })
            results.set(task.id, `(failed: ${errMsg})`)
          }
        }))
        // 각 group 끝날 때마다 persist (sub-task 누적이 reload 후에도 살아있게)
        await this._persistMessages()
      }

      // 종합 — 모든 sub-task 결과를 Claude(또는 Haiku)가 통합
      const synthDecision: RoutingDecision = {
        model: 'claude', effort: 'medium', confidence: 1, reason: 'boomerang-synthesis',
        actualModel: 'claude-haiku-4-5',
      }
      const synthId = `boom-synth-${Date.now()}`
      this._postRoutingDecision(synthDecision)
      this._post({ type: 'streamStart', id: synthId, decision: synthDecision })
      try {
        const synthPrompt = `Original goal: ${plan.goal}\n\n` +
          plan.subTasks.map(t => `## ${t.id}: ${t.title} (by ${t.model})\n${results.get(t.id) ?? '(no result)'}`).join('\n\n') +
          `\n\nSynthesize: 1) what was accomplished, 2) any gaps, 3) next steps. Korean if user is Korean.`
        const env = { ...process.env }; delete env.ANTHROPIC_API_KEY
        const q = query({
          prompt: synthPrompt,
          options: {
            model: 'claude-haiku-4-5',
            systemPrompt: 'Synthesize parallel sub-task results into one coherent summary.',
            tools: [],
            maxTurns: 1,
            persistSession: false,
            cwd: getWorkspaceRoot() ?? process.cwd(),
            env,
            includePartialMessages: true,
          },
        })
        let synthContent = ''
        for await (const m of q) {
          if (m.type === 'stream_event' && (m as any).event?.type === 'content_block_delta' && (m as any).event?.delta?.type === 'text_delta') {
            const t = (m as any).event.delta.text
            if (t) { synthContent += t; this._post({ type: 'streamChunk', id: synthId, text: t }) }
          }
        }
        const synthMsg: ChatMessage = {
          id: synthId, role: 'assistant', content: synthContent,
          model: 'claude', effort: 'medium', actualModel: 'claude-haiku-4-5',
          routing: synthDecision, timestamp: Date.now(),
        }
        this._messages.push(synthMsg)
        this._post({ type: 'streamEnd', id: synthId, actualModel: 'claude-haiku-4-5' })
      } catch (err) {
        this._post({ type: 'streamError', id: synthId, error: err instanceof Error ? err.message : String(err) })
      }
      await this._persistMessages()
      return
    }

    // ── team 모드: Claude가 orchestrator. Codex(구현) / Gemini(텍스트·이미지) 동료를 툴로 호출 ──
    // 토큰 효율 ↑: Claude는 계획·검수만, 실제 코드는 Codex 구독으로, 이미지는 Gemini API로
    if (this._override === 'team') {
      const status = await this._authStorage.getStatus()
      if (!status.claude) {
        this._post({ type: 'streamError', id: 'team', error: 'team 모드는 Claude 연결 필수 (orchestrator 역할)' })
        return
      }
      this._post({ type: 'teamStart', pipeline: ['claude'] })
      const decision: RoutingDecision = {
        model: 'claude', effort: inferredEffort, confidence: 1.0, reason: 'team-orchestrator',
      }
      this._postRoutingDecision(decision)
      await this._runTurn(decision, fileCtx, 'first', userMsg.id, 'architect')
      this._post({ type: 'teamEnd' })
      return
    }

    // ?? ?쇰컲 紐⑤뱶: ?쇱슦?곌? 紐⑤뜽 ?섎굹 ?좏깮 ??
    this._post({ type: 'routing' })
    const claudeToken = await this._claudeAuth.getAccessToken()
    const orchestrator = new Orchestrator({
      anthropicApiKey: claudeToken ?? '',
      openaiApiKey: '',
      metaModel: this._cfg('metaModel') ?? 'claude-haiku-4-5',
      confidenceThreshold: this._cfg<number>('confidenceThreshold') ?? 0.8,
    })
    const routingInput = fileCtx ? `[file: ${fileCtx.fileName}] ${userText}` : userText
    const mentionedModels = this._override === 'auto' ? parseAllMentions(userText) : []

    if (mentionedModels.length > 1) {
      for (const model of mentionedModels) {
        const decision: RoutingDecision = {
          model,
          effort: inferredEffort,
          confidence: 1.0,
          reason: 'mention',
          ruleMatched: `@${model}`,
        }
        this._postRoutingDecision(decision)
        await this._runTurn(decision, fileCtx, model === mentionedModels[0] ? 'first' : 'reply', userMsg.id)
      }
      return
    }

    if (attachments.length > 0 && this._override === 'auto' && mentionedModels.length === 0) {
      const decision: RoutingDecision = {
        model: 'gemini',
        effort: inferredEffort === 'low' ? 'medium' : inferredEffort,
        confidence: 1.0,
        reason: 'attachment',
        ruleMatched: 'image',
      }
      this._postRoutingDecision(decision)
      await this._runTurn(decision, fileCtx, undefined, userMsg.id)
      return
    }

    const decision = await orchestrator.route(routingInput, this._override)
    this._postRoutingDecision(decision)

    await this._runTurn(decision, fileCtx, undefined, userMsg.id)
  }

  // util/history로 이전 대화 사이즈를 슬랩만 압축 (자전 리팩토링)

  // 모델 한 라운드 실행 — 스트리밍 + 저장까지. 성공 시 true.
  private _toolNeedsApproval(toolCall: CodexToolCall): boolean {
    if (toolCall.tool !== 'write_file' && toolCall.tool !== 'replace_in_file') return false
    if (this._permissionMode === 'ask') return true
    if (this._permissionMode !== 'smart-auto') return false
    if (toolCall.tool === 'write_file') return true
    return (toolCall.oldText?.length ?? 0) > 1000 || (toolCall.newText?.length ?? 0) > 1000
  }

  private async _requestToolApproval(toolCall: CodexToolCall, model: Model): Promise<boolean> {
    if (!this._toolNeedsApproval(toolCall)) return true
    if (this._pendingApproval) return false

    const id = Date.now().toString()
    const title = `${model} wants to run ${toolCall.tool}${toolCall.path ? ` on ${toolCall.path}` : ''}`
    const detail = toolCall.tool === 'replace_in_file'
      ? `Replace ${toolCall.oldText?.length ?? 0} chars with ${toolCall.newText?.length ?? 0} chars.`
      : `Write ${toolCall.content?.length ?? 0} chars.`

    this._post({ type: 'approvalRequested', id, title, detail, tool: toolCall.tool, path: toolCall.path, model })
    return new Promise<boolean>((resolve) => {
      this._pendingApproval = { id, title, detail, resolve }
    })
  }

  private async _runCodexAgent(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    effort: Effort,
    accessToken: string,
    accountId: string | undefined,
    systemPrompt: string,
    onChunk: (text: string) => void,
    streamId: string,
    turnId?: string,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    // native engine: codex.exe mcp-server 통해 호출. tool/path/auth 다 codex가 처리.
    const engine = this._cfg<string>('codexEngine') ?? 'native'
    if (engine === 'native') {
      const client = getCodexMcpClient()
      if (client.isAvailable()) {
        const wsRoot = getWorkspaceRoot() ?? process.cwd()
        const last = history[history.length - 1]
        const prior = history.slice(0, -1)
        const prompt = (prior.length
          ? prior.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\n---\n\n'
          : ''
        ) + (last?.content ?? '')
        try {
          const result = await client.run({
            prompt,
            cwd: wsRoot,
            baseInstructions: systemPrompt,
            approvalPolicy: this._permissionMode === 'ask' ? 'on-request' : 'never',
            onProgress: onChunk,
            abortSignal: this._currentAbort?.signal,
          })
          return result
        } catch (err) {
          log.warn('codex', `native engine failed, falling back to legacy: ${err instanceof Error ? err.message : String(err)}`)
          // legacy로 폴백
        }
      } else {
        log.info('codex', 'native engine unavailable (Codex extension not installed?), using legacy')
      }
    }

    const agentHistory = [...history]
    let inputTokens = 0
    let outputTokens = 0

    for (let turn = 0; turn < MAX_CODEX_TOOL_TURNS; turn++) {
      if (this._currentAbort?.signal.aborted) throw new Error('aborted')
      // chunk를 buffer에 누적하면서 forward. tool call 패턴(`{"to":...,"code":...`) 감지되면 그 시점부터 멈춰서 사용자에게 raw json 노출 안 함.
      let bufferedRaw = ''
      let toolCallSeen = false
      const onCodexChunk = (text: string) => {
        bufferedRaw += text
        // tool call JSON 시작 패턴 — `{"to":` 또는 `<orchestrai-tool>` 또는 ```json {"tool":
        if (!toolCallSeen && /\{\s*"(?:to|tool)"\s*:/i.test(bufferedRaw)) {
          toolCallSeen = true
          return  // 그 시점부터 stream 끊음
        }
        if (!toolCallSeen) onChunk(text)
      }
      const result = await callCodex(
        agentHistory,
        effort,
        accessToken,
        onCodexChunk,
        systemPrompt,
        accountId,
        this._currentAbort?.signal,
      )
      inputTokens += result.inputTokens
      outputTokens += result.outputTokens

      const toolCall = parseCodexToolCall(result.content)
      if (!toolCall) {
        // tool 호출 없음. 이미 chunk forward 끝남.
        return { content: result.content, inputTokens, outputTokens }
      }

      const label = formatCodexToolCall(toolCall)
      this._post({ type: 'streamChunk', id: streamId, text: `\n\n  ⏺ ${label}\n` })

      let toolResult: string
      try {
        const approved = await this._requestToolApproval(toolCall, 'codex')
        toolResult = approved
          ? await executeCodexTool(
              toolCall,
              (relPath, before) => this._recordSnapshot(turnId, relPath, before),
              (server, name, args) => this._mcp.callTool(server, name, args),
            )
          : '[tool rejected] user rejected the approval request'
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        toolResult = `[tool error] ${errMsg}`
      }

      agentHistory.push({ role: 'assistant', content: result.content })
      agentHistory.push({
        role: 'user',
        content: `<tool_result tool="${toolCall.tool}" path="${toolCall.path ?? ''}">\n${toolResult}\n</tool_result>`,
      })
    }

          throw new Error(`Codex 도구 호출이 ${MAX_CODEX_TOOL_TURNS}턴을 넘었습니다.`)
  }

  private async _runGeminiAgent(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    effort: Effort,
    systemPrompt: string,
    onChunk: (text: string) => void,
    streamId: string,
    turnId?: string,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const agentHistory = [...history]
    let inputTokens = 0
    let outputTokens = 0

    for (let turn = 0; turn < MAX_CODEX_TOOL_TURNS; turn++) {
      if (this._currentAbort?.signal.aborted) throw new Error('aborted')
      // Gemini도 동일 — buffer + tool call 시작 패턴 감지로 끊기
      let bufferedRaw = ''
      let toolCallSeen = false
      const onGeminiChunk = (text: string) => {
        bufferedRaw += text
        if (!toolCallSeen && /\{\s*"(?:to|tool)"\s*:/i.test(bufferedRaw)) {
          toolCallSeen = true
          return
        }
        if (!toolCallSeen) onChunk(text)
      }
      const result = await callGemini(
        agentHistory,
        effort,
        onGeminiChunk,
        systemPrompt,
        this._currentAbort?.signal,
      )
      inputTokens += result.inputTokens
      outputTokens += result.outputTokens

      const toolCall = parseCodexToolCall(result.content)
      if (!toolCall) {
        return { content: result.content, inputTokens, outputTokens }
      }

      const label = formatCodexToolCall(toolCall)
      this._post({ type: 'streamChunk', id: streamId, text: `\n\n  ⏺ ${label}\n` })

      let toolResult: string
      try {
        const approved = await this._requestToolApproval(toolCall, 'gemini')
        toolResult = approved
          ? await executeCodexTool(
              toolCall,
              (relPath, before) => this._recordSnapshot(turnId, relPath, before),
              (server, name, args) => this._mcp.callTool(server, name, args),
            )
          : '[tool rejected] user rejected the approval request'
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        toolResult = `[tool error] ${errMsg}`
      }

      agentHistory.push({ role: 'assistant', content: result.content })
      agentHistory.push({
        role: 'user',
        content: `<tool_result tool="${toolCall.tool}" path="${toolCall.path ?? ''}">\n${toolResult}\n</tool_result>`,
      })
    }

          throw new Error(`Gemini 도구 호출이 ${MAX_CODEX_TOOL_TURNS}턴을 넘었습니다.`)
  }

  // 현재 로그인된 모델들로 폴백 순서 구성. primary가 맨 앞, 나머지는 Claude→Codex→Gemini 순
  private async _buildFallbackChain(primary: Model): Promise<Model[]> {
    const status = await this._authStorage.getStatus()
    const order: Model[] = ['claude', 'codex', 'gemini']
    const loggedIn = order.filter(m => status[m])
    const chain: Model[] = []
    if (loggedIn.includes(primary)) chain.push(primary)
    for (const m of loggedIn) if (m !== primary) chain.push(m)
    return chain
  }

  private async _runTurn(
    decision: RoutingDecision,
    fileCtx: FileContext | null,
    collabHint?: 'first' | 'reply',
    turnId?: string,
    teamRole?: 'architect' | 'implementer' | 'reviewer',
    noFallback = false,  // argue 모드 같이 모델 분담이 의미 있는 흐름에선 fallback 끄고 그 모델만 시도
  ): Promise<boolean> {
    // 쿼터 파산 시 폴백할 모델 순서 (primary가 맨 앞). noFallback 이면 자기 자신만.
    const fallbackChain = noFallback ? [decision.model] : await this._buildFallbackChain(decision.model)
    if (fallbackChain.length === 0) {
      const msgId = Date.now().toString()
      this._post({ type: 'streamStart', id: msgId, decision })
      this._post({ type: 'streamError', id: msgId, error: '로그인된 모델이 없습니다.' })
      return false
    }

    let effectiveDecision: RoutingDecision = decision
    let result: { content: string; inputTokens: number; outputTokens: number } | null = null
    let assistantMsgId = ''
    let finalError: unknown = null
    let retriedThisAttempt = false  // 같은 모델로 1회 retry — quota 에러에서 즉시 폴백 안 하고 잠시 대기 후 같은 모델 한 번 더

    for (let attempt = 0; attempt < fallbackChain.length; attempt++) {
      const currentModel = fallbackChain[attempt]
      effectiveDecision = attempt === 0
        ? decision
        : {
            ...decision,
            model: currentModel,
            reason: 'quota-fallback',
            ruleMatched: `${decision.model}??{currentModel}`,
            confidence: 1.0,
          }

      // 툴 호출 가능 모델(Codex/Gemini)한테만 MCP 목록 전달
      const mcpTools = (currentModel === 'codex' || currentModel === 'gemini')
        ? await this._mcp.listTools().catch(() => [])
        : undefined
      let systemPrompt = buildSystemPrompt(
        fileCtx, currentModel, collabHint, mcpTools, this._permissionMode, teamRole,
      )
      // RAG: 관련 파일 컨텍스트 prepend
      const ragCtx = (this as any)._ragContextForCurrentTurn
      if (ragCtx) systemPrompt = `${ragCtx}\n\n${systemPrompt}`
      // 활성 agent (marketplace) prepend — 사용자 커스텀 system prompt
      const activeAgent = getActiveAgent(getStorageRoot(this._context))
      if (activeAgent) {
        systemPrompt = `# ACTIVE AGENT: ${activeAgent.name}\n${activeAgent.description}\n\n${activeAgent.systemPrompt}\n\n---\n\n${systemPrompt}`
      }
      const trimmed = buildTaggedHistory(this._messages, currentModel, this._compaction)
      const history = trimmed.messages

      this._post({
        type: 'contextSent',
        model: currentModel,
        includedMessages: trimmed.includedMessages,
        totalMessages: trimmed.totalMessages,
        estimatedTokens: trimmed.estimatedTokens,
        trimmed: trimmed.trimmed,
      })

      // 폴백이면 라우터 결정을 유저에게 다시 알림
      if (attempt > 0) {
        this._postRoutingDecision(effectiveDecision)
      }

      assistantMsgId = (Date.now() + Math.floor(Math.random() * 10000)).toString()
      this._post({ type: 'streamStart', id: assistantMsgId, decision: effectiveDecision })
      // 첫 청크 수신 추적 — 중간 폴백 시 UI에 이미 흘러나왔는지 부분이 있는지 확인
      let sentAny = false
      const onChunk = (text: string) => {
        sentAny = true
        this._post({ type: 'streamChunk', id: assistantMsgId, text })
      }

      try {
        if (currentModel === 'claude') {
          const claudeToken = await this._claudeAuth.getAccessToken()
          if (!claudeToken) {
            const wasLoggedIn = await this._claudeAuth.isLoggedIn()
            this._post({ type: 'authRequired', model: 'claude', reason: wasLoggedIn ? 'expired' : 'not_logged_in' })
            return false
          }
          // team 모드면 Claude(architect)에만 동료 호출 툴 주입
          let extraMcp: Record<string, any> | undefined
          if (teamRole === 'architect') {
            const codexToken = await this._codexAuth.getAccessToken()
            const codexAccountId = await this._codexAuth.getAccountId()
            const geminiAvailable = await this._geminiAuth.isLoggedIn()
            const geminiApiKey = await this._authStorage.getGeminiApiKey()
            const teamServer = buildTeamMcpServer({
              codexToken: codexToken ?? undefined,
              codexAccountId: codexAccountId ?? undefined,
              geminiAvailable,
              geminiApiKey: geminiApiKey ?? undefined,
              workspacePath: getWorkspaceRoot() ?? process.cwd(),
              onActivity: (text) => this._post({ type: 'streamChunk', id: assistantMsgId, text: `\n  ⏺ ${text}\n` }),
              // 핵심: 동료 호출 시 별도 말풍선 생성 → 사용자가 Codex/Gemini 응답을 직접 보게
              runCodexAgent: codexToken ? async (task: string) => {
                const consultId = `consult-${Date.now()}-codex`
                const consultDecision: RoutingDecision = {
                  model: 'codex', effort: 'medium', confidence: 1.0, reason: 'team-consult',
                  actualModel: actualModelName('codex', 'medium'),
                }
                this._postRoutingDecision(consultDecision)
                this._post({ type: 'streamStart', id: consultId, decision: consultDecision })
                const wsRoot = getWorkspaceRoot() ?? process.cwd()
                const wsBase = path.basename(wsRoot)
                const sysPrompt = `You are Codex (GPT-5), the implementer. Claude (architect) delegated a focused task. Use workspace tools to ACTUALLY implement (read_file, write_file, replace_in_file, list_files).

WORKSPACE ROOT: ${wsRoot}

PATH RULES (CRITICAL):
- All file paths are RELATIVE to workspace root above. Do NOT prefix with "${wsBase}/" — that's the workspace itself.
- Correct: "test/foo.md", "src/util.ts"
- WRONG:   "${wsBase}/test/foo.md", "/${wsBase}/src/util.ts"
- Before write_file, you may call list_files with empty path "" to see workspace contents.

After files are written, reply with concise summary (file paths + what changed). Do not just describe — actually call the tools.`
                try {
                  const r = await this._runCodexAgent(
                    [{ role: 'user', content: task }],
                    'medium',
                    codexToken,
                    codexAccountId ?? undefined,
                    sysPrompt,
                    (text) => this._post({ type: 'streamChunk', id: consultId, text }),
                    consultId,
                    turnId,
                  )
                  this._post({ type: 'streamEnd', id: consultId, tokens: r.outputTokens, actualModel: consultDecision.actualModel })
                  // disk persist — reload 후에도 consult 답변 살아있게
                  this._messages.push({
                    id: consultId, role: 'assistant', content: r.content,
                    model: 'codex', effort: 'medium', actualModel: consultDecision.actualModel,
                    routing: consultDecision, tokens: r.outputTokens, timestamp: Date.now(),
                  })
                  await this._persistMessages()
                  return r
                } catch (err) {
                  this._post({ type: 'streamError', id: consultId, error: err instanceof Error ? err.message : String(err) })
                  throw err
                }
              } : undefined,
              runGeminiAgent: geminiAvailable ? async (task: string) => {
                const consultId = `consult-${Date.now()}-gemini`
                const consultDecision: RoutingDecision = {
                  model: 'gemini', effort: 'medium', confidence: 1.0, reason: 'team-consult',
                  actualModel: actualModelName('gemini', 'medium'),
                }
                this._postRoutingDecision(consultDecision)
                this._post({ type: 'streamStart', id: consultId, decision: consultDecision })
                const gWsRoot = getWorkspaceRoot() ?? process.cwd()
                const gWsBase = path.basename(gWsRoot)
                const sysPrompt = `You are Gemini, helping the team. Claude delegated a task. Use workspace tools if file access needed. Reply concisely.

WORKSPACE ROOT: ${gWsRoot}
PATH RULES: paths are relative to workspace root. Don't prefix with "${gWsBase}/" — that's the root itself.`
                try {
                  const r = await this._runGeminiAgent(
                    [{ role: 'user', content: task }],
                    'medium',
                    sysPrompt,
                    (text) => this._post({ type: 'streamChunk', id: consultId, text }),
                    consultId,
                    turnId,
                  )
                  this._post({ type: 'streamEnd', id: consultId, tokens: r.outputTokens, actualModel: consultDecision.actualModel })
                  this._messages.push({
                    id: consultId, role: 'assistant', content: r.content,
                    model: 'gemini', effort: 'medium', actualModel: consultDecision.actualModel,
                    routing: consultDecision, tokens: r.outputTokens, timestamp: Date.now(),
                  })
                  await this._persistMessages()
                  return r
                } catch (err) {
                  this._post({ type: 'streamError', id: consultId, error: err instanceof Error ? err.message : String(err) })
                  throw err
                }
              } : undefined,
            })
            extraMcp = { 'orchestrai-team': teamServer }
          }
          result = await callClaude(history, effectiveDecision.effort, claudeToken, onChunk, systemPrompt, this._permissionMode, extraMcp, this._currentAbort?.signal)
          // 안전망 OFF — '✅ 완료' 로 강제 교체하니 Claude 가 진짜 답한 내용까지 다 사라지는 부작용.
          // ventriloquize 자체는 거슬리지만 빈 답보단 차라리 raw 가 낫다 (사용자: '하네스 풀어').
        } else if (currentModel === 'codex') {
          const codexToken = await this._codexAuth.getAccessToken()
          if (!codexToken) {
            const wasLoggedIn = await this._codexAuth.isLoggedIn()
            this._post({ type: 'authRequired', model: 'codex', reason: wasLoggedIn ? 'expired' : 'not_logged_in' })
            return false
          }
          const accountId = await this._codexAuth.getAccountId()
          result = await this._runCodexAgent(
            history, effectiveDecision.effort, codexToken, accountId ?? undefined,
            systemPrompt, onChunk, assistantMsgId, turnId,
          )
        } else {
          if (!(await this._geminiAuth.isLoggedIn())) {
            this._post({ type: 'authRequired', model: 'gemini', reason: 'not_logged_in' })
            return false
          }
          result = await this._runGeminiAgent(
            history, effectiveDecision.effort, systemPrompt, onChunk, assistantMsgId, turnId,
          )
        }
        // 성공 시 루프 탈출
        break
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '알 수 없는 오류'
        log.error(currentModel, errMsg)
        finalError = err

        const nextModel = fallbackChain[attempt + 1]
        const isQuota = isQuotaError(err)

        // 1차: 같은 모델로 retry (이번 attempt에서 처음 quota이면 4초 대기 후 한 번 더)
        // _retriedThisAttempt 가 false 면 retry 시도. 안 되면 fallback.
        if (isQuota && !retriedThisAttempt) {
          retriedThisAttempt = true
          this._post({
            type: 'streamError',
            id: assistantMsgId,
            error: `⚠ ${currentModel} rate limit — 4초 후 재시도 (${summarizeQuotaError(err)})`
          })
          await new Promise(r => setTimeout(r, 4000))
          if (this._currentAbort?.signal.aborted) {
            this._post({ type: 'streamError', id: assistantMsgId, error: '취소됨' })
            return false
          }
          attempt-- // 같은 attempt 다시 — for 루프의 attempt++ 가 다시 0으로 보내줌
          continue
        }

        // 2차: 다음 모델로 폴백
        const canFallback = !!nextModel && isQuota
        if (canFallback) {
          retriedThisAttempt = false  // 다음 모델은 새로 retry 가능
          this._post({
            type: 'modelFallback',
            from: actualModelName(currentModel, decision.effort),
            to: actualModelName(nextModel, decision.effort),
            reason: `quota: ${summarizeQuotaError(err)}`,
            model: currentModel,
          })
          this._post({
            type: 'streamError',
            id: assistantMsgId,
            error: `⚠ ${currentModel} 쿼터 파산 — ${nextModel}로 자동 전환`
          })
          continue
        }
        // 폴백 불가 (쿼터 외 에러 / 마지막 모델)
        this._post({ type: 'streamError', id: assistantMsgId, error: errMsg })
        return false
      }
    }

    if (!result) {
      // 모든 폴백 실패
      const errMsg = finalError instanceof Error ? finalError.message : '모든 LLM이 응답 실패'
      this._post({ type: 'streamError', id: assistantMsgId, error: `⚠ 모든 모델 쿼터 파산: ${errMsg}` })
      return false
    }

    const actualModel = actualModelName(effectiveDecision.model, effectiveDecision.effort)
    effectiveDecision = { ...effectiveDecision, actualModel }
    const changedFiles = this._changedFilesForTurn(turnId)
    const changeSummary = this._changeSummaryForTurn(turnId)

    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: result.content,
      model: effectiveDecision.model,
      effort: effectiveDecision.effort,
      actualModel,
      changeSummary,
      tokens: result.inputTokens + result.outputTokens,
      routing: effectiveDecision,
      timestamp: Date.now(),
    }
    // strip 함수는 OFF — 본인 의견까지 지우는 부작용 더 컸음. 자연스러운 대화 우선.
    // 다시 켜야 하면 stripVentriloquizedLines() 호출 복구.
    this._messages.push(assistantMsg)
    this._usage.record(effectiveDecision.model, result.inputTokens, result.outputTokens, this._inArgue)
    this._updateUsageStatusBar()

    // 자동 git commit (체크포인트) — 변경 파일 있으면 commit + hash 메시지에 첨부
    if (changedFiles && changedFiles.length > 0) {
      const commit = await this._maybeAutoGitCommit(changedFiles, result.content)
      if (commit) {
        assistantMsg.commitHash = commit.hash
        assistantMsg.commitShort = commit.short
      }
    }

    await this._persistMessages()
    this._post({
      type: 'streamEnd',
      id: assistantMsgId,
      tokens: assistantMsg.tokens,
      actualModel,
      changedFiles,
      changeSummary,
      commitHash: assistantMsg.commitHash,
      commitShort: assistantMsg.commitShort,
    })
    // 결과 자동 미리보기 (HTML → Simple Browser, dev script 있으면 안내)
    void this._maybeAutoPreview(changedFiles)
    // 백그라운드 압축 — 대화가 늘나고 한계치면 Haiku로 요약 (다음 턴 input 절약)
    void this._maybeCompact()
    return true
  }

  // 특정 commit 부모로 hard reset (이 턴 변경 되돌림)
  private async _gitRevertToCommitParent(hash: string) {
    const root = getWorkspaceRoot()
    if (!root) {
      this._post({ type: 'toast', message: '워크스페이스 없음' })
      return
    }
    const { spawn } = require('child_process') as typeof import('child_process')
    const run = (args: string[]): Promise<{ stdout: string; stderr: string; code: number }> => new Promise((resolve) => {
      const p = spawn('git', args, { cwd: root })
      let stdout = '', stderr = ''
      p.stdout.on('data', (c: Buffer) => stdout += c.toString('utf8'))
      p.stderr.on('data', (c: Buffer) => stderr += c.toString('utf8'))
      p.on('exit', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }))
      p.on('error', () => resolve({ stdout: '', stderr: 'git spawn failed', code: 1 }))
    })
    const r = await run(['reset', '--hard', `${hash}^`])
    if (r.code === 0) {
      this._post({ type: 'toast', message: `✓ ${hash.slice(0, 7)}^ 으로 되돌림` })
    } else {
      this._post({ type: 'toast', message: `되돌리기 실패: ${r.stderr.slice(0, 100)}` })
    }
  }

  // commit 변경 내용 보기 (Source Control diff)
  private async _gitShowCommit(hash: string) {
    try {
      await vscode.commands.executeCommand('git.viewCommit', hash)
    } catch {
      // git extension API 없으면 단순 toast
      this._post({ type: 'toast', message: `commit: ${hash.slice(0, 7)}` })
    }
  }

  // /review — 멀티모델 자동 코드 리뷰. git diff (staged 또는 HEAD~1) 추출 → 3 모델 병렬 리뷰 → Haiku가 종합
  async runMultiModelReview(scope: 'staged' | 'lastCommit' = 'lastCommit') {
    const root = getWorkspaceRoot()
    if (!root) {
      this._post({ type: 'streamError', id: 'review', error: '워크스페이스 없음' })
      return
    }
    if (!fs.existsSync(path.join(root, '.git'))) {
      this._post({ type: 'streamError', id: 'review', error: 'git 저장소가 아닙니다' })
      return
    }

    const userMsgId = Date.now().toString()
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: scope === 'staged' ? '/review (staged changes)' : '/review (last commit)',
      timestamp: Date.now(),
    }
    this._messages.push(userMsg)
    await this._persistMessages()  // review 도중 reload 시 user msg 살아있게
    this._post({ type: 'userMessage', message: userMsg })

    const { spawn } = require('child_process') as typeof import('child_process')
    const run = (args: string[]): Promise<string> => new Promise((resolve) => {
      const p = spawn('git', args, { cwd: root })
      let stdout = ''
      p.stdout.on('data', (c: Buffer) => stdout += c.toString('utf8'))
      p.on('exit', () => resolve(stdout))
      p.on('error', () => resolve(''))
    })

    const diff = await run(scope === 'staged' ? ['diff', '--cached'] : ['diff', 'HEAD~1', 'HEAD'])
    if (!diff.trim()) {
      this._post({ type: 'streamError', id: userMsgId, error: '변경 사항이 없습니다' })
      return
    }
    if (diff.length > 50000) {
      this._post({ type: 'toast', message: '⚠ diff가 50KB 넘어 일부만 리뷰' })
    }
    const diffBlock = diff.slice(0, 50000)

    const reviewPrompt = `Review the following code changes. Focus on:
1. Correctness — bugs, edge cases, error handling
2. Security — injection, auth, secret leaks
3. Performance — obvious inefficiencies
4. Readability — naming, structure, comments

\`\`\`diff
${diffBlock}
\`\`\`

Respond as concise markdown:
## Critical issues
- ...
## Suggestions
- ...
## Overall (0-10)
N — one line summary`

    const status = await this._authStorage.getStatus()
    const reviewers: Model[] = (['claude', 'codex', 'gemini'] as Model[]).filter(m => status[m])
    if (reviewers.length === 0) {
      this._post({ type: 'streamError', id: userMsgId, error: '로그인된 모델이 없습니다' })
      return
    }

    this._post({ type: 'toast', message: `🔍 ${reviewers.length}개 모델 병렬 리뷰 시작...` })

    // 각 모델 병렬 호출
    const reviewMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: reviewPrompt }]
    const reviews = await Promise.all(reviewers.map(async (m) => {
      const decision: RoutingDecision = {
        model: m, effort: 'high', confidence: 1, reason: 'review',
        actualModel: actualModelName(m, 'high'),
      }
      const msgId = `review-${m}-${Date.now()}`
      this._postRoutingDecision(decision)
      this._post({ type: 'streamStart', id: msgId, decision })
      const onChunk = (text: string) => this._post({ type: 'streamChunk', id: msgId, text })
      try {
        let result: { content: string; inputTokens: number; outputTokens: number }
        const sysPrompt = 'You are a senior code reviewer. Be specific, terse, and actionable.'
        if (m === 'claude') {
          const tok = await this._claudeAuth.getAccessToken()
          if (!tok) throw new Error('Claude not logged in')
          result = await callClaude(reviewMessages, 'high', tok, onChunk, sysPrompt, 'auto-edit', undefined, this._currentAbort?.signal)
        } else if (m === 'codex') {
          const tok = await this._codexAuth.getAccessToken()
          const accountId = await this._codexAuth.getAccountId()
          if (!tok) throw new Error('Codex not logged in')
          result = await callCodex(reviewMessages, 'high', tok, onChunk, sysPrompt, accountId ?? undefined, this._currentAbort?.signal)
        } else {
          result = await callGemini(reviewMessages, 'high', onChunk, sysPrompt, this._currentAbort?.signal)
        }
        const assistantMsg: ChatMessage = {
          id: msgId, role: 'assistant', content: result.content,
          model: m, effort: 'high', actualModel: decision.actualModel,
          tokens: result.inputTokens + result.outputTokens, routing: decision, timestamp: Date.now(),
        }
        this._messages.push(assistantMsg)
        await this._persistMessages()  // 각 review 응답 즉시 persist (3개 모델 병렬, 한쪽 끝나는 대로 살림)
        this._post({ type: 'streamEnd', id: msgId, tokens: assistantMsg.tokens, actualModel: decision.actualModel })
        return { model: m, content: result.content }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this._post({ type: 'streamError', id: msgId, error: errMsg })
        return { model: m, content: `(review failed: ${errMsg})` }
      }
    }))

    // Haiku 종합
    const synthesisPrompt = `Three AI reviewers reviewed the same code change. Synthesize their reviews into ONE final verdict:

${reviews.map(r => `## ${r.model.toUpperCase()} review:\n${r.content}`).join('\n\n')}

Output:
## Consensus (issues all reviewers agreed)
- ...
## Disagreements (one flagged but others didn't — investigate)
- ...
## Final verdict (0-10)
N — one short line.

Be concise. Korean if reviews are Korean.`

    const synthDecision: RoutingDecision = {
      model: 'claude', effort: 'medium', confidence: 1, reason: 'review-synthesis',
      actualModel: 'claude-haiku-4-5',
    }
    const synthId = `review-synth-${Date.now()}`
    this._postRoutingDecision(synthDecision)
    this._post({ type: 'streamStart', id: synthId, decision: synthDecision })
    try {
      const tok = await this._claudeAuth.getAccessToken()
      if (!tok) throw new Error('Claude not logged in')
      // Haiku로 종합 (낮은 비용 + 빠름)
      // claudeProvider는 effort로 모델 결정 — Haiku 직접 부르려면 별도 query
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const env = { ...process.env }
      delete env.ANTHROPIC_API_KEY
      const q = query({
        prompt: synthesisPrompt,
        options: {
          model: 'claude-haiku-4-5',
          systemPrompt: 'Synthesize multiple code reviews into one consensus.',
          tools: [],
          maxTurns: 1,
          persistSession: false,
          cwd: root,
          env,
          includePartialMessages: true,
        },
      })
      let synthContent = ''
      for await (const m of q) {
        if (m.type === 'stream_event' && (m as any).event?.type === 'content_block_delta' && (m as any).event?.delta?.type === 'text_delta') {
          const t = (m as any).event.delta.text
          if (t) { synthContent += t; this._post({ type: 'streamChunk', id: synthId, text: t }) }
        }
      }
      const synthMsg: ChatMessage = {
        id: synthId, role: 'assistant', content: synthContent,
        model: 'claude', effort: 'medium', actualModel: 'claude-haiku-4-5',
        routing: synthDecision, timestamp: Date.now(),
      }
      this._messages.push(synthMsg)
      this._post({ type: 'streamEnd', id: synthId, actualModel: 'claude-haiku-4-5' })
    } catch (err) {
      this._post({ type: 'streamError', id: synthId, error: err instanceof Error ? err.message : String(err) })
    }

    await this._persistMessages()
  }

  private _bgAborts = new Map<string, AbortController>()

  // 새 백그라운드 작업 시작 — _handleSend의 _isSending lock과 별도로 동시 실행 가능
  private async _startBackgroundTask(text: string) {
    const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const preview = text.slice(0, 80)
    const ctrl = new AbortController()
    this._bgAborts.set(id, ctrl)
    this._backgroundTasks.set(id, { id, preview, startedAt: Date.now(), status: 'running' })
    this._post({ type: 'backgroundTasks', tasks: [...this._backgroundTasks.values()] })
    this._post({ type: 'toast', message: `🌙 백그라운드 [${id.slice(-5)}] 시작` })

    // 별도 컨텍스트로 _doSend 실행 (메인 _isSending 안 막음)
    void (async () => {
      try {
        // 임시로 _currentAbort를 ctrl로 → kill switch 호환
        const prevAbort = this._currentAbort
        const prevSending = this._isSending
        // 메인 작업 진행 중이면 큐에 둠 (단순 구현 — 메인 끝날 때까지 기다림)
        const startWait = Date.now()
        while (this._isSending && Date.now() - startWait < 60_000) {
          if (ctrl.signal.aborted) throw new Error('aborted')
          await new Promise(r => setTimeout(r, 500))
        }
        this._isSending = true
        this._currentAbort = ctrl
        this._post({ type: 'generationStart' })
        try {
          await this._doSend(text, [])
        } finally {
          this._isSending = prevSending
          this._currentAbort = prevAbort
          this._post({ type: 'generationEnd' })
        }
        // 마지막 assistant 메시지를 결과로
        const last = this._messages[this._messages.length - 1]
        const result = last?.role === 'assistant' ? last.content.slice(0, 500) : ''
        this._backgroundTasks.set(id, { ...this._backgroundTasks.get(id)!, status: 'done', result })
        this._post({ type: 'backgroundTasks', tasks: [...this._backgroundTasks.values()] })
        this._notifyBackgroundDone(preview, result)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this._backgroundTasks.set(id, { ...this._backgroundTasks.get(id)!, status: 'failed', error: errMsg })
        this._post({ type: 'backgroundTasks', tasks: [...this._backgroundTasks.values()] })
        this._notifyBackgroundFail(preview, err)
      } finally {
        this._bgAborts.delete(id)
      }
    })()
  }

  private _cancelBackgroundTask(id: string) {
    const ctrl = this._bgAborts.get(id)
    if (ctrl) {
      try { ctrl.abort() } catch {}
      this._post({ type: 'toast', message: `백그라운드 [${id.slice(-5)}] 취소` })
    }
    const task = this._backgroundTasks.get(id)
    if (task && task.status === 'running') {
      this._backgroundTasks.set(id, { ...task, status: 'failed', error: 'cancelled by user' })
      this._post({ type: 'backgroundTasks', tasks: [...this._backgroundTasks.values()] })
    }
  }

  // 백그라운드 작업 완료 알림 — VSCode notification + Telegram push
  private async _notifyBackgroundDone(taskPreview: string, resultPreview = '') {
    const summary = `✓ 백그라운드 작업 완료: ${taskPreview.slice(0, 60)}${taskPreview.length > 60 ? '…' : ''}`
    vscode.window.showInformationMessage(summary, '채팅 보기').then(choice => {
      if (choice === '채팅 보기') vscode.commands.executeCommand('orchestrai.openChat')
    })
    if (this._telegramBridge) {
      try {
        await this._telegramBridge.pushExternalNotification(`${summary}\n\n${resultPreview.slice(0, 500)}`)
      } catch {}
    }
    this._post({ type: 'toast', message: summary })
  }

  private async _notifyBackgroundFail(taskPreview: string, err: any) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const summary = `❌ 백그라운드 작업 실패: ${taskPreview.slice(0, 60)} — ${errMsg.slice(0, 100)}`
    vscode.window.showWarningMessage(summary)
    if (this._telegramBridge) {
      try { await this._telegramBridge.pushExternalNotification(summary) } catch {}
    }
  }

  // 매 턴 자동 git commit — 변경 파일 추적 + 한 턴씩 즉시 revert 가능
  private async _maybeAutoGitCommit(
    changedFiles: ChangedFile[],
    aiContent: string,
  ): Promise<{ hash: string; short: string } | null> {
    if (this._cfg<boolean>('autoGitCommit') === false) return null
    const root = getWorkspaceRoot()
    if (!root) return null
    // git 저장소가 아니면 silent skip
    if (!fs.existsSync(path.join(root, '.git'))) return null

    const { spawn } = require('child_process') as typeof import('child_process')
    const run = (args: string[]): Promise<{ stdout: string; stderr: string; code: number }> => new Promise((resolve) => {
      const p = spawn('git', args, { cwd: root })
      let stdout = '', stderr = ''
      p.stdout.on('data', (c: Buffer) => stdout += c.toString('utf8'))
      p.stderr.on('data', (c: Buffer) => stderr += c.toString('utf8'))
      p.on('exit', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }))
      p.on('error', () => resolve({ stdout: '', stderr: 'git spawn failed', code: 1 }))
    })

    try {
      // 변경된 파일들만 add (전체 add는 위험)
      const adds = changedFiles
        .filter(f => f.status !== 'deleted')
        .map(f => f.path)
      const dels = changedFiles
        .filter(f => f.status === 'deleted')
        .map(f => f.path)

      if (adds.length > 0) {
        await run(['add', '--', ...adds])
      }
      if (dels.length > 0) {
        await run(['rm', '--cached', '--', ...dels]).catch(() => undefined)
      }

      // staged 변경 있는지 확인
      const status = await run(['diff', '--cached', '--name-only'])
      if (!status.stdout.trim()) return null  // 변경 없음

      // commit 메시지 — AI 응답 첫 줄 (또는 prompt 요약)
      const firstLine = aiContent.split('\n').find(l => l.trim()) ?? 'OrchestrAI changes'
      const subject = firstLine.replace(/[#*`]/g, '').slice(0, 70)
      const fileCount = changedFiles.length
      const commitMsg = `[OrchestrAI] ${subject}\n\nFiles: ${fileCount}\nChanged: ${changedFiles.map(f => f.path).slice(0, 10).join(', ')}${changedFiles.length > 10 ? '...' : ''}`

      const commitResult = await run(['commit', '-m', commitMsg, '--no-verify'])
      if (commitResult.code !== 0) {
        log.warn('git', `auto-commit failed: ${commitResult.stderr.slice(0, 200)}`)
        return null
      }
      const hashResult = await run(['rev-parse', 'HEAD'])
      const hash = hashResult.stdout.trim()
      if (!hash) return null
      const short = hash.slice(0, 7)
      log.info('git', `auto-committed ${short}: ${subject.slice(0, 50)}`)
      return { hash, short }
    } catch (err) {
      log.warn('git', 'auto-commit error:', err)
      return null
    }
  }

  // 변경 파일 중 미리보기 가능한 게 있으면 자동으로 띄우기
  private async _maybeAutoPreview(changedFiles: ChangedFile[]) {
    if (this._cfg<boolean>('autoPreview') === false) return
    if (!changedFiles || changedFiles.length === 0) return

    // 1. HTML 파일 만들었거나 수정했으면 → Simple Browser
    const html = changedFiles.find(f => /\.html?$/i.test(f.path) && f.status !== 'deleted')
    if (html) {
      try {
        const fullPath = resolveWorkspacePath(html.path)
        const uri = vscode.Uri.file(fullPath)
        await vscode.commands.executeCommand('simpleBrowser.show', uri.toString())
        log.info('preview', `Simple Browser opened for ${html.path}`)
        this._post({ type: 'toast', message: `🌐 ${html.path} 미리보기 열림` })
        return
      } catch (err) {
        log.warn('preview', `simpleBrowser failed:`, err)
      }
    }

    // 2. package.json 변경 + dev script 있으면 안내 (자동 실행은 안 함 — 위험)
    const pkg = changedFiles.find(f => f.path === 'package.json' || f.path.endsWith('/package.json'))
    if (pkg) {
      try {
        const fullPath = resolveWorkspacePath(pkg.path)
        const content = fs.readFileSync(fullPath, 'utf8')
        const parsed = JSON.parse(content)
        const scripts = parsed?.scripts ?? {}
        const dev = scripts.dev ?? scripts.start ?? scripts.serve
        if (dev) {
          this._post({ type: 'previewSuggest', script: scripts.dev ? 'dev' : (scripts.start ? 'start' : 'serve'), command: dev })
        }
      } catch {}
    }

    // 3. Python 스크립트 새로 만들었으면 ▶ 버튼 안내
    const py = changedFiles.find(f => /\.py$/i.test(f.path) && f.status === 'added')
    if (py) {
      this._post({ type: 'previewSuggest', script: 'python', command: `python ${py.path}` })
    }

    // 4. Node 스크립트
    const js = changedFiles.find(f => /\.(m?js|ts)$/i.test(f.path) && f.status === 'added')
    if (js && !html && !pkg) {
      const isTs = js.path.endsWith('.ts')
      this._post({ type: 'previewSuggest', script: isTs ? 'tsx' : 'node', command: `${isTs ? 'tsx' : 'node'} ${js.path}` })
    }
  }

  private async _maybeCompact() {
    if (this._compactingNow) return
    if (!shouldCompact(this._messages, this._compaction)) return
    this._compactingNow = true
    this._post({
      type: 'compactionStart',
      messageCount: this._messages.length,
    })
    try {
      const next = await compactMessages(
        this._messages,
        this._compaction,
        (text) => log.info('compact', text),
      )
      if (next) {
        this._compaction = next
        await this._persistMessages()
        this._post({
          type: 'compactionEnd',
          summarizedUpTo: next.summarizedUpTo,
          originalTokens: next.originalTokens,
          summaryTokens: next.summaryTokens,
        })
      } else {
        this._post({ type: 'compactionEnd', failed: true })
      }
    } finally {
      this._compactingNow = false
    }
  }

  private _externalObservers = new Set<(msg: any) => void>()
  private _webviewReady = false
  private _lastWebviewReadyInstance: string | undefined
  addExternalObserver(fn: (msg: any) => void): vscode.Disposable {
    this._externalObservers.add(fn)
    return new vscode.Disposable(() => this._externalObservers.delete(fn))
  }

  private _post(msg: any) {
    // routingDecision/streamStart의 actualModel이 자동으로 붙어 UI·저장 데이터가 같은 이름을 보게 된다.
    if (msg && (msg.type === 'routingDecision' || msg.type === 'streamStart') && msg.decision && !msg.decision.actualModel) {
      try {
        msg = {
          ...msg,
          decision: {
            ...msg.decision,
            actualModel: actualModelName(msg.decision.model, msg.decision.effort),
          },
        }
      } catch {}
    }
    this._view?.webview.postMessage(msg)
    for (const obs of this._externalObservers) {
      try { obs(msg) } catch (err) { console.warn('[externalObserver] error:', err) }
    }
  }

  async sendFromExternal(text: string, attachments: ImageAttachment[] = []): Promise<void> {
    // 텔레그램 등 외부에서 들어온 메시지: 다른 작업 진행 중이면 잠시 대기 후 진행 (max 90초)
    const start = Date.now()
    while (this._isSending) {
      if (Date.now() - start > 90_000) {
        throw new Error('이전 작업이 90초 넘게 진행 중입니다. 잠시 후 다시 시도해주세요.')
      }
      await new Promise(r => setTimeout(r, 300))
    }
    return this._handleSend(text, attachments)
  }

  getWorkspacePath(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '(no workspace)'
  }

  private _getHtml(): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'webview', 'chat.html')
    if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, 'utf8')
    return `<html><body style="background:#0d0d0f;color:#e8e8f0;font-family:sans-serif;padding:24px">
      <p>webview/chat.html 파일이 없어요</p></body></html>`
  }

  // VSCode 내장 chat 패널 (@orchestrai 멘션) 핸들러 — 라우팅 + 단일 모델 응답 스트리밍
  async handleChatRequest(
    request: vscode.ChatRequest,
    response: vscode.ChatResponseStream,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const userText = request.prompt?.trim() ?? ''
    if (!userText) {
      response.markdown('Ask OrchestrAI anything. Open the OrchestrAI panel for the full workspace chat.')
      response.button({ command: 'orchestrai.openChat', title: 'Open OrchestrAI' })
      return
    }

    const fileCtx = this._useFileContext ? getActiveFileContext() : null
    const inferredEffort: Effort = this._effortOverride ?? inferEffort(userText)

    const claudeToken = await this._claudeAuth.getAccessToken()
    const orchestrator = new Orchestrator({
      anthropicApiKey: claudeToken ?? '',
      openaiApiKey: '',
      metaModel: this._cfg('metaModel') ?? 'claude-haiku-4-5',
      confidenceThreshold: this._cfg<number>('confidenceThreshold') ?? 0.8,
    })
    const decision = await orchestrator.route(userText, this._override === 'argue' || this._override === 'team' ? 'auto' : this._override)
    const actualName = actualModelName(decision.model, decision.effort)
    response.markdown(`*${decision.model} - ${decision.effort} - \`${actualName}\`*\n\n`)

    const systemPrompt = buildSystemPrompt(fileCtx, decision.model, undefined, undefined, this._permissionMode)
    const trimmed = buildTaggedHistory(this._messages, decision.model, this._compaction)
    const history = [...trimmed.messages, { role: 'user' as const, content: userText }]
    const onChunk = (text: string) => response.markdown(text)

    try {
      if (decision.model === 'claude') {
        if (!claudeToken) {
          response.markdown('Claude login is required. Open OrchestrAI accounts.')
          response.button({ command: 'orchestrai.openChat', title: 'Open OrchestrAI' })
          return
        }
        await callClaude(history, decision.effort, claudeToken, onChunk, systemPrompt, this._permissionMode)
      } else if (decision.model === 'codex') {
        const codexToken = await this._codexAuth.getAccessToken()
        if (!codexToken) {
          response.markdown('Codex login is required.')
          return
        }
        const accountId = await this._codexAuth.getAccountId()
        await callCodex(history, decision.effort, codexToken, onChunk, systemPrompt, accountId ?? undefined)
      } else {
        if (!(await this._geminiAuth.isLoggedIn())) {
          response.markdown('Gemini login is required.')
          return
        }
        await callGemini(history, decision.effort, onChunk, systemPrompt)
      }
      response.markdown('\n\n---\n')
      response.button({ command: 'orchestrai.openChat', title: 'Open OrchestrAI panel' })
    } catch (err) {
      response.markdown(`\n??${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ── 익스텐션 활성화 ─────────────────────────────────────────
export function activate(context: vscode.ExtensionContext) {
  const provider = new OrchestrAIViewProvider(context.extensionUri, context)

  let chatParticipant: vscode.ChatParticipant | undefined
  try {
    chatParticipant = vscode.chat.createChatParticipant('orchestrai.assistant', (req, ctx, res, tok) =>
      provider.handleChatRequest(req, res, tok),
    )
    chatParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg')
    context.subscriptions.push(chatParticipant)
  } catch (err) {
    log.warn('chat-participant', 'register failed (older VSCode?):', err)
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('orchestrai.chatView', provider),
    vscode.commands.registerCommand('orchestrai.openChat', () => {
      vscode.commands.executeCommand('orchestrai.chatView.focus')
    }),
    vscode.commands.registerCommand('orchestrai.clearChat', () => provider.clearChat()),
    vscode.commands.registerCommand('orchestrai.forceAuto', () => provider.setOverrideMode('auto')),
    vscode.commands.registerCommand('orchestrai.forceClaude', () => provider.setOverrideMode('claude')),
    vscode.commands.registerCommand('orchestrai.forceCodex', () => provider.setOverrideMode('codex')),
    vscode.commands.registerCommand('orchestrai.forceGemini', () => provider.setOverrideMode('gemini')),
    vscode.commands.registerCommand('orchestrai.startArgue', () => provider.setOverrideMode('argue')),
    vscode.commands.registerCommand('orchestrai.toggleFileContext', () => provider.toggleFileContext()),
    vscode.commands.registerCommand('orchestrai.showMcpTools', () => provider.showMcpTools()),
    vscode.commands.registerCommand('orchestrai.refreshMcp', () => provider.refreshMcp()),
    vscode.commands.registerCommand('orchestrai.showLogs', () => log.show()),
    vscode.commands.registerCommand('orchestrai.openArchives', () => provider.openArchives()),
    vscode.commands.registerCommand('orchestrai.restoreArchive', () => provider.restoreArchive()),
    vscode.commands.registerCommand('orchestrai.indexCodebase', () => provider.indexCodebase()),
    vscode.commands.registerCommand('orchestrai.showAccounts', () => provider.showAccounts()),
    provider,
  )

  // Inline autocomplete (Cursor/Copilot 스타일 ghost text) — Gemini Flash
  const completionProvider = new OrchestrAICompletionProvider(
    () => provider.getGeminiApiKey(),
    () => vscode.workspace.getConfiguration('orchestrai').get<boolean>('inlineCompletion') !== false,
  )
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completionProvider),
  )
}

export function deactivate() {}

