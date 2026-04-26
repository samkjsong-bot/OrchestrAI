// src/extension.ts
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Orchestrator, inferEffort, parseAllMentions } from './router/orchestrator'
import { callClaude } from './providers/claudeProvider'
import { callCodex } from './providers/codexProvider'
import { callGemini } from './providers/geminiProvider'
import { ChatMessage, RouterMode, RoutingDecision, Model, Effort, ChangeSummary } from './router/types'
import { AuthStorage } from './auth/storage'
import { ClaudeAuth } from './auth/claudeAuth'
import { CodexAuth } from './auth/codexAuth'
import { GeminiAuth } from './auth/geminiAuth'
import { UsageTracker, PLAN_INFO } from './util/usage'
import { judgeTurn } from './router/judge'
import { log } from './util/log'
import { buildTaggedHistory } from './util/history'
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

function chatStateFilePath(context: vscode.ExtensionContext): string {
  const key = chatStateKey()
  const hash = require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16)
  const dir = path.join(context.globalStorageUri.fsPath, 'chats')
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return path.join(dir, `${hash}.json`)
}

// 현재 키 파일 못 찾을 때 chats/ 안 가장 최근 파일을 자동으로 따라옴 (데이터 분실 방지 안전망)
function findMostRecentChat(context: vscode.ExtensionContext): string | null {
  const dir = path.join(context.globalStorageUri.fsPath, 'chats')
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return { f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() } }
      catch { return null }
    })
    .filter((x): x is { f: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime)
  return files[0] ? path.join(dir, files[0].f) : null
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
const MAX_FILE_CHARS = 8000

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
  status: 'added' | 'modified'
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

const CODEX_TOOL_RE = /```(?:orchestrai-tool|json)\s*([\s\S]*?)```/i
// 무한 루프 안전장치 — 정상 작업은 절대 도달 못 하는 수. Claude Code CLI와 동등.
const MAX_CODEX_TOOL_TURNS = 100
const MAX_TOOL_READ_CHARS = 40000
const MAX_TOOL_LIST_ITEMS = 250

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
}

