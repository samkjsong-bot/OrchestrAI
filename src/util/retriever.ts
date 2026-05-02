// src/util/retriever.ts
// 사용자 query → embedding → 인덱스에서 top-K cosine similarity → 컨텍스트 블록 생성

import { embedQuery, cosineSim } from '../providers/geminiEmbedProvider'
import type { CodebaseIndex, IndexedChunk } from './codebaseIndex'
import { log } from './log'

export interface RetrievalResult {
  chunks: Array<IndexedChunk & { score: number }>
  contextBlock: string  // 시스템 프롬프트에 직접 첨부 가능한 형식
}

// query에 가장 가까운 top-K chunk 찾기
export async function retrieve(
  index: CodebaseIndex,
  query: string,
  apiKey: string,
  options?: { topK?: number; minScore?: number; perFileMax?: number },
): Promise<RetrievalResult> {
  const topK = options?.topK ?? 6
  const minScore = options?.minScore ?? 0.55
  const perFileMax = options?.perFileMax ?? 2  // 같은 파일 최대 2 chunk (다양성)

  const queryVec = await embedQuery(apiKey, query)

  // 모든 chunk 점수 계산
  const scored = index.chunks.map(c => ({ ...c, score: cosineSim(queryVec, c.embedding) }))
  scored.sort((a, b) => b.score - a.score)

  // per-file 제한 + minScore 필터
  const fileCount = new Map<string, number>()
  const selected: typeof scored = []
  for (const c of scored) {
    if (c.score < minScore) break
    const cnt = fileCount.get(c.path) ?? 0
    if (cnt >= perFileMax) continue
    selected.push(c)
    fileCount.set(c.path, cnt + 1)
    if (selected.length >= topK) break
  }

  // 컨텍스트 블록 생성 (모델에 첨부할 형식)
  const contextBlock = selected.length === 0
    ? ''
    : `RELATED CODE CONTEXT (auto-retrieved from codebase index):

${selected.map(c => `[${c.path}:${c.startLine}-${c.endLine}] (relevance ${(c.score * 100).toFixed(0)}%)
\`\`\`
${c.text.split('\n').slice(1).join('\n').slice(0, 3000)}
\`\`\``).join('\n\n')}

---
Use the above as reference. The user's question follows.`

  log.info('retrieve', `query="${query.slice(0, 60)}" → ${selected.length} chunks (top score=${selected[0]?.score.toFixed(2) ?? 'n/a'})`)
  return { chunks: selected, contextBlock }
}
