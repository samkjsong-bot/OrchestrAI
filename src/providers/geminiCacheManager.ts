// src/providers/geminiCacheManager.ts
// directive Phase 3 — Gemini API Context Cache.
//
// 큰 static (system prompt + project rules + file context) 을 한 번 Gemini API 에 올리고
// 이후 매 요청은 cache name 만 참조 → 입력 토큰 ~25% 단가 + 같은 토큰 재전송 X.
//
// 무료 OAuth tier 와 별개 경로 — 사용자가 명시적으로 enable + apiKey 등록한 경우만.
// 캐시 못 만들거나 호출 실패 시 caller 가 OAuth 경로로 자동 fallback.

import { createHash } from 'crypto'
import { log } from '../util/log'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_TTL_SEC = 600          // 10 분 — argue 라운드 + follow-up 충분
const REFRESH_BUFFER_SEC = 30        // 만료 30초 전이면 재생성
const MIN_CACHEABLE_TOKENS_FLASH = 1024  // Gemini 2.5 Flash 최소
const MIN_CACHEABLE_TOKENS_PRO   = 4096  // Gemini 2.5 Pro 최소
const MAX_CACHE_ENTRIES = 8          // 메모리 leak 방지 — LRU 식 유지

export interface CacheEntry {
  name: string         // 'cachedContents/...'
  hash: string         // 16-hex sha1 of (model + systemInstruction)
  model: string        // 'gemini-2.5-flash' (no 'models/' prefix)
  inputTokens: number  // 캐시된 시스템 instruction 토큰
  createdAt: number    // ms
  expiresAt: number    // ms
}

const _cacheByHash = new Map<string, CacheEntry>()

// exported for tests — pure functions, 캐시 state 안 건드림.
export function hashKey(model: string, systemInstruction: string): string {
  return createHash('sha1').update(model).update('\0').update(systemInstruction).digest('hex').slice(0, 16)
}

export function minTokensFor(model: string): number {
  return /pro/i.test(model) ? MIN_CACHEABLE_TOKENS_PRO : MIN_CACHEABLE_TOKENS_FLASH
}

export function isCacheableSize(model: string, systemInstruction: string): boolean {
  return estimateTokens(systemInstruction) >= minTokensFor(model)
}

function estimateTokens(text: string): number {
  const korean = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - korean
  return Math.ceil(korean + other / 4)
}

// LRU evict — entries 가 MAX 넘으면 가장 오래된 거 삭제 (Gemini 서버는 TTL 로 알아서 정리).
function evictIfNeeded() {
  while (_cacheByHash.size > MAX_CACHE_ENTRIES) {
    const oldest = [..._cacheByHash.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    if (!oldest) break
    _cacheByHash.delete(oldest[0])
    log.info('gemini-cache', `evicted ${oldest[0]} (LRU)`)
  }
}

async function createCacheRemote(args: {
  apiKey: string
  model: string
  systemInstruction: string
  ttlSec: number
}): Promise<CacheEntry | null> {
  const { apiKey, model, systemInstruction, ttlSec } = args
  const modelFull = model.startsWith('models/') ? model : `models/${model}`
  const url = `${API_BASE}/cachedContents?key=${apiKey}`
  // Gemini API 는 systemInstruction 만 있어도 cache 생성 가능 — contents 는 빈 배열 허용.
  // (일부 SDK 는 contents 강제하지만 REST 는 OK. 실패 시 dummy contents 로 retry.)
  const baseBody = {
    model: modelFull,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    ttl: `${ttlSec}s`,
  }
  const attemptVariants: Array<Record<string, unknown>> = [
    { ...baseBody, contents: [{ role: 'user', parts: [{ text: ' ' }] }] },  // dummy 1자 (1.5+ 호환)
    baseBody,                                                                  // contents 생략 (2.5+ 일부)
  ]
  for (const body of attemptVariants) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        log.warn('gemini-cache', `create attempt ${res.status}: ${text.slice(0, 200)}`)
        continue  // 다음 variant
      }
      const data = await res.json() as {
        name?: string
        usageMetadata?: { totalTokenCount?: number }
        expireTime?: string
      }
      if (!data.name) {
        log.warn('gemini-cache', 'create returned no name')
        continue
      }
      const tokens = data.usageMetadata?.totalTokenCount ?? estimateTokens(systemInstruction)
      const expiresAt = data.expireTime
        ? new Date(data.expireTime).getTime()
        : Date.now() + ttlSec * 1000
      const entry: CacheEntry = {
        name: data.name,
        hash: hashKey(model, systemInstruction),
        model,
        inputTokens: tokens,
        createdAt: Date.now(),
        expiresAt,
      }
      return entry
    } catch (err) {
      log.warn('gemini-cache', 'create exception:', err)
    }
  }
  return null
}

