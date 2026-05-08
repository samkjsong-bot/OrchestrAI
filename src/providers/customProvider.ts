// src/providers/customProvider.ts
// OpenAI Chat Completions API 호환 endpoint 호출 — LM Studio, Ollama, OpenRouter,
// vLLM, Together, Anthropic API (with key), 등등 다 지원.
// 직접 fetch + SSE 파싱 (의존성 추가 0).

import { Effort } from '../router/types'
import { log } from './../util/log'

export interface CustomProviderConfig {
  name: string         // 사용자 정의 이름 (mention key 로 사용: @local, @ollama 등)
  baseUrl: string      // 예: 'http://localhost:1234/v1' (LM Studio), 'https://openrouter.ai/api/v1'
  apiKey?: string      // optional (LM Studio/Ollama 는 비어있어도 됨)
  model: string        // 모델 ID — 예: 'llama-3.3-70b', 'qwen2.5-coder', 'anthropic/claude-3.5-sonnet'
  contextWindow?: number  // 토큰 한계 (info 표시용)
  type?: 'openai' | 'anthropic'  // default openai (chat/completions). anthropic 은 messages API.
  headers?: Record<string, string>  // 추가 헤더
}

interface SSEEvent {
  choices?: Array<{
    delta?: { content?: string; role?: string }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export async function callCustomProvider(
  config: CustomProviderConfig,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  effort: Effort,
  onChunk: (text: string) => void,
  systemPrompt?: string,
  abortSignal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  // effort → temperature/maxtoken hint (custom provider 는 보통 자체 default 사용)
  const maxTokensByEffort: Record<Effort, number> = {
    low: 4096, medium: 16384, high: 64000, 'extra-high': 64000,
  }
  const body = {
    model: config.model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages,
    ],
    stream: true,
    max_tokens: maxTokensByEffort[effort],
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
    ...(config.headers ?? {}),
  }

  log.info('custom', `call ${config.name} (${config.model}) at ${config.baseUrl}`)

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Custom provider ${config.name} 요청 실패 (${res.status}): ${text.slice(0, 300)}`)
  }
  if (!res.body) throw new Error(`Custom provider ${config.name}: response body 없음`)

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
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data || data === '[DONE]') continue
      let event: SSEEvent
      try { event = JSON.parse(data) } catch { continue }
      const delta = event.choices?.[0]?.delta?.content
      if (delta) {
        fullContent += delta
        onChunk(delta)
      }
      if (event.usage) {
        inputTokens = event.usage.prompt_tokens ?? inputTokens
        outputTokens = event.usage.completion_tokens ?? outputTokens
      }
    }
  }

  return { content: fullContent, inputTokens, outputTokens }
}
