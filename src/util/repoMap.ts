// src/util/repoMap.ts
// Aider 풍 "repo map" — symbol(함수·클래스·메서드) 정의 위치를 인덱싱.
// embedding RAG 의 약점("이 함수 어디서 정의됐어?" 같은 정확 쿼리)을 보완.
// tree-sitter 없이 regex 만으로 가벼운 1차 구현 — ts/js/py/go/rs/java.

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { log } from './log'
import { record as perfRecord } from './perf'

export interface Symbol {
  name: string
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'const'
  file: string         // workspace-relative
  line: number         // 1-based
  signature: string    // 잡힌 그 줄 그대로
}

export interface RepoMap {
  version: number
  workspaceRoot: string
  builtAt: number
  totalSymbols: number
  // index 빌드 시 빠른 조회용 — name (lowercase) → 매칭 symbols
  symbolsByName: Record<string, Symbol[]>
  // 파일별 — re-index 시 빠른 제거용
  symbolsByFile: Record<string, Symbol[]>
}

const REPO_MAP_VERSION = 2

const INCLUDE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp',
])

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  '.vscode', '.idea', '__pycache__', 'venv', '.venv', 'env',
  'target', 'vendor', 'tmp', 'temp', '.orchestrai',
])

const MAX_FILE_SIZE = 200_000

// 언어별 regex — 한 줄에 정의가 시작되는 패턴만 (멀티라인은 안 잡음, 너무 비용)
const PATTERNS: Array<{ extMatch: RegExp; rules: Array<{ kind: Symbol['kind']; re: RegExp }> }> = [
  {
    extMatch: /\.(ts|tsx|js|jsx|mjs|cjs)$/i,
    rules: [
      { kind: 'class',     re: /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'interface', re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'type',      re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
      { kind: 'function',  re: /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'function',  re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$<])\s*=>/ },
      { kind: 'method',    re: /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+){0,4}([A-Za-z_$][\w$]*)\s*\(/ },
    ],
  },
  {
    extMatch: /\.py$/i,
    rules: [
      { kind: 'class',    re: /^class\s+([A-Za-z_][\w]*)/ },
      { kind: 'function', re: /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
      { kind: 'method',   re: /^\s{2,}(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
    ],
  },
  {
    extMatch: /\.go$/i,
    rules: [
      { kind: 'function', re: /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/ },
      { kind: 'type',     re: /^type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/ },
    ],
  },
  {
    extMatch: /\.rs$/i,
    rules: [
      { kind: 'function', re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/ },
      { kind: 'class',    re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_][\w]*)/ },
      { kind: 'interface',re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_][\w]*)/ },
      { kind: 'type',     re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:type|enum)\s+([A-Za-z_][\w]*)/ },
    ],
  },
  {
    extMatch: /\.(java|kt|cs)$/i,
    rules: [
      { kind: 'class',     re: /^\s*(?:public|private|protected|internal|abstract|sealed|final|static|\s)*\bclass\s+([A-Za-z_][\w]*)/ },
      { kind: 'interface', re: /^\s*(?:public|private|protected|internal|\s)*\binterface\s+([A-Za-z_][\w]*)/ },
      { kind: 'method',    re: /^\s{2,}(?:public|private|protected|internal|abstract|static|final|override|virtual|\s)*\b([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\s*\{?/ },
    ],
  },
  {
    extMatch: /\.(c|h|cpp|cc|hpp)$/i,
    rules: [
      // C/C++ 함수 매칭은 까다로워 보수적으로 — definition 끝이 { 인 경우만
      { kind: 'function',  re: /^[A-Za-z_][\w\s\*&<>:,]*\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*\{?\s*$/ },
      { kind: 'class',     re: /^\s*(?:class|struct)\s+([A-Za-z_][\w]*)/ },
    ],
  },
]

// 일반 키워드는 symbol 로 잡지 않음 (false positive 방지)
const RESERVED = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break', 'continue',
  'true', 'false', 'null', 'undefined', 'this', 'super', 'new', 'in', 'of',
  'try', 'catch', 'finally', 'throw', 'throws', 'import', 'export', 'from',
  'public', 'private', 'protected', 'static', 'final', 'async', 'await', 'yield',
  'class', 'interface', 'type', 'function', 'const', 'let', 'var', 'def', 'fn', 'func',
  'struct', 'enum', 'trait', 'impl', 'module', 'package', 'namespace',
  'pass', 'self', 'None', 'True', 'False',
])

function extractFromFile(absPath: string, root: string): Symbol[] {
  const ext = path.extname(absPath).toLowerCase()
  const rules = PATTERNS.find(p => p.extMatch.test(ext))?.rules
  if (!rules) return []

  let content: string
  try { content = fs.readFileSync(absPath, 'utf8') } catch { return [] }
  const rel = path.relative(root, absPath).replace(/\\/g, '/')
  const lines = content.split('\n')
  const out: Symbol[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 500) continue  // minified / generated
    for (const rule of rules) {
      const m = line.match(rule.re)
      if (m && m[1] && !RESERVED.has(m[1])) {
        out.push({
          name: m[1],
          kind: rule.kind,
          file: rel,
          line: i + 1,
          signature: line.trim().slice(0, 200),
        })
        break  // 한 줄당 하나
      }
    }
  }
  return out
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const result: string[] = []
  async function walk(dir: string) {
    let entries: fs.Dirent[] = []
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue
        if (e.name.startsWith('.') && e.name !== '.github') continue
        await walk(full)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!INCLUDE_EXTS.has(ext)) continue
        try {
          const stat = await fs.promises.stat(full)
          if (stat.size > MAX_FILE_SIZE) continue
          result.push(full)
        } catch {}
      }
    }
  }
  await walk(root)
  return result
}

