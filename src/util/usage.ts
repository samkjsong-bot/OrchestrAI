// src/util/usage.ts
// 모델별 세션 사용량 추적 + argue 모드 전용 카운터.

import { Model } from '../router/types'

export interface ModelUsage {
  requests: number
  inputTokens: number
  outputTokens: number
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

const empty = (): ModelUsage => ({ requests: 0, inputTokens: 0, outputTokens: 0 })

export class UsageTracker {
  private session: Record<Model, ModelUsage> = {
    claude: empty(), codex: empty(), gemini: empty(),
  }
  private argue: Record<Model, ModelUsage> = {
    claude: empty(), codex: empty(), gemini: empty(),
  }
  public sessionStartedAt = Date.now()

  record(model: Model, input: number, output: number, isArgue: boolean) {
    const s = this.session[model]
    s.requests++
    s.inputTokens += input
    s.outputTokens += output

    if (isArgue) {
      const a = this.argue[model]
      a.requests++
      a.inputTokens += input
      a.outputTokens += output
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
