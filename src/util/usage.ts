// src/util/usage.ts
// 모델별 세션 사용량 추적 + argue 모드 전용 카운터.

import { Model } from '../router/types'

export interface ModelUsage {
  requests: number
  inputTokens: number          // 새로 청구되는 입력 (cache miss 분)
  outputTokens: number
  cacheReadTokens?: number     // Claude SDK 자동 prompt cache hit (이미 처리됐지만 청구 X)
  cacheCreationTokens?: number // 새 cache 생성 시 1회성 추가 비용
  cachedInputTokens?: number   // Gemini Context Cache 명시 캐시 (~25% 단가)
}

export interface PlanInfo {
  label: string          // 'Max', 'Pro', 'Free Tier'
  limitHint: string      // '5시간마다 리셋' 같은 휴먼 문구 (정확 쿼터 API 없을 때)
}

export const PLAN_INFO: Record<Model, PlanInfo> = {
  claude: { label: 'Claude Max', limitHint: '5시간 단위 롤링 한도 (`claude /status`로 정확히 확인)' },
  codex:  { label: 'ChatGPT Pro', limitHint: 'gpt-5.5/5.4 사용량 주간 한도' },
  gemini: { label: 'Google 무료 티어', limitHint: '60 req/min · 1000 req/day' },
}

// 단가 ($/1M tokens) — 사용자가 zero-billing 우회 경로라 실제 청구 0이지만,
// '구독 안 썼다면 얼마였을지' 절약 금액 계산용 (사용자 만족도 ↑).
// 2026-05 기준 공식 API 단가.
export interface ModelPricing {
  inputPer1M: number   // USD
  outputPer1M: number  // USD
}
export const PRICING: Record<Model, Record<string, ModelPricing>> = {
  claude: {
    'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
    'claude-opus-4-6':   { inputPer1M: 15, outputPer1M: 75 },
    'claude-haiku-4-5':  { inputPer1M: 0.8, outputPer1M: 4 },
    default:             { inputPer1M: 3, outputPer1M: 15 },
  },
  codex: {
    'gpt-5.5':       { inputPer1M: 10, outputPer1M: 40 },  // 추정 (Pro tier)
    'gpt-5.4':       { inputPer1M: 5, outputPer1M: 20 },
    'gpt-5.4-mini':  { inputPer1M: 1, outputPer1M: 4 },
    default:         { inputPer1M: 5, outputPer1M: 20 },
  },
  gemini: {
    'gemini-2.5-pro':    { inputPer1M: 1.25, outputPer1M: 10 },
    'gemini-2.5-flash':  { inputPer1M: 0.30, outputPer1M: 2.5 },
    'gemini-2.0-flash':  { inputPer1M: 0.10, outputPer1M: 0.40 },
    default:             { inputPer1M: 0.30, outputPer1M: 2.5 },
  },
}

// 사용된 토큰으로 '만약 API 였다면' 비용 추정
export function estimateCost(model: Model, actualModel: string | undefined, inTok: number, outTok: number): number {
  const modelPricings = PRICING[model] ?? {}
  const pricing = (actualModel && modelPricings[actualModel]) ?? modelPricings.default
  if (!pricing) return 0
  return (inTok * pricing.inputPer1M + outTok * pricing.outputPer1M) / 1_000_000
}

const empty = (): ModelUsage => ({
  requests: 0, inputTokens: 0, outputTokens: 0,
  cacheReadTokens: 0, cacheCreationTokens: 0, cachedInputTokens: 0,
})

export interface RecordExtras {
  cacheReadTokens?: number
  cacheCreationTokens?: number
  cachedInputTokens?: number
}

export class UsageTracker {
  private session: Record<Model, ModelUsage> = {
    claude: empty(), codex: empty(), gemini: empty(),
  }
  private argue: Record<Model, ModelUsage> = {
    claude: empty(), codex: empty(), gemini: empty(),
  }
  public sessionStartedAt = Date.now()

  record(model: Model, input: number, output: number, isArgue: boolean, extras?: RecordExtras) {
    // session/argue 는 built-in 3종만 키로 가짐. custom:<name> 들어오면 undefined.requests++ 로 throw →
    // 호출자(_runTurn)의 _persistMessages 가 never reach → @custom 메시지가 메모리만에만 남고 저장 안 됨.
    // 현재 UI 가 custom usage 노출 안 하므로 silent skip.
    if (model !== 'claude' && model !== 'codex' && model !== 'gemini') return
    const s = this.session[model]
    s.requests++
    s.inputTokens += input
    s.outputTokens += output
    s.cacheReadTokens = (s.cacheReadTokens ?? 0) + (extras?.cacheReadTokens ?? 0)
    s.cacheCreationTokens = (s.cacheCreationTokens ?? 0) + (extras?.cacheCreationTokens ?? 0)
    s.cachedInputTokens = (s.cachedInputTokens ?? 0) + (extras?.cachedInputTokens ?? 0)

    if (isArgue) {
      const a = this.argue[model]
      a.requests++
      a.inputTokens += input
      a.outputTokens += output
      a.cacheReadTokens = (a.cacheReadTokens ?? 0) + (extras?.cacheReadTokens ?? 0)
      a.cacheCreationTokens = (a.cacheCreationTokens ?? 0) + (extras?.cacheCreationTokens ?? 0)
      a.cachedInputTokens = (a.cachedInputTokens ?? 0) + (extras?.cachedInputTokens ?? 0)
    }
  }

  getSession(): Record<Model, ModelUsage> {
    return JSON.parse(JSON.stringify(this.session))
  }

  getArgue(): Record<Model, ModelUsage> {
    return JSON.parse(JSON.stringify(this.argue))
  }

  resetArgue() {
    this.argue = { claude: empty(), codex: empty(), gemini: empty() }
  }

  resetSession() {
    this.session = { claude: empty(), codex: empty(), gemini: empty() }
    this.sessionStartedAt = Date.now()
  }

  // 특정 모델의 총 세션 토큰 사용량을 반환합니다.
  getTotalSessionTokens(model: Model): number {
    const { inputTokens, outputTokens } = this.session[model];
    return inputTokens + outputTokens;
  }

  // 토큰 수를 짧은 형식(예: 1200 -> 1.2k)으로 포맷합니다.
  private formatTokens(tokens: number): string {
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }

  // VS Code 상태 표시줄에 표시하기 적합한 형식의 문자열을 반환합니다.
  // 예: "Tokens: C: 1.2k | X: 500 | G: 200"
  getFormattedSessionUsage(): string {
    const usageParts: string[] = [];
    (Object.keys(this.session) as Model[]).forEach(model => {
      const totalTokens = this.getTotalSessionTokens(model);
      if (totalTokens > 0) { // 사용량이 0이 아닌 모델만 표시
        // PLAN_INFO의 라벨에서 첫 단어의 첫 글자를 가져옵니다. (Claude Max -> C)
        const labelInitial = PLAN_INFO[model].label.split(' ')[0].charAt(0);
        usageParts.push(`${labelInitial}: ${this.formatTokens(totalTokens)}`);
      }
    });
    return usageParts.length > 0 ? `Tokens: ${usageParts.join(' | ')}` : '';
  }
}
