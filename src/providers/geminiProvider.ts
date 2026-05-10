// src/providers/geminiProvider.ts
// Google Gemini CLI OAuth 경로 — 개인 Google 계정 무료 티어.
// 패키지가 ESM이라 esbuild의 require() 변환을 피하려고 Function 트릭으로 진짜 dynamic import 씀.

import { Effort } from '../router/types'
import { log } from '../util/log'
import { isQuotaError } from '../util/quota'
import { getGeminiModelOverride } from '../util/modelOverride'

// 무료 티어: Pro는 5 RPM·100 RPD로 빡빡, Flash는 10 RPM·500 RPD로 여유.
// medium은 Flash로 두고 Pro는 high에서만. 429 뜨면 자동 Flash 폴백.
// 2.5-flash 가 RESOURCE_EXHAUSTED 시 1.5-flash 로 한 번 더 시도 (1.5 가 capacity 더 안정적).
const MODEL_BY_EFFORT: Record<Effort, string> = {
  low: 'gemini-2.5-flash',
  medium: 'gemini-2.5-flash',
  high: 'gemini-2.5-pro',
  'extra-high': 'gemini-2.5-pro',
}
const FALLBACK_MODEL = 'gemini-2.5-flash'
// 2.5 둘 다 막혔을 때 최후의 보루 — gemini-1.5-flash 는 v1beta 에서 NOT_FOUND, 2.0-flash 가 안정.
const STABLE_FALLBACK_MODEL = 'gemini-2.0-flash'
const IMAGE_RE = /<image name="([^"]*)" mime="([^"]*)">(data:[^<]+)<\/image>/g

// esbuild는 static import / 분석가능한 dynamic import를 require()로 치환함.
// Function으로 감싸면 런타임까지 import() 그대로 남아 Node가 ESM으로 로드함.
const esmImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>

let _cache: { streamText: any; provider: any } | null = null
// 사용자가 입력한 Gemini API key 가 있으면 그쪽으로 호출 (한도 더 큼, 안정적). 없으면 OAuth tier.
let _apiKey: string | null = null
export function setGeminiApiKey(key: string | null) {
  if (_apiKey === key) return
  _apiKey = key
  _cache = null  // provider 재생성 강제
}

async function loadGemini() {
  if (_cache) return _cache
  const [aiMod, geminiMod] = await Promise.all([
    esmImport('ai'),
    esmImport('ai-sdk-provider-gemini-cli'),
  ])
  // API key 있으면 그걸로 (Code Assist OAuth tier 보다 한도 큼, 안전 필터 동일하지만 RPM/RPD 여유)
  const provider = _apiKey
    ? geminiMod.createGeminiProvider({ authType: 'gemini-api-key', apiKey: _apiKey })
    : geminiMod.createGeminiProvider({ authType: 'oauth-personal' })
  log.info('gemini', `provider loaded with authType=${_apiKey ? 'gemini-api-key' : 'oauth-personal'}`)
  _cache = { streamText: aiMod.streamText, provider }
  return _cache
}

function toGeminiMessage(m: { role: 'user' | 'assistant'; content: string }): any {
  const attachments: Array<{ name: string; mime: string; dataUrl: string }> = []
  const text = m.content.replace(IMAGE_RE, (_full, name, mime, dataUrl) => {
    attachments.push({ name, mime, dataUrl })
    return `[attached: ${name}]`
  })

  if (attachments.length === 0) {
    return { role: m.role, content: m.content }
  }

  // Vercel AI SDK content blocks — image/file 분기
  // - image: 'image/*' (png/jpg/gif/webp/svg)
  // - file:  'application/pdf' / 'text/*' 등 (Gemini 가 multimodal 로 PDF 도 받음)
  return {
    role: m.role,
    content: [
      { type: 'text', text },
      ...attachments.map(a => {
        if (a.mime.startsWith('image/')) {
          return { type: 'image', image: a.dataUrl, mediaType: a.mime }
        }
        // PDF / 기타 binary — Vercel AI SDK 의 file 타입
        return { type: 'file', data: a.dataUrl, mediaType: a.mime, filename: a.name }
      }),
    ],
  }
}

// 호출자가 폴백 발생 시 사용자에게 알릴 수 있게 콜백 받음
let _fallbackNotifier: ((from: string, to: string, reason: string) => void) | undefined
export function setGeminiFallbackNotifier(fn: typeof _fallbackNotifier) {
  _fallbackNotifier = fn
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
    maxOutputTokens: 65536,  // Gemini 2.5 한도까지 — 한 턴에 큰 프로그램도
    // safetySettings 강제 주입 시도 — ai-sdk-provider-gemini-cli 가 노출 안 하지만 underlying 까지 떠넘겨봄.
    // 작동하면 평범한 query 도 빈 응답 안 됨 / 작동 안 해도 부작용 없음.
    providerOptions: {
      gemini: {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
        ],
      },
    } as any,
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
      // Vercel AI SDK 5.x — text는 다양한 위치에 올 수 있음. 모든 후보 자리에서 추출
      const candidates: any[] = [
        p.text, p.textDelta, p.delta,
        p?.delta?.text, p?.delta?.textDelta,
        p?.content, p?.value,
      ]
      let extracted: string | null = null
      for (const c of candidates) {
        if (typeof c === 'string' && c) { extracted = c; break }
      }
      if (extracted) {
        fullContent += extracted
        onChunk(extracted)
        continue
      }
      // 알려진 필드에서 못 찾으면 raw JSON에서 한 번 더 시도 (SDK 버전 따라 nested 위치 다름)
      if (/text|delta/i.test(p.type ?? '')) {
        try {
          const raw = JSON.stringify(p)
          const m = raw.match(/"(?:text|textDelta|delta)"\s*:\s*"((?:[^"\\]|\\.)*)"/)
          if (m && m[1]) {
            const decoded = JSON.parse(`"${m[1]}"`)
            if (typeof decoded === 'string' && decoded) {
              fullContent += decoded
              onChunk(decoded)
            }
          }
        } catch {}
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
): Promise<{ content: string; inputTokens: number; outputTokens: number; usedModel: string }> {
  if (abortSignal?.aborted) throw new Error('aborted')
  const userOverride = getGeminiModelOverride()
  const primaryModel = userOverride !== 'auto' ? userOverride : MODEL_BY_EFFORT[effort]
  let res = await runOnce(primaryModel, messages, onChunk, systemPrompt, abortSignal)
  let usedModel = primaryModel

  // Pro 쿼터 터졌으면 Flash로 폴백
  if (res.error && isQuotaError(res.error) && primaryModel !== FALLBACK_MODEL) {
    if (abortSignal?.aborted) throw new Error('aborted')
    log.warn('gemini', `${primaryModel} quota exhausted, falling back to ${FALLBACK_MODEL}`)
    _fallbackNotifier?.(primaryModel, FALLBACK_MODEL, 'quota')
    res = await runOnce(FALLBACK_MODEL, messages, onChunk, systemPrompt, abortSignal)
    if (!res.error && res.content) usedModel = FALLBACK_MODEL
  }

  // 빈 응답 (Pro의 thinking 모델이 long-context에서 종종 발생) → Flash 자동 폴백
  const isEmptyResponse = !res.error && !res.content
  const isFinishStopEmpty = res.error instanceof Error && /빈 응답.*finishReason: stop/.test(res.error.message)
  if ((isEmptyResponse || isFinishStopEmpty) && primaryModel !== FALLBACK_MODEL) {
    if (abortSignal?.aborted) throw new Error('aborted')
    log.warn('gemini', `${primaryModel} empty response, falling back to ${FALLBACK_MODEL}`)
    _fallbackNotifier?.(primaryModel, FALLBACK_MODEL, 'empty response (safety filter?)')
    res = await runOnce(FALLBACK_MODEL, messages, onChunk, systemPrompt, abortSignal)
    if (!res.error && res.content) usedModel = FALLBACK_MODEL
  }

  // 2.5-flash 까지 RESOURCE_EXHAUSTED / 빈 응답이면 1.5-flash 로 최후 시도 (1.5 가 capacity 더 안정적)
  const stillFailing = res.error || !res.content
  if (stillFailing) {
    if (abortSignal?.aborted) throw new Error('aborted')
    log.warn('gemini', `2.5 series exhausted, last-resort fallback to ${STABLE_FALLBACK_MODEL}`)
    _fallbackNotifier?.(FALLBACK_MODEL, STABLE_FALLBACK_MODEL, '2.5 capacity exhausted, trying 1.5')
    res = await runOnce(STABLE_FALLBACK_MODEL, messages, onChunk, systemPrompt, abortSignal)
    if (!res.error && res.content) usedModel = STABLE_FALLBACK_MODEL
  }

  if (res.error) {
    const m = res.error instanceof Error ? res.error.message : JSON.stringify(res.error)
    throw new Error(`Gemini 응답 실패: ${m}`)
  }
  if (!res.content) {
    throw new Error(
      'Gemini 응답이 비어있습니다. 터미널에서 "gemini" 실행해서 Google 로그인 상태 확인해주세요.',
    )
  }

  return { content: res.content, inputTokens: res.inputTokens, outputTokens: res.outputTokens, usedModel }
}

