// src/util/codebaseIndex.ts
// 워크스페이스 코드 파일을 chunk 단위로 embedding해서 디스크에 저장.
// 검색은 retriever.ts에서 query embedding과 cosine similarity로.

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { embedTexts } from '../providers/geminiEmbedProvider'
import { log } from './log'

const CHUNK_LINES = 80         // 한 chunk의 라인 수
const CHUNK_OVERLAP = 15       // 다음 chunk와 겹치는 라인 (boundary 컨텍스트 보존)
const MAX_FILE_SIZE = 200_000  // 200KB 이상 파일 skip (binary/minified 가능성)

// 인덱싱 대상 확장자 — 코드·문서 위주
const INCLUDE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.html', '.css', '.scss', '.vue', '.svelte',
  '.md', '.mdx', '.txt',
  '.json', '.yaml', '.yml', '.toml',
  '.sh', '.ps1',
  '.sql',
])

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  '.vscode', '.idea', '__pycache__', 'venv', '.venv', 'env', '.env',
  'target', 'vendor', 'tmp', 'temp', '.DS_Store',
  // OrchestrAI 자체
  '.orchestrai',
])

export interface IndexedChunk {
  id: string
  path: string          // 워크스페이스 상대 경로
  startLine: number     // 1-indexed
  endLine: number
  text: string
  embedding: number[]
  fileMtime: number     // 파일 수정 시각 (변경 감지용)
}

export interface CodebaseIndex {
  version: number
  workspaceRoot: string
  indexedAt: number
  totalFiles: number
  totalChunks: number
  chunks: IndexedChunk[]
}

const INDEX_VERSION = 1

// 인덱스 파일 위치 (workspace별)
function indexFilePath(globalStorage: string, workspaceRoot: string): string {
  const norm = workspaceRoot.toLowerCase().replace(/[\\/]+$/, '')
  const hash = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16)
  const dir = path.join(globalStorage, 'codebase-index')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${hash}.json`)
}

// 워크스페이스 walk — 인덱싱 대상 파일 수집
async function collectFiles(root: string, abortSignal?: AbortSignal): Promise<string[]> {
  const result: string[] = []
  async function walk(dir: string) {
    if (abortSignal?.aborted) return
    let entries: fs.Dirent[] = []
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (abortSignal?.aborted) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue
        if (e.name.startsWith('.') && !['.github'].includes(e.name)) continue
        await walk(full)
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (!INCLUDE_EXTS.has(ext)) continue
        try {
          const stat = await fs.promises.stat(full)
          if (stat.size > MAX_FILE_SIZE) continue
          result.push(full)
        } catch { continue }
      }
    }
  }
  await walk(root)
  return result
}

// 파일을 chunk로 분할 (라인 단위)
function chunkFile(filePath: string, content: string, mtime: number, workspaceRoot: string): Omit<IndexedChunk, 'embedding'>[] {
  const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
  const lines = content.split('\n')
  const chunks: Omit<IndexedChunk, 'embedding'>[] = []
  if (lines.length <= CHUNK_LINES) {
    chunks.push({
      id: `${rel}:0`,
      path: rel,
      startLine: 1,
      endLine: lines.length,
      text: `// ${rel}\n${content}`,
      fileMtime: mtime,
    })
    return chunks
  }
  const step = CHUNK_LINES - CHUNK_OVERLAP
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + CHUNK_LINES, lines.length)
    const chunkLines = lines.slice(start, end)
    chunks.push({
      id: `${rel}:${start}`,
      path: rel,
      startLine: start + 1,
      endLine: end,
      text: `// ${rel}:${start + 1}-${end}\n${chunkLines.join('\n')}`,
      fileMtime: mtime,
    })
    if (end >= lines.length) break
  }
  return chunks
}

export interface IndexProgress {
  phase: 'scanning' | 'chunking' | 'embedding' | 'saving' | 'done'
  files?: number
  chunks?: number
  embeddedChunks?: number
}

