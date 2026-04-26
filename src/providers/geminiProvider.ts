// src/providers/geminiProvider.ts
// Google Gemini CLI OAuth 경로 — 개인 Google 계정 무료 티어.
// 패키지가 ESM이라 esbuild의 require() 변환을 피하려고 Function 트릭으로 진짜 dynamic import 씀.

import { Effort } from '../router/types'
import { log } from '../util/log'

// 무료 티어: Pro는 5 RPM·100 RPD로 빡빡, Flash는 10 RPM·500 RPD로 여유.
// medium은 Flash로 두고 Pro는 high에서만. 429 뜨면 자동 Flash 폴백.
const MODEL_BY_EFFORT: Record<Effort, string> = {
  low: 'gemini-2.5-flash',
  medium: 'gemini-2.5-flash',
  high: 'gemini-2.5-pro',
  'extra-high': 'gemini-2.5-pro',
}
const FALLBACK_MODEL = 'gemini-2.5-flash'
const IMAGE_RE = /<image name="([^"]*)" mime="([^"]*)">(data:[^<]+)<\/image>/g

function isQuotaError(err: unknown): boolean {
  const s = String(err instanceof Error ? err.message : JSON.stringify(err))
  return /RESOURCE_EXHAUSTED|rateLimitExceeded|429|exhausted your capacity/i.test(s)
}

// esbuild는 static import / 분석가능한 dynamic import를 require()로 치환함.
// Function으로 감싸면 런타임까지 import() 그대로 남아 Node가 ESM으로 로드함.
const esmImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>

let _cache: { streamText: any; provider: any } | null = null

async function loadGemini() {
  if (_cache) return _cache
  const [aiMod, geminiMod] = await Promise.all([
    esmImport('ai'),
    esmImport('ai-sdk-provider-gemini-cli'),
  ])
  const provider = geminiMod.createGeminiProvider({ authType: 'oauth-personal' })
  _cache = { streamText: aiMod.streamText, provider }
  return _cache
}

function toGeminiMessage(m: { role: 'user' | 'assistant'; content: string }): any {
  const images: Array<{ name: string; mime: string; dataUrl: string }> = []
  const text = m.content.replace(IMAGE_RE, (_full, name, mime, dataUrl) => {
    images.push({ name, mime, dataUrl })
    return `[attached image: ${name}]`
  })

  if (images.length === 0) {
    return { role: m.role, content: m.content }
  }

  return {
    role: m.role,
    content: [
      { type: 'text', text },
      ...images.map(img => ({
        type: 'image',
        image: img.dataUrl,
        mediaType: img.mime,
      })),
    ],
  }
}

async function runOnce(
  modelName: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onChunk: (text: string) => void,
  systemPrompt?: string,
  abortSignal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number; error?: unknown }> {
  const { streamText, provider } = await loadGemini()

  const result = streamText({
    model: provider(modelName),
    system: systemPrompt ?? 'You are an expert coding assistant.',
    messages: messages.map(toGeminiMessage),
    abortSignal,
    onError: ({ error }: { error: unknown }) => {
      console.error('[Gemini streamText error]', error)
    },
  })

  let fullContent = ''
  let streamError: unknown = null
  const seenTypes: string[] = []

  log.info('gemini', `call ${modelName}, messages=${messages.length}, sys_len=${systemPrompt?.length ?? 0}`)

  try {
    for await (const part of result.fullStream) {
      const p = part as any
      seenTypes.push(p.type)
      if (p.type === 'error') {
        streamError = p.error
        log.error('gemini', 'stream error chunk:', p.error)
        continue
      }
      if (typeof p.text === 'string' && p.text) {
        fullContent += p.text
        onChunk(p.text)
      } else if (typeof p.textDelta === 'string' && p.textDelta) {
        fullContent += p.textDelta
        onChunk(p.textDelta)
      } else if (typeof p.delta === 'string' && p.delta) {
        fullContent += p.delta
        onChunk(p.delta)
      }
    }
  } catch (err) {
    log.error('gemini', `stream exception on ${modelName}:`, err)
    return { content: '', inputTokens: 0, outputTokens: 0, error: err }
  }

  const uniq = [...new Set(seenTypes)].join(', ')
  log.info('gemini', `${modelName} done. len=${fullContent.length}, parts=[${uniq}]`)

  if (streamError) return { content: '', inputTokens: 0, outputTokens: 0, error: streamError }

  if (!fullContent) {
    try {
      const finalText = await result.text
      if (finalText) { fullContent = finalText; onChunk(finalText) }
    } catch (err) {
      log.error('gemini', `result.text failed:`, err)
      return { content: '', inputTokens: 0, outputTokens: 0, error: err }
    }
  }

  if (!fullContent) {
    // finishReason 확인 (safety 필터면 보통 'other' 나 'content-filter')
    let finishReason: string | undefined
    try { finishReason = await result.finishReason } catch {}
    log.warn('gemini', `${modelName} empty response. finishReason=${finishReason}, parts=[${uniq}]`)
    return {
      content: '', inputTokens: 0, outputTokens: 0,
      error: new Error(`빈 응답 (finishReason: ${finishReason ?? 'unknown'}, parts: ${uniq || 'none'}) — Gemini 안전 필터일 수 있음`),
    }
  }

  const usage = await result.usage
  return {
    content: fullContent,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  }
}

export async function callGemini(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  effort: Effort,
  onChunk: (text: string) => void,
  systemPrompt?: string,
  abortSignal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  if (abortSignal?.aborted) throw new Error('aborted')
  const primaryModel = MODEL_BY_EFFORT[effort]
  let res = await runOnce(primaryModel, messages, onChunk, systemPrompt, abortSignal)

  // Pro 쿼터 터졌으면 Flash로 폴백. (Flash도 터지면 그대로 에러)
  if (res.error && isQuotaError(res.error) && primaryModel !== FALLBACK_MODEL) {
    if (abortSignal?.aborted) throw new Error('aborted')
    console.warn(`[Gemini] ${primaryModel} quota exhausted, falling back to ${FALLBACK_MODEL}`)
    res = await runOnce(FALLBACK_MODEL, messages, onChunk, systemPrompt, abortSignal)
  }

  if (res.error) {
    const m = res.error instanceof Error ? res.error.message : JSON.stringify(res.error)
    throw new Error(`Gemini ?묐떟 ?ㅽ뙣: ${m}`)
  }
  if (!res.content) {
    throw new Error(
      'Gemini 응답이 비어있습니다. 터미널에서 "gemini" 실행해서 Google 로그인 상태 확인해주세요.',
    )
  }

  return { content: res.content, inputTokens: res.inputTokens, outputTokens: res.outputTokens }
}