function resolveWorkspacePath(relPath?: string): string {
  const root = getWorkspaceRoot()
  if (!root) throw new Error('워크스페이스 폴더가 열려 있지 않습니다.')

  const cleaned = (relPath ?? '.').replace(/\\/g, '/').replace(/^\/+/, '')
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
  const trim = (s: any, n = 80) => {
    const str = String(s ?? '').replace(/\s+/g, ' ').trim()
    return str.length > n ? str.slice(0, n) + '...' : str
  }
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

  throw new Error(`吏?먰븯吏 ?딅뒗 ?꾧뎄?낅땲?? ${call.tool}`)
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

  async callTool(server: string, name: string, args: Record<string, unknown>): Promise<string> {
    const client = await this.getClient(server)
    const result = await client.callTool({ name, arguments: args })
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

function modelTag(m: Model): string {
  return m === 'claude' ? '[Claude]' : m === 'codex' ? '[Codex]' : '[Gemini]'
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
  const selfTag = modelTag(model)
  const peers: Model[] = (['claude', 'codex', 'gemini'] as Model[]).filter(m => m !== model)
  const peerNames = peers.map(modelLabel).join(' and ')
  const peerTagsList = peers.map(modelTag).join(' / ')

  // team 모드 역할별 지침 (teamRole이 지정됐을 때만)
  // 새 설계: Claude orchestrator가 consult_codex/consult_gemini/generate_image 툴로 동료에게 위임.
  // implementer/reviewer는 더 이상 직접 응답하지 않고, Claude가 consult로 부름.
  const teamRoleBlock =
    teamRole === 'architect'
      ? `\n\nTEAM MODE ??you are the ORCHESTRATOR (architect + final reviewer).

Your team:
- **You (Claude)**: plan, delegate, integrate, FINAL REVIEW. Don't write big chunks of code yourself ??delegate.
- **Codex (GPT-5)**: implementer. Call via \`consult_codex(task)\` tool. Codex actually edits files via its own tools. Use for: writing code, implementing features, fixing bugs, scaffolding.
- **Gemini**: specialist. Call via \`consult_gemini(question)\` for: long-context analysis, summaries, lookups (free tier ??cheap). Call \`generate_image(prompt, save_to)\` for image creation (cover art, mockups, icons).

Standard flow:
1. Read user request. Plan briefly (steps, files, risks). Use TodoWrite if it helps you track.
2. Delegate concrete coding tasks to Codex via consult_codex ??give file paths and acceptance criteria, not vague instructions.
3. If you need image/visual: generate_image. If you need to analyze/summarize a long doc or whole codebase: consult_gemini.
4. After delegations finish, READ the changed files yourself with Read tool to verify. Catch anything Codex missed.
5. Final response: short summary (what was done, file links, anything user should know). NOT the whole plan again.

Rules:
- Keep your own output minimal ??most code goes through consult_codex. Saves your tokens.
- Each consult task should be focused and self-contained ??don't dump entire user message into the consult.
- Ask Codex/Gemini brief follow-up questions if their first response misses the mark.
- You CAN still use Bash/Read/Edit yourself when delegation overhead isn't worth it (e.g. one-line typo fix, running a build).`
      : ''

  // argue 모드 힌트 (team은 아닐 때만)
  const argueBlock = !teamRole && (
    collabHint === 'reply'
      ? `\n\nARGUE MODE ??a peer model just answered the user's message above (tagged ${peerTagsList}). Add YOUR distinct angle: agree/disagree with reasoning, catch what they missed, offer an alternative. One concise take ??no restating. Be direct.`
      : collabHint === 'first'
      ? `\n\nARGUE MODE ??your peers (${peerNames}) will chime in after you on the same question. Give your best take first; they'll critique/extend. Keep it tight.`
      : ''
  )

  const collabBlock = teamRoleBlock || argueBlock

  const base = `You are the ${selfName} backend of OrchestrAI ??a VSCode extension that orchestrates multiple AI models.

CONTEXT YOU MUST KEEP IN MIND
- The user runs Claude Max + ChatGPT Pro + Gemini (Google) subscriptions. OrchestrAI routes each request to whichever model fits the task best.
- You are ${selfName}. Your peers are ${peerNames}. All three can appear in the same chat thread.
- CRITICAL IDENTITY RULE: You are ${selfName} and ONLY ${selfName}. NEVER pretend to be ${peerNames}, even if the user names them ("써드파티")
- Prior assistant messages may be prefixed ${selfTag} (you) or ${peerTagsList} (peers). Treat peer-tagged messages as prior turns in this same conversation ??do NOT re-introduce yourself, do NOT repeat what a peer already said.
- Rough division: Claude ??architecture, multi-file refactoring, deep debugging, code review, nuanced reasoning. Codex ??fast implementation, boilerplate, CLI, simple fixes. Gemini ??long-context (whole codebase, big files), multimodal (images/PDFs/diagrams), summarization.
- When asked "which model should I use?" ??answer in terms of THIS three-model setup, do NOT give generic comparisons.${collabBlock}

HOW TO THINK BEFORE ANSWERING
- Pause and plan. Identify what the user actually needs (a fix? an explanation? a decision?). Pick the 2-3 points that matter and skip the rest.
- If the request is ambiguous, ask ONE sharp clarifying question instead of guessing wide.
- For code questions: state the root cause first, then the fix. Don't dump every possibility.

REFINE VAGUE PROMPTS BEFORE DOING THE WORK
The user is a vibe-coder — short, casual prompts ("게임 하나 재밌게 만들어봐", "예쁘게 만들어줘", "이거 고쳐줘") happen often. Don't just guess and go. Instead:

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
The user is a vibe-coder ??they often don't know what tools exist or could help. When you notice the workflow could benefit from setup changes, SAY SO. Specifically:
- **Missing MCP that fits the task** — recommend a concrete MCP server with name and what it would unlock. Examples: NotebookLM MCP for research/note synthesis, GitHub MCP for repo management, Postgres MCP for DB work, Playwright MCP for browser automation, Linear MCP for ticketing.
- **Missing Gemini API key when image gen would help** — say "이미지가 필요한 작업인데 Gemini API 키가 없어요. 설정 → 계정 연결 → 🎨 Gemini API 키에서 등록하면 generate_image 활성화됩니다."
- **Workspace structure improvements** ??if you notice missing .gitignore, no README, no CI config, missing tsconfig strict, etc., point it out briefly.
- **Capability requests** — if you literally CAN'T do something the user wants and a tool would fix it, ask: "X를 하려면 Y MCP가 필요한데 붙여드릴까요?" Don't silently fail.
Be useful, not preachy. Don't mention this every turn ??only when relevant to the actual task.

RESPONSE STYLE ??mimic Claude Code CLI (critical)
- Open with ONE short sentence stating what you are doing or what you found. No filler preamble ("좋은 질문입니다", "물론입니다", "알겠습니다" 금지).
- Results first, reasoning only if the user asks why.
- Keep it tight. Short paragraphs. No walls of text. If there are multiple points, bullet them ??each bullet one line.
- **File references: always as markdown links** ??\`[filename.ts:42](src/filename.ts#L42)\` or \`[filename.ts:42-56](src/filename.ts#L42-L56)\`. NEVER bare paths like \`src/filename.ts\`.
- End with a 1~2 sentence summary: what changed / what the user should do next. Nothing else — no "위에서 설명한 바와 같이" type closers.
- No emojis unless the user uses them first.
- Korean when the user writes in Korean. Direct tone — no apologies for "잘 모르겠습니다" style hedging.

OUTPUT FORMATTING ??STRICT RULES
- NEVER write a long answer as one paragraph. Break thoughts into short paragraphs with blank lines between them.
- Markdown block elements MUST be on their own line with a blank line above AND below:
  - Headers:      \`\\n\\n## Header\\n\\n\`
  - Code fences:  \`\\n\\n\\\`\\\`\\\`lang\\n...code...\\n\\\`\\\`\\\`\\n\\n\`
  - Lists:        each bullet on its own line (\`- item\\n- item\`)
  - Horizontal rule: \`\\n\\n---\\n\\n\`
- Inline code uses single backticks.
- Always fence code blocks with a language tag (\`ts\`, \`py\`, \`bash\`, \`json\`, etc.).
- For comparisons / options, prefer a short markdown table over bullet-of-bullets.`

  let localTools = ''
  if (model === 'codex' || model === 'gemini') {
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

Rules:
- Use relative paths inside the workspace only.
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

Keep tool use purposeful ??each call should advance the task. After completing changes, summarize what changed with markdown links to the modified files.`
  }

  // MCP 서버가 설정돼 있으면 사용 가능한 툴 목록을 프롬프트에 주입
  const mcpBlock = mcpTools && mcpTools.length > 0
    ? `\n\nMCP SERVERS AVAILABLE\n${
        mcpTools.map(t => `- ${t.server}.${t.name}${t.description ? ` ??${t.description}` : ''}`).join('\n')
      }\nCall with: {"tool":"mcp","server":"serverName","name":"toolName","args":{...}}`
    : ''

  let modeBlock = ''
  if (permissionMode === 'plan') {
    const ts = Date.now()
    modeBlock = `\n\nPLAN MODE (STRICT ??user enabled)
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
- Trivial/reversible edits (adding a line, fixing typos, stylistic) ??execute immediately.
- Risky changes (deleting code >10 lines, schema/config changes, security-relevant, irreversible) ??show diff first, ask confirmation.
- When in doubt, ask.`
  }
  // 'auto-edit'은 추가 지침 없음 (기본 동작)

  const prompt = `${base}${localTools}${mcpBlock}${modeBlock}`

  if (!ctx) return prompt

  return `${prompt}

The user has this file open:
${buildContextBlock(ctx)}
${ctx.cursorLine ? `Cursor at line ${ctx.cursorLine}.` : ''}
${ctx.selectedText ? 'User has selected code ??prioritize that selection.' : ''}

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
    // 이전에 연결됐던 Telegram 봇 자동 재접속 (cfg가 SecretStorage에 있으면)
    void this._autoStartTelegram()
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
            break
          case 'send':          await this._handleSend(msg.text, msg.attachments ?? []); break
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
            await this._openWorkspaceFile(msg.path)
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
    if (!snapshots.some(s => s.path === relPath)) {
      snapshots.push({ path: relPath, before })
      this._fileSnapshotsByTurn.set(turnId, snapshots)
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

  private async _openWorkspaceFile(rawPath: string) {
    try {
      // 상대경로면 그대로, 절대경로면 워크스페이스 기준으로 해석
      const isAbsolute = /^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith('/') || rawPath.startsWith('\\\\')
      let target: string
      if (isAbsolute) {
        target = rawPath
      } else {
        try {
          target = resolveWorkspacePath(rawPath)
        } catch {
          // 워크스페이스 안에 없으면 현재 cwd 기준으로 시도
          target = path.resolve(getWorkspaceRoot() ?? process.cwd(), rawPath)
        }
      }
      // 존재 확인 후 열기
      if (!fs.existsSync(target)) {
        this._post({ type: 'toast', message: `?뚯씪 ?놁쓬: ${target}` })
        return
      }
      const doc = await vscode.workspace.openTextDocument(target)
      await vscode.window.showTextDocument(doc, { preview: false })
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
    vscode.window.showInformationMessage('Gemini API key saved')
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
    this._post({
      type: 'contextChanged',
      fileName: ctx?.fileName ?? null,
      language: ctx?.language ?? null,
      hasSelection: !!ctx?.selectedText,
      cursorLine: ctx?.cursorLine ?? null,
    })
  }

  // ?? Send ?????????????????????????????????????????????????????????

  private async _handleSend(userText: string, attachments: ImageAttachment[] = []) {
    if (!userText.trim() && attachments.length === 0) return

    if (this._isSending) {
      this._post({ type: 'blocked', reason: 'Wait for the current response to finish' })
      return
    }
    this._isSending = true
    // ??generation ?쒖옉 ????abort controller
    this._currentAbort = new AbortController()
    this._post({ type: 'generationStart' })  // UI: stop 버튼 켜기

    try {
      await this._doSend(userText, attachments)
    } finally {
      this._isSending = false
      this._currentAbort = undefined
      this._post({ type: 'sendUnlocked' })
      this._post({ type: 'generationEnd' })  // UI: stop 버튼 끄기
    }
  }

  private async _doSend(userText: string, attachments: ImageAttachment[] = []) {
    const fileCtx = this._useFileContext ? getActiveFileContext() : null
    // 유저가 수동 override 있으면 그거 우선, 없으면 본문에서 추론
    const inferredEffort: Effort = this._effortOverride ?? inferEffort(userText)

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

    // ── argue 모드: 로그인된 모델들이 라운드 로빈으로 서로 반박/보완 ──
    // 매 턴마다 Claude Haiku 판정이 0~10점 채점 → UI 스코어보드로 실시간 노출
    if (this._override === 'argue') {
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
        this._post({ type: 'routingDecision', decision })
        const prevLen = this._messages.length
        const ok = await this._runTurn(decision, fileCtx, i === 0 ? 'first' : 'reply', userMsg.id)
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
      this._post({ type: 'routingDecision', decision })
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
        this._post({ type: 'routingDecision', decision })
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
      this._post({ type: 'routingDecision', decision })
      await this._runTurn(decision, fileCtx, undefined, userMsg.id)
      return
    }

    const decision = await orchestrator.route(routingInput, this._override)
    this._post({ type: 'routingDecision', decision })

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
    const agentHistory = [...history]
    let inputTokens = 0
    let outputTokens = 0

    for (let turn = 0; turn < MAX_CODEX_TOOL_TURNS; turn++) {
      if (this._currentAbort?.signal.aborted) throw new Error('aborted')
      const result = await callCodex(
        agentHistory,
        effort,
        accessToken,
        () => {},
        systemPrompt,
        accountId,
        this._currentAbort?.signal,
      )
      inputTokens += result.inputTokens
      outputTokens += result.outputTokens

      const toolCall = parseCodexToolCall(result.content)
      if (!toolCall) {
        onChunk(result.content)
        return { content: result.content, inputTokens, outputTokens }
      }

      const label = formatCodexToolCall(toolCall)
      this._post({ type: 'streamChunk', id: streamId, text: `\n\n  ??${label}\n` })

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
      const result = await callGemini(
        agentHistory,
        effort,
        () => {},
        systemPrompt,
        this._currentAbort?.signal,
      )
      inputTokens += result.inputTokens
      outputTokens += result.outputTokens

      const toolCall = parseCodexToolCall(result.content)
      if (!toolCall) {
        onChunk(result.content)
        return { content: result.content, inputTokens, outputTokens }
      }

      const label = formatCodexToolCall(toolCall)
      this._post({ type: 'streamChunk', id: streamId, text: `\n\n  ??${label}\n` })

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
  ): Promise<boolean> {
    // 쿼터 파산 시 폴백할 모델 순서 (primary가 맨 앞)
    const fallbackChain = await this._buildFallbackChain(decision.model)
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
      const systemPrompt = buildSystemPrompt(
        fileCtx, currentModel, collabHint, mcpTools, this._permissionMode, teamRole,
      )
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
        this._post({ type: 'routingDecision', decision: effectiveDecision })
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
              onActivity: (text) => this._post({ type: 'streamChunk', id: assistantMsgId, text: `\n  ??${text}\n` }),
              // 핵심: 단발 callCodex 대신 _runCodexAgent (툴 루프) 통째로 위임
              runCodexAgent: codexToken ? async (task: string) => {
                const sysPrompt = 'You are Codex (GPT-5), the implementer. Claude (architect) just delegated a focused task. Use workspace tools to ACTUALLY implement it (read_file, write_file, replace_in_file, list_files). After files are written, reply with concise summary of changes (file paths + what changed). Do not just describe ??actually call the tools.'
                return this._runCodexAgent(
                  [{ role: 'user', content: task }],
                  'medium',
                  codexToken,
                  codexAccountId ?? undefined,
                  sysPrompt,
                  // worker side onChunk: 받은 청크는 hub의 streamChunk로 forward (UI에 보임)
                  (text) => this._post({ type: 'streamChunk', id: assistantMsgId, text }),
                  assistantMsgId,
                  turnId,
                )
              } : undefined,
              runGeminiAgent: geminiAvailable ? async (task: string) => {
                const sysPrompt = 'You are Gemini, helping the team. Claude delegated a question/task. Use workspace tools if file access needed. Reply concisely.'
                return this._runGeminiAgent(
                  [{ role: 'user', content: task }],
                  'medium',
                  sysPrompt,
                  (text) => this._post({ type: 'streamChunk', id: assistantMsgId, text }),
                  assistantMsgId,
                  turnId,
                )
              } : undefined,
            })
            extraMcp = { 'orchestrai-team': teamServer }
          }
          result = await callClaude(history, effectiveDecision.effort, claudeToken, onChunk, systemPrompt, this._permissionMode, extraMcp, this._currentAbort?.signal)
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
        const canFallback = isQuotaError(err) && !sentAny && nextModel
        if (canFallback) {
          // 폴백 시도 — 이전 시도의 에러 마커로 표시
          this._post({
            type: 'streamError',
            id: assistantMsgId,
            error: `⚠ ${currentModel} 쿼터 파산 (${summarizeQuotaError(err)}) — ${nextModel}로 자동 전환`
          })
          continue
        }
        // 폴백 불가 (이미 첫 청크 출력 중 / 쿼터 외 에러 / 마지막 모델)
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
    this._messages.push(assistantMsg)
    this._usage.record(effectiveDecision.model, result.inputTokens, result.outputTokens, this._inArgue)
    this._updateUsageStatusBar()
    await this._persistMessages()
    this._post({
      type: 'streamEnd',
      id: assistantMsgId,
      tokens: assistantMsg.tokens,
      actualModel,
      changedFiles,
      changeSummary,
    })
    // 백그라운드 압축 — 대화가 늘나고 한계치면 Haiku로 요약 (다음 턴 input 절약)
    void this._maybeCompact()
    return true
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
    provider,
  )
}

export function deactivate() {}