/** 캐시 보장 — hit 면 기존 name 반환, miss/만료 임박이면 새로 생성. 실패 시 null. */
export async function ensureGeminiCache(args: {
  apiKey: string
  model: string
  systemInstruction: string
  ttlSec?: number
}): Promise<{ name: string; tokens: number; hit: boolean; hash: string } | null> {
  const { apiKey, model, systemInstruction } = args
  const ttlSec = args.ttlSec ?? DEFAULT_TTL_SEC

  // 캐시 최소 토큰 미달이면 skip — Gemini API 가 거절.
  const tokens = estimateTokens(systemInstruction)
  const minTok = minTokensFor(model)
  if (tokens < minTok) {
    log.info('gemini-cache', `static too small (${tokens} < ${minTok} tok for ${model}) — skip cache`)
    return null
  }

  const hash = hashKey(model, systemInstruction)
  const existing = _cacheByHash.get(hash)
  const nowMs = Date.now()
  if (existing && existing.expiresAt - nowMs > REFRESH_BUFFER_SEC * 1000) {
    log.info('gemini-cache', `hit ${hash} (${existing.inputTokens} tok, ${Math.round((existing.expiresAt - nowMs) / 1000)}s left)`)
    return { name: existing.name, tokens: existing.inputTokens, hit: true, hash }
  }
  if (existing) {
    log.info('gemini-cache', `expired/near-expiry → recreate ${hash}`)
    _cacheByHash.delete(hash)
  }
  const created = await createCacheRemote({ apiKey, model, systemInstruction, ttlSec })
  if (!created) return null
  _cacheByHash.set(hash, created)
  evictIfNeeded()
  log.info('gemini-cache', `created ${hash} (${created.inputTokens} tok, ttl ${ttlSec}s, name=${created.name})`)
  return { name: created.name, tokens: created.inputTokens, hit: false, hash }
}

/** 캐시 명시 무효화 (system prompt 가 바뀐 게 확실할 때). */
export function invalidateGeminiCache(hash?: string): void {
  if (hash) _cacheByHash.delete(hash)
  else _cacheByHash.clear()
}

export function listGeminiCaches(): CacheEntry[] {
  return Array.from(_cacheByHash.values())
}

// ── 캐시 참조하는 generation 호출 ─────────────────────────────────────
//
// REST API 직접 호출 (ai-sdk-provider-gemini-cli 는 cachedContent 미지원).
// 스트리밍 SSE 파싱 — customProvider.ts 와 동일 패턴.

export async function callGeminiCached(args: {
  apiKey: string
  model: string
  cachedContent: string                            // 'cachedContents/...'
  dynamicMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  onChunk: (text: string) => void
  abortSignal?: AbortSignal
  generationConfig?: { maxOutputTokens?: number; temperature?: number; topP?: number }
}): Promise<{ content: string; inputTokens: number; outputTokens: number; cachedInputTokens: number }> {
  const { apiKey, model, cachedContent, dynamicMessages, onChunk, abortSignal, generationConfig } = args
  const modelFull = model.startsWith('models/') ? model : `models/${model}`
  const url = `${API_BASE}/${modelFull}:streamGenerateContent?alt=sse&key=${apiKey}`
  const contents = dynamicMessages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }))
  const body: Record<string, unknown> = { contents, cachedContent }
  if (generationConfig) body.generationConfig = generationConfig

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gemini API (cached) ${res.status}: ${text.slice(0, 300)}`)
  }
  if (!res.body) throw new Error('Gemini API (cached): response body 없음')

  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    if (abortSignal?.aborted) {
      try { await reader.cancel() } catch {}
      throw new Error('aborted')
    }
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data) continue
      let event: any
      try { event = JSON.parse(data) } catch { continue }
      const candidates = event.candidates ?? []
      for (const c of candidates) {
        const parts = c.content?.parts ?? []
        for (const p of parts) {
          if (typeof p.text === 'string' && p.text.length > 0) {
            fullContent += p.text
            onChunk(p.text)
          }
        }
      }
      if (event.usageMetadata) {
        inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens
        outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens
        cachedInputTokens = event.usageMetadata.cachedContentTokenCount ?? cachedInputTokens
      }
    }
  }
  return { content: fullContent, inputTokens, outputTokens, cachedInputTokens }
}

/** 통계 — UI 에 cache 상태 노출 (몇 개 활성 / 총 캐시된 토큰). */
export function geminiCacheStats(): { entries: number; totalCachedTokens: number; nearExpiry: number } {
  const now = Date.now()
  let total = 0
  let near = 0
  for (const e of _cacheByHash.values()) {
    total += e.inputTokens
    if (e.expiresAt - now < 60_000) near++
  }
  return { entries: _cacheByHash.size, totalCachedTokens: total, nearExpiry: near }
}
