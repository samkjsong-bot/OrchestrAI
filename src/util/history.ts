// src/util/history.ts
// 모델별 히스토리 자르기 규칙.
// 토큰 효율 + 각 모델 컨텍스트 강점에 맞춰 차등.

import { Model, ChatMessage } from '../router/types'
import type { CompactionState } from './compaction'
import { record as perfRecord } from './perf'

// 모델별 최대 메시지 수. Claude/Codex 는 자체적으로 거의 무제한 보내는 패턴 따라감.
// Gemini 만 따로 작게 — 무료 OAuth tier 의 안전 필터가 컨텍스트 길이 + 다양성에 민감해서
// 100+ 메시지 들어가면 finishReason: stop 빈 응답 잦음. 200 으로 균형.
// compaction (TRIGGER_TOKENS=150k) 이 토큰 한계 가까우면 알아서 압축.
const PRESETS: Record<'narrow' | 'default' | 'wide', Record<Model, number>> = {
  narrow:  { claude: 60,   codex: 40,   gemini: 60   },  // 토큰 절약 원할 때
  default: { claude: 500,  codex: 300,  gemini: 200  },  // Gemini 만 줄임 (안전 필터 trip 방지)
  wide:    { claude: 2000, codex: 1500, gemini: 600  },  // 진짜 긴 작업 — Gemini 도 600 까지만
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
  const _perfStart = performance.now()
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
      // XML-like meta tag — 모델이 markdown heading 으로 인식 안 해서 자기 답에 따라 쓰지 않음.
      // [Claude] / [Codex] / [Gemini] 형식은 Claude 가 학습 trigger 로 받아들여서 ventriloquize 했음.
      return {
        role: 'assistant' as const,
        content: `<prior_turn from="${m.model}">\n${m.content}\n</prior_turn>`,
      }
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

  perfRecord('buildTaggedHistory', performance.now() - _perfStart)
  return {
    messages: mapped,
    totalMessages: relevant.length,
    includedMessages: mapped.length,
    estimatedTokens,
    trimmed: mapped.length < relevant.length,
  }
}
