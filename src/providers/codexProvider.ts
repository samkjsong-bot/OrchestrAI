// src/providers/codexProvider.ts
// ChatGPT 구독 기반 Codex 호출 — api.openai.com(API 과금) 아닌 chatgpt.com 백엔드 사용.
// 진짜 Codex CLI fingerprint를 따라가지 않으면 OpenAI가 401/403/429로 거절함.

import * as os from 'os'
import { Effort } from '../router/types'
import { log } from '../util/log'
import { getCodexModelOverride } from '../util/modelOverride'

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const ORIGINATOR = 'codex_cli_rs'
const CLI_VERSION = '0.40.0'
const USER_AGENT = `${ORIGINATOR}/${CLI_VERSION} (${os.type()} ${os.release()}; ${os.arch()})`

// ChatGPT 구독 경로 전용 모델 ('gpt-5'는 API 키 전용이라 구독으론 거절됨)
const MODEL_BY_EFFORT: Record<Effort, string> = {
  low: 'gpt-5.4-mini',    // 빠르고 가벼운 작업
  medium: 'gpt-5.4',      // 기본
  high: 'gpt-5.5',        // 복잡한 추론 (Pro 플랜)
  'extra-high': 'gpt-5.5',
}

// 모델 자동 전환(예: 5.5 quota → 5.4) 시 UI 알림 콜백.
// extension.ts에서 등록 — webview에 modelFallback 메시지를 쏨.
let _codexFallbackNotifier: ((from: string, to: string, reason: string) => void) | undefined
export function setCodexFallbackNotifier(fn: typeof _codexFallbackNotifier) {
  _codexFallbackNotifier = fn
}

function isCodexQuotaError(status: number, text: string): boolean {
  if (status === 429) return true
  return /rate.?limit|quota|usage.?limit|exhausted/i.test(text)
}

interface SSEEvent {
  type?: string
  delta?: string
  item?: { type?: string; name?: string; arguments?: string; call_id?: string }
  response?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

// Codex가 raw text에 잘린 JSON fragment / literal escape 흘려보낼 때 정리
function sanitizeCodexDelta(s: string): string {
  return s
    .replace(/\\n@@\\n/g, '\n\n')
    .replace(/】【/g, '')
}

// 툴 호출 인자 한 줄 요약 (UI 박스로 변환되는 ⏺ 라인용)
function summarizeToolArgs(name: string, argsJson: string): string {
  let args: any = {}
  try { args = JSON.parse(argsJson || '{}') } catch { return argsJson.slice(0, 80) }
  const trim = (v: any, n = 80) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim()
    return s.length > n ? s.slice(0, n) + '…' : s
  }
  if (args.path) return trim(args.path, 100) + (args.recursive ? ' (recursive)' : '')
  if (args.command) return trim(args.command, 100)
  if (args.file_path) return trim(args.file_path, 100)
  if (args.url) return trim(args.url, 100)
  if (args.query) return trim(args.query, 100)
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  return keys.slice(0, 2).map(k => `${k}=${trim(args[k], 40)}`).join(', ')
}

