// src/util/usage.ts
// 모델별 세션 사용량 추적 + argue 모드 전용 카운터.
// v0.1.39: globalState 영속화 — reload 해도 session 유지. session reset 은 명시적 행동에만.

import { Model } from '../router/types'

// VSCode Memento (globalState) 의 최소 인터페이스. ExtensionContext 직접 import 피해서 test 쉬움.
export interface UsageStorage {
  get<T>(key: string): T | undefined
  update(key: string, value: any): Thenable<void>
}

const STORAGE_KEY = 'orchestrai.usage.v1'

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
  claude: { label: 'Claude Pro/Max', limitHint: '5시간 단위 롤링 한도 (`claude /status`로 정확히 확인)' },
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
    'claude-fable-5':    { inputPer1M: 10, outputPer1M: 50 },
    'claude-opus-4-8':   { inputPer1M: 5, outputPer1M: 25 },
    'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
    'claude-opus-4-7':   { inputPer1M: 5, outputPer1M: 25 },
    'claude-opus-4-6':   { inputPer1M: 15, outputPer1M: 75 },
    'claude-haiku-4-5':  { inputPer1M: 0.8, outputPer1M: 4 },
    default:             { inputPer1M: 3, outputPer1M: 15 },
  },
  codex: {
    'gpt-5.5':       { inputPer1M: 5, outputPer1M: 30 },
    'gpt-5.4':       { inputPer1M: 2.5, outputPer1M: 15 },
    'gpt-5.4-mini':  { inputPer1M: 0.75, outputPer1M: 4.5 },
    'gpt-5.4-nano':  { inputPer1M: 0.20, outputPer1M: 1.25 },
    default:         { inputPer1M: 2.5, outputPer1M: 15 },
  },
  gemini: {
    'gemini-3.1-pro-preview': { inputPer1M: 2.00, outputPer1M: 12.00 },
    'gemini-3.5-flash':       { inputPer1M: 1.50, outputPer1M: 9.00 },
    'gemini-3.1-flash-lite':  { inputPer1M: 0.25, outputPer1M: 1.50 },
    'gemini-3-flash-preview': { inputPer1M: 0.50, outputPer1M: 3.00 },
    'gemini-2.5-flash-lite':  { inputPer1M: 0.10, outputPer1M: 0.40 },
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
  private storage?: UsageStorage    // 있으면 record() 마다 영속화 (debounce 200ms)
  private saveTimer?: ReturnType<typeof setTimeout>

  /** v0.1.39 — globalState 에서 직전 세션 복원. constructor 대신 별도 메서드로 분리해서 test 시 storage 없이도 동작. */
  attachStorage(storage: UsageStorage): void {
    this.storage = storage
    const saved = storage.get<{ session: Record<Model, ModelUsage>; argue: Record<Model, ModelUsage>; sessionStartedAt: number }>(STORAGE_KEY)
    if (saved && typeof saved === 'object') {
      if (saved.session) this.session = saved.session
      if (saved.argue) this.argue = saved.argue
      if (typeof saved.sessionStartedAt === 'number') this.sessionStartedAt = saved.sessionStartedAt
    }
  }

  private scheduleSave() {
    if (!this.storage) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.storage?.update(STORAGE_KEY, {
        session: this.session, argue: this.argue, sessionStartedAt: this.sessionStartedAt,
      })
    }, 200)
  }

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
    this.scheduleSave()
  }

  getSession(): Record<Model, ModelUsage> {
    return JSON.parse(JSON.stringify(this.session))
  }

  getArgue(): Record<Model, ModelUsage> {
    return JSON.parse(JSON.stringify(this.argue))
  }

  resetArgue() {
    this.argue = { claude: empty(), codex: empty(), gemini: empty() }
    this.scheduleSave()
  }

  resetSession() {
    this.session = { claude: empty(), codex: empty(), gemini: empty() }
    this.sessionStartedAt = Date.now()
    this.scheduleSave()
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
        // PLAN_INFO의 라벨에서 첫 단어의 첫 글자를 가져옵니다. (Claude Pro/Max -> C)
        const labelInitial = PLAN_INFO[model].label.split(' ')[0].charAt(0);
        usageParts.push(`${labelInitial}: ${this.formatTokens(totalTokens)}`);
      }
    });
    return usageParts.length > 0 ? `Tokens: ${usageParts.join(' | ')}` : '';
  }
}