// 워크스페이스 전체 인덱싱
export async function buildIndex(
  workspaceRoot: string,
  globalStorage: string,
  apiKey: string,
  onProgress?: (p: IndexProgress) => void,
  abortSignal?: AbortSignal,
): Promise<CodebaseIndex> {
  onProgress?.({ phase: 'scanning' })
  const files = await collectFiles(workspaceRoot, abortSignal)
  log.info('index', `scanned ${files.length} files in ${workspaceRoot}`)
  onProgress?.({ phase: 'scanning', files: files.length })

  // chunking
  onProgress?.({ phase: 'chunking', files: files.length })
  const chunks: Omit<IndexedChunk, 'embedding'>[] = []
  for (const file of files) {
    if (abortSignal?.aborted) throw new Error('aborted')
    try {
      const content = await fs.promises.readFile(file, 'utf8')
      const stat = await fs.promises.stat(file)
      const fileChunks = chunkFile(file, content, stat.mtimeMs, workspaceRoot)
      chunks.push(...fileChunks)
    } catch (err) {
      log.warn('index', `skip ${file}: ${err}`)
    }
  }
  log.info('index', `created ${chunks.length} chunks`)

  // embedding
  onProgress?.({ phase: 'embedding', files: files.length, chunks: chunks.length, embeddedChunks: 0 })
  const indexedChunks: IndexedChunk[] = []
  const BATCH = 100
  for (let i = 0; i < chunks.length; i += BATCH) {
    if (abortSignal?.aborted) throw new Error('aborted')
    const batch = chunks.slice(i, i + BATCH)
    const { vectors } = await embedTexts(apiKey, batch.map(c => c.text))
    for (let j = 0; j < batch.length; j++) {
      indexedChunks.push({ ...batch[j], embedding: vectors[j] ?? [] })
    }
    onProgress?.({ phase: 'embedding', files: files.length, chunks: chunks.length, embeddedChunks: indexedChunks.length })
  }

  const index: CodebaseIndex = {
    version: INDEX_VERSION,
    workspaceRoot,
    indexedAt: Date.now(),
    totalFiles: files.length,
    totalChunks: indexedChunks.length,
    chunks: indexedChunks,
  }

  onProgress?.({ phase: 'saving' })
  const filePath = indexFilePath(globalStorage, workspaceRoot)
  await fs.promises.writeFile(filePath, JSON.stringify(index), 'utf8')
  log.info('index', `saved ${indexedChunks.length} chunks → ${filePath}`)

  onProgress?.({ phase: 'done', files: files.length, chunks: indexedChunks.length, embeddedChunks: indexedChunks.length })
  return index
}

// 디스크에서 인덱스 로드
export function loadIndex(globalStorage: string, workspaceRoot: string): CodebaseIndex | null {
  try {
    const filePath = indexFilePath(globalStorage, workspaceRoot)
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    const idx = JSON.parse(raw) as CodebaseIndex
    if (idx.version !== INDEX_VERSION) return null
    return idx
  } catch { return null }
}

// 한 파일만 re-index — 파일 변경 시 호출
export async function reindexFile(
  index: CodebaseIndex,
  filePath: string,
  apiKey: string,
  globalStorage: string,
): Promise<CodebaseIndex> {
  const rel = path.relative(index.workspaceRoot, filePath).replace(/\\/g, '/')
  // 기존 chunk 제거
  const remaining = index.chunks.filter(c => c.path !== rel)

  // 파일이 없거나 제외 대상이면 그냥 제거만
  if (!fs.existsSync(filePath)) {
    const updated: CodebaseIndex = { ...index, chunks: remaining, totalChunks: remaining.length, indexedAt: Date.now() }
    await fs.promises.writeFile(indexFilePath(globalStorage, index.workspaceRoot), JSON.stringify(updated), 'utf8')
    return updated
  }
  const ext = path.extname(filePath).toLowerCase()
  if (!INCLUDE_EXTS.has(ext)) {
    const updated: CodebaseIndex = { ...index, chunks: remaining, totalChunks: remaining.length, indexedAt: Date.now() }
    await fs.promises.writeFile(indexFilePath(globalStorage, index.workspaceRoot), JSON.stringify(updated), 'utf8')
    return updated
  }

  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const stat = await fs.promises.stat(filePath)
    if (stat.size > MAX_FILE_SIZE) {
      const updated: CodebaseIndex = { ...index, chunks: remaining, totalChunks: remaining.length, indexedAt: Date.now() }
      await fs.promises.writeFile(indexFilePath(globalStorage, index.workspaceRoot), JSON.stringify(updated), 'utf8')
      return updated
    }
    const newChunks = chunkFile(filePath, content, stat.mtimeMs, index.workspaceRoot)
    const { vectors } = await embedTexts(apiKey, newChunks.map(c => c.text))
    const newIndexed: IndexedChunk[] = newChunks.map((c, i) => ({ ...c, embedding: vectors[i] ?? [] }))
    const updated: CodebaseIndex = {
      ...index,
      chunks: [...remaining, ...newIndexed],
      totalChunks: remaining.length + newIndexed.length,
      indexedAt: Date.now(),
    }
    await fs.promises.writeFile(indexFilePath(globalStorage, index.workspaceRoot), JSON.stringify(updated), 'utf8')
    log.info('index', `re-indexed ${rel}: ${newIndexed.length} chunks`)
    return updated
  } catch (err) {
    log.warn('index', `reindex ${rel} failed:`, err)
    return index
  }
}