export async function callCodex(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  effort: Effort,
  accessToken: string,
  onChunk: (text: string) => void,
  systemPrompt?: string,
  accountId?: string,
  abortSignal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number; usedModel: string }> {
  if (!accountId) {
    throw new Error('Codex 계정 ID가 없습니다. 다시 로그인해주세요.')
  }
  const verifiedAccountId: string = accountId  // closure에서 type narrowing 유지

  // 사용자 settings 에서 모델 강제했으면 그걸 우선
  const userOverride = getCodexModelOverride()
  const primaryModel = userOverride !== 'auto' ? userOverride : MODEL_BY_EFFORT[effort]
  const FALLBACK_MODEL = 'gpt-5.4-mini'
  log.info('codex', `call: model=${primaryModel}, effort=${effort}, override=${userOverride}, msgCount=${messages.length}`)

  // multimodal: 마지막 user message 의 <image name="..." mime="image/..." data:...></image> 태그 추출 → input_image content 로 변환
  // OpenAI Responses API 형식: { role, content: [{type: 'input_text', text: '...'}, {type: 'input_image', image_url: 'data:...'}] }
  // 단 chatgpt.com 백엔드 우회 경로 — image 만 지원 (PDF/audio/video 미지원)
  const ATTACHMENT_RE = /<image name="([^"]*)" mime="([^"]*)">(data:[^<]+)<\/image>/g
  const transformedInput = messages.map((m, i) => {
    if (i !== messages.length - 1 || m.role !== 'user') {
      // 다른 메시지는 image tag strip (raw HTML 태그 안 보내려고)
      return { role: m.role, content: m.content.replace(ATTACHMENT_RE, (_f, name) => `[attached: ${name}]`) }
    }
    // 마지막 user — image 추출 후 multimodal content
    const imageBlocks: Array<{ type: 'input_image'; image_url: string }> = []
    const text = m.content.replace(ATTACHMENT_RE, (_full, _name, mime, dataUrl) => {
      const mimeStr = String(mime)
      if (mimeStr.startsWith('image/')) {
        imageBlocks.push({ type: 'input_image', image_url: String(dataUrl) })
        return ''
      }
      return `[attached: ${_name} (${mimeStr})]`  // PDF/audio/video 는 raw fallback
    })
    if (imageBlocks.length === 0) {
      return { role: m.role, content: text }
    }
    return {
      role: m.role,
      content: [{ type: 'input_text' as const, text }, ...imageBlocks],
    }
  })

  // 한 모델로 fetch 시도 (429/5xx 지수 백오프 재시도 포함, 스트림 시작 전까지)
  async function tryFetch(model: string): Promise<{ res: Response | null; lastErr: { status: number; text: string } | null }> {
    const body = {
      model,
      instructions: systemPrompt ?? 'You are an expert coding assistant.',
      input: transformedInput,
      stream: true,
      store: false,
      reasoning: { effort },
    }
    const MAX_ATTEMPTS = 3
    let lastErr: { status: number; text: string } | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'User-Agent': USER_AGENT,
          'ChatGPT-Account-ID': verifiedAccountId,
          'OpenAI-Beta': 'responses=experimental',
          'originator': ORIGINATOR,
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      })
      if (r.ok) return { res: r, lastErr: null }

      const isRetryable = r.status === 429 || r.status >= 500
      lastErr = { status: r.status, text: await r.text().catch(() => '') }
      if (!isRetryable || attempt === MAX_ATTEMPTS - 1) break
      await new Promise((s) => setTimeout(s, 1000 * 2 ** attempt))
    }
    return { res: null, lastErr }
  }

  let { res, lastErr } = await tryFetch(primaryModel)
  let usedModel = primaryModel

  // Pro 플랜 모델(gpt-5.5)이 quota 파산이면 mini로 폴백 (모든 챗GPT 구독 공통 가능)
  if (!res && lastErr && primaryModel !== FALLBACK_MODEL && isCodexQuotaError(lastErr.status, lastErr.text)) {
    _codexFallbackNotifier?.(primaryModel, FALLBACK_MODEL, `quota (${lastErr.status})`)
    const retry = await tryFetch(FALLBACK_MODEL)
    res = retry.res
    if (!res) lastErr = retry.lastErr
    else usedModel = FALLBACK_MODEL
  }

  if (!res) {
    throw new Error(`Codex 요청 실패 (${lastErr?.status}): ${lastErr?.text.slice(0, 200)}`)
  }
  if (!res.body) {
    throw new Error('Codex 응답에 body가 없습니다')
  }

  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0
  const seenEventTypes: Record<string, number> = {}  // 디버그용 이벤트 타입 카운트

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

    // SSE는 라인 단위 파싱. 마지막 불완전 라인은 버퍼에 보존
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data || data === '[DONE]') continue

      let event: SSEEvent & { text?: string; output_text?: string; content?: any }
      try { event = JSON.parse(data) } catch { continue }

      if (event.type) seenEventTypes[event.type] = (seenEventTypes[event.type] ?? 0) + 1

      // 1차: 표준 delta 이벤트
      if (event.type === 'response.output_text.delta') {
        const delta = sanitizeCodexDelta(event.delta ?? '')
        if (delta) {
          fullContent += delta
          onChunk(delta)
        }
      }
      // 2차: 모델/버전에 따라 final text가 .done 이벤트로 한 번에 올 때
      else if (event.type === 'response.output_text.done' && (event as any).text) {
        const finalText = sanitizeCodexDelta(String((event as any).text))
        if (finalText && !fullContent.endsWith(finalText)) {
          fullContent += finalText
          onChunk(finalText)
        }
      }
      // 3차: content part로 text가 들어오는 케이스 (gpt-5.5 reasoning 모델 일부 변형)
      else if (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') {
        const part = (event as any).part
        const partText = typeof part?.text === 'string' ? part.text : null
        if (partText) {
          const sanitized = sanitizeCodexDelta(partText)
          if (sanitized) { fullContent += sanitized; onChunk(sanitized) }
        }
      }
      else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        // 툴 호출 시작 — 박스 한 줄로 표시 (Claude provider와 같은 ⏺ 형식)
        const name = event.item.name ?? 'unknown'
        const line = `\n\n  ⏺ ${name}\n`
        fullContent += line
        onChunk(line)
      } else if (event.type === 'response.function_call_arguments.done' && event.item) {
        // 툴 호출 완료 — 인자 요약 추가
        const name = event.item.name ?? 'unknown'
        const args = summarizeToolArgs(name, event.item.arguments ?? '')
        // 직전 ⏺ name 라인을 더 풍부한 ⏺ name(args) 라인으로 교체
        const replaceRe = new RegExp(`(  ⏺ ${name})(?!\\()`)
        const enriched = `  ⏺ ${name}(${args})`
        if (replaceRe.test(fullContent)) {
          fullContent = fullContent.replace(replaceRe, enriched)
          // webview는 누적 stream을 다시 그리니까 한 번 더 onChunk해서 trigger
          onChunk('')
        } else {
          const line = `\n  ⏺ ${name}(${args})\n`
          fullContent += line
          onChunk(line)
        }
      } else if (event.type === 'response.completed') {
        const usage = event.response?.usage
        if (usage) {
          inputTokens = usage.input_tokens ?? 0
          outputTokens = usage.output_tokens ?? 0
        }
        // response.completed 안의 output 배열에 최종 텍스트가 통째로 담길 때 회수
        // (delta가 빠진 reasoning-only 응답이거나 stream 변형 케이스)
        if (!fullContent) {
          const outputs = (event.response as any)?.output
          if (Array.isArray(outputs)) {
            for (const item of outputs) {
              const parts = item?.content
              if (Array.isArray(parts)) {
                for (const p of parts) {
                  const text = typeof p?.text === 'string' ? p.text : null
                  if (text) {
                    const sanitized = sanitizeCodexDelta(text)
                    if (sanitized) { fullContent += sanitized; onChunk(sanitized) }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  log.info('codex', `events=${JSON.stringify(seenEventTypes)} content_len=${fullContent.length} out_tok=${outputTokens}`)

  // 토큰은 썼는데 본문이 비었으면 fallback 트리거 (catch 분기에서 다음 모델로)
  if (!fullContent && outputTokens > 0) {
    throw new Error(
      `Codex 빈 응답 (output_tokens=${outputTokens}). 받은 SSE 이벤트: ${Object.keys(seenEventTypes).join(', ') || 'none'}`,
    )
  }

  log.info('codex', `done: usedModel=${usedModel}, contentChars=${fullContent.length}, in=${inputTokens}, out=${outputTokens}`)
  return { content: fullContent, inputTokens, outputTokens, usedModel }
}

