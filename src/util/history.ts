// src/util/history.ts
// 모델별 히스토리 자르기 규칙.
// 토큰 효율 + 각 모델 컨텍스트 강점에 맞춰 차등.

import { Model, ChatMessage } from '../router/types'
import type { CompactionState } from './compaction'

// 모델별 최대 메시지 수. Claude Code / Codex CLI 가 자체적으로 거의 무제한 보내는 패턴 따라감.
// compaction이 토큰 한계 가까워지면 알아서 압축하니 메시지 수 limit은 안전망 역할만.
// Claude Sonnet 4.6: 1M window, Opus 4.6: 200k. 메시지 1개 평균 ~500토큰이면 1000개=500k.
// Codex (gpt-5): 256k. Gemini 2.5 Flash: 1M, Pro: 2M.
const PRESETS: Record<'narrow' | 'default' | 'wide', Record<Model, number>> = {
  narrow:  { claude: 60, codex: 40, gemini: 100 },     // 토큰 절약 원할 때
  default: { claude: 500, codex: 300, gemini: 1000 },  // Claude Code/Codex 수준 — 사실상 무제한
  wide:    { claude: 2000, codex: 1500, gemini: 5000 },// 진짜 긴 작업 (큰 코드베이스 단위)
}

// VSCode setting `orchestrai.contextWindow` 로 결정. 안 받아오면 default.
let _activePreset: 'narrow' | 'default' | 'wide' = 'default'
export function setContextWindowPreset(preset: 'narrow' | 'default' | 'wide') {
  _activePreset = preset
}
function getMaxMessages(forModel: Model): number {
  return PRESETS[_activePreset][forModel]
}

export interface TrimmedHistory {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  totalMessages: number
  includedMessages: number
  estimatedTokens: number
  trimmed: boolean
}

// 러프한 토큰 추정: 한글 1자≈1토큰, 영어는 4자≈1토큰 (두 추정 평균)
export function estimateTokens(text: string): number {
  const korean = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - korean
  return Math.ceil(korean + other / 4)
}

// 어시스턴트 메시지엔 출처 모델 태그 붙임 (같은 스레드에서 peer 발언 구분)
// compaction이 있으면 요약본을 첫 메시지로 prepend, summarizedUpTo 이전은 제외
export function buildTaggedHistory(
  messages: ChatMessage[],
  forModel: Model,
  compaction?: CompactionState,
): TrimmedHistory {
  const relevant = messages.filter(m => m.role === 'user' || m.role === 'assistant')
  const limit = getMaxMessages(forModel)

  // 압축된 부분 이후만 작업 영역으로
  const startIdx = compaction?.summarizedUpTo ?? 0
  const compactionMsgs = startIdx > 0 ? relevant.slice(startIdx) : relevant

  // 모델별 limit 적용 — 단 first가 assistant면 user부터 시작하게 잘림
  let trimmedList = compactionMsgs.slice(-limit)
  if (trimmedList.length > 0 && trimmedList[0].role === 'assistant') {
    trimmedList = trimmedList.slice(1)
  }

  const mapped = trimmedList.map(m => {
    const attachmentBlock = m.attachments?.length
      ? `\n\n<attachments>\n${m.attachments.map(a =>
          `<image name="${a.name}" mime="${a.mime}">${a.dataUrl}</image>`
        ).join('\n')}\n</attachments>`
      : ''
    if (m.role === 'assistant' && m.model) {
      const tag = m.model === 'claude' ? '[Claude]' : m.model === 'codex' ? '[Codex]' : '[Gemini]'
      return { role: 'assistant' as const, content: `${tag}\n${m.content}` }
    }
    return { role: m.role as 'user' | 'assistant', content: `${m.content}${attachmentBlock}` }
  })

  // 압축본 있으면 첫 user 메시지로 prepend (디스플레이용 안내 + 요약 본문)
  if (compaction && compaction.summary) {
    mapped.unshift({
      role: 'user' as const,
      content: `[CONTEXT — earlier conversation compacted to save tokens. Treat as established context. Continue naturally from the latest message below.]\n\n${compaction.summary}\n\n[END OF COMPACTED CONTEXT — newest exchanges follow.]`,
    })
  }

  const estimatedTokens = mapped.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  return {
    messages: mapped,
    totalMessages: relevant.length,
    includedMessages: mapped.length,
    estimatedTokens,
    trimmed: mapped.length < relevant.length,
  }
}