export async function buildRepoMap(workspaceRoot: string, globalStorage: string): Promise<RepoMap> {
  const t0 = performance.now()
  const files = await collectSourceFiles(workspaceRoot)
  const symbolsByName: Record<string, Symbol[]> = {}
  const symbolsByFile: Record<string, Symbol[]> = {}
  let total = 0

  for (const file of files) {
    const syms = extractFromFile(file, workspaceRoot)
    if (syms.length === 0) continue
    symbolsByFile[syms[0].file] = syms
    for (const s of syms) {
      const key = s.name.toLowerCase()
      ;(symbolsByName[key] ??= []).push(s)
    }
    total += syms.length
  }

  const map: RepoMap = {
    version: REPO_MAP_VERSION,
    workspaceRoot,
    builtAt: Date.now(),
    totalSymbols: total,
    symbolsByName,
    symbolsByFile,
  }

  // 디스크 저장 (re-load 빠르게)
  try {
    const filePath = repoMapPath(globalStorage, workspaceRoot)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, JSON.stringify(map), 'utf8')
  } catch (err) {
    log.warn('repomap', 'save failed:', err)
  }

  log.info('repomap', `built ${total} symbols from ${files.length} files in ${Math.round(performance.now() - t0)}ms`)
  perfRecord('buildRepoMap', performance.now() - t0)
  return map
}

function repoMapPath(globalStorage: string, workspaceRoot: string): string {
  const norm = workspaceRoot.toLowerCase().replace(/[\\/]+$/, '')
  const hash = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16)
  return path.join(globalStorage, 'repo-map', `${hash}.json`)
}

export function loadRepoMap(globalStorage: string, workspaceRoot: string): RepoMap | null {
  try {
    const filePath = repoMapPath(globalStorage, workspaceRoot)
    if (!fs.existsSync(filePath)) return null
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (raw.version !== REPO_MAP_VERSION) return null
    return raw as RepoMap
  } catch { return null }
}

// query 안에서 identifier-like 토큰 추출 → repo map 에서 찾아 정의 위치 반환.
// embedding RAG 와 합쳐 system prompt 에 첨부할 짧은 블록 생성.
export function findRelevantSymbols(query: string, map: RepoMap, limit = 8): Symbol[] {
  // CamelCase / snake_case / 일반 식별자 토큰
  const tokens = new Set<string>()
  const re = /[A-Za-z_][A-Za-z0-9_]{2,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    const t = m[0]
    if (RESERVED.has(t)) continue
    if (t.length > 60) continue
    tokens.add(t.toLowerCase())
  }
  if (tokens.size === 0) return []

  const seen = new Set<string>()
  const result: Symbol[] = []
  for (const tok of tokens) {
    const matches = map.symbolsByName[tok]
    if (!matches) continue
    for (const s of matches) {
      const key = `${s.file}:${s.line}:${s.name}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(s)
      if (result.length >= limit) return result
    }
  }
  return result
}

export function formatSymbolBlock(symbols: Symbol[]): string {
  if (symbols.length === 0) return ''
  const grouped = new Map<string, Symbol[]>()
  for (const s of symbols) {
    const arr = grouped.get(s.file) ?? []
    arr.push(s)
    grouped.set(s.file, arr)
  }
  const lines: string[] = ['REPO MAP (symbol definitions found in your query):', '']
  for (const [file, syms] of grouped) {
    lines.push(`📄 ${file}`)
    for (const s of syms) {
      lines.push(`  ${s.line.toString().padStart(4)} | ${s.kind.padEnd(9)} ${s.signature}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
