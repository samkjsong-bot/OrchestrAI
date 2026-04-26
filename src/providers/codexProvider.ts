// src/providers/codexProvider.ts
// ChatGPT 구독 기반 Codex 호출 — api.openai.com(API 과금) 아닌 chatgpt.com 백엔드 사용.
// 진짜 Codex CLI fingerprint를 따라가지 않으면 OpenAI가 401/403/429로 거절함.

import * as os from 'os'
import { Effort } from '../router/types'

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
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  if (!accountId) {
    throw new Error('Codex 계정 ID가 없습니다. 다시 로그인해주세요.')
  }

  const body = {
    model: MODEL_BY_EFFORT[effort],
    instructions: systemPrompt ?? 'You are an expert coding assistant.',
    input: messages.map(m => ({ role: m.role, content: m.content })),
    stream: true,
    store: false,
    reasoning: { effort },
  }

  // 429/5xx엔 지수 백오프 재시도 (스트림 시작 전까지만)
  const MAX_ATTEMPTS = 3
  let res: Response | null = null
  let lastErr: { status: number; text: string } | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'User-Agent': USER_AGENT,
        'ChatGPT-Account-ID': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': ORIGINATOR,
      },
      body: JSON.stringify(body),
      signal: abortSignal,  // kill switch 누르면 fetch 취소
    })
    if (r.ok) { res = r; break }

    const isRetryable = r.status === 429 || r.status >= 500
    lastErr = { status: r.status, text: await r.text().catch(() => '') }
    if (!isRetryable || attempt === MAX_ATTEMPTS - 1) break
    await new Promise((s) => setTimeout(s, 1000 * 2 ** attempt))
  }

  if (!res) {
    throw new Error(`Codex ?붿껌 ?ㅽ뙣 (${lastErr?.status}): ${lastErr?.text.slice(0, 200)}`)
  }
  if (!res.body) {
    throw new Error('Codex 응답에 body가 없습니다')
  }

  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0

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

      let event: SSEEvent
      try { event = JSON.parse(data) } catch { continue }

      if (event.type === 'response.output_text.delta') {
        const delta = sanitizeCodexDelta(event.delta ?? '')
        if (delta) {
          fullContent += delta
          onChunk(delta)
        }
      } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
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
      }
    }
  }

  return { content: fullContent, inputTokens, outputTokens }
}

