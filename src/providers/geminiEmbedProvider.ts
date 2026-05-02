// src/providers/geminiEmbedProvider.ts
// Gemini text-embedding-004 — 768차원 벡터. 무료 티어 1500 RPD/RPM.
// 코드베이스 인덱싱(RAG)에 사용. API 키 필요 (이미지 생성과 동일 키).

import { log } from '../util/log'

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const EMBED_MODEL = 'text-embedding-004'
const EMBED_DIMS = 768
const BATCH_SIZE = 100  // batchEmbedContents 한 번에 최대 100개

export interface EmbedResult {
  vectors: number[][]    // 입력 순서 유지
  dims: number
}

export async function embedTexts(apiKey: string, texts: string[]): Promise<EmbedResult> {
  if (!apiKey) throw new Error('Gemini API 키가 없습니다.')
  if (texts.length === 0) return { vectors: [], dims: EMBED_DIMS }

  const allVectors: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const url = `${ENDPOINT_BASE}/${EMBED_MODEL}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`
    const body = {
      requests: batch.map(t => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t.slice(0, 8000) }] },  // 토큰 한도 안전마진
        taskType: 'RETRIEVAL_DOCUMENT',
      })),
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(`Embedding API ${res.status}: ${err.slice(0, 300)}`)
    }
    const data = await res.json() as any
    const embeddings: any[] = data?.embeddings ?? []
    for (const e of embeddings) {
      const vec = e?.values
      if (Array.isArray(vec)) allVectors.push(vec)
      else allVectors.push(new Array(EMBED_DIMS).fill(0))
    }
    log.info('embed', `batch ${i / BATCH_SIZE + 1}: ${batch.length} → ${embeddings.length} embeddings`)
  }

  return { vectors: allVectors, dims: EMBED_DIMS }
}

// 단일 query embed (검색용 — taskType=RETRIEVAL_QUERY)
export async function embedQuery(apiKey: string, query: string): Promise<number[]> {
  if (!apiKey) throw new Error('Gemini API 키가 없습니다.')
  const url = `${ENDPOINT_BASE}/${EMBED_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`
  const body = {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text: query.slice(0, 8000) }] },
    taskType: 'RETRIEVAL_QUERY',
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Embed query ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json() as any
  const vec = data?.embedding?.values
  if (!Array.isArray(vec)) throw new Error('Embedding query: invalid response')
  return vec
}

// cosine similarity — 인덱싱 후 query 매칭에 사용
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
