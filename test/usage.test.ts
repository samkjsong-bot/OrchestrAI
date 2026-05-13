// usage.ts — UsageTracker + estimateCost 회귀 테스트

import { describe, expect, it } from 'vitest'
import { UsageTracker, estimateCost, PRICING, PLAN_INFO } from '../src/util/usage'

describe('UsageTracker', () => {
  it('초기 상태 — 0 토큰', () => {
    const u = new UsageTracker()
    const session = u.getSession()
    expect(session.claude).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0 })
    expect(u.getTotalSessionTokens('claude')).toBe(0)
  })

  it('record 후 토큰 누적', () => {
    const u = new UsageTracker()
    u.record('claude', 100, 500, false)
    u.record('claude', 200, 1000, false)
    const c = u.getSession().claude
    expect(c.requests).toBe(2)
    expect(c.inputTokens).toBe(300)
    expect(c.outputTokens).toBe(1500)
  })

  it('argue 모드 별도 카운터', () => {
    const u = new UsageTracker()
    u.record('codex', 100, 200, true)
    u.record('codex', 50, 100, false)
    expect(u.getSession().codex.inputTokens).toBe(150)
    expect(u.getArgue().codex.inputTokens).toBe(100)
  })

  it('resetSession — argue 카운터는 유지', () => {
    const u = new UsageTracker()
    u.record('claude', 100, 200, true)
    u.resetSession()
    expect(u.getSession().claude.inputTokens).toBe(0)
    expect(u.getArgue().claude.inputTokens).toBe(100)
  })

  it('formatted usage — 0 모델은 표시 안 함', () => {
    const u = new UsageTracker()
    u.record('claude', 1500, 2500, false)
    const formatted = u.getFormattedSessionUsage()
    expect(formatted).toContain('C:')
    expect(formatted).toContain('4.0k')
    expect(formatted).not.toContain('X:')  // codex 0
    expect(formatted).not.toContain('G:')  // gemini 0
  })

  it('빈 세션 — empty string', () => {
    const u = new UsageTracker()
    expect(u.getFormattedSessionUsage()).toBe('')
  })

  it('custom: 모델은 throw X (built-in 만 트래킹)', () => {
    // 회귀: session 이 built-in 3종만 키로 가져서 'custom:gemma4' 인덱싱 → undefined.requests++ throw
    // → _runTurn 의 _persistMessages 가 절대 호출 안 됨 → @custom 응답이 디스크에 저장 안 되는 버그.
    const u = new UsageTracker()
    expect(() => u.record('custom:gemma4' as any, 100, 200, false)).not.toThrow()
    expect(() => u.record('custom:gemma4' as any, 100, 200, true)).not.toThrow()
    // built-in 카운터엔 안 들어가야 함
    expect(u.getSession().claude.requests).toBe(0)
    expect(u.getSession().codex.requests).toBe(0)
    expect(u.getSession().gemini.requests).toBe(0)
  })
})

describe('estimateCost', () => {
  it('Sonnet 4.6 단가 적용 (default)', () => {
    // input 1M token = $3, output 1M token = $15
    const cost = estimateCost('claude', 'claude-sonnet-4-6', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(3 + 15, 5)
  })

  it('Haiku 단가', () => {
    const cost = estimateCost('claude', 'claude-haiku-4-5', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.8 + 4, 5)
  })

  it('미지의 모델 → default 단가', () => {
    const cost = estimateCost('claude', 'unknown-model', 1_000_000, 0)
    expect(cost).toBeCloseTo(3, 5)  // default = sonnet
  })

  it('Gemini Flash — 가장 싸고', () => {
    const cost = estimateCost('gemini', 'gemini-2.5-flash', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.30 + 2.5, 5)
  })

  it('0 토큰 → 0', () => {
    expect(estimateCost('codex', 'gpt-5.4', 0, 0)).toBe(0)
  })
})

describe('PLAN_INFO 매트릭스', () => {
  it('3개 모델 다 정의', () => {
    expect(PLAN_INFO.claude.label).toContain('Claude')
    expect(PLAN_INFO.codex.label).toContain('ChatGPT')
    expect(PLAN_INFO.gemini.label).toContain('Google')
  })
})

describe('PRICING 매트릭스', () => {
  it('Claude Opus 가 Sonnet 보다 5배 비쌈', () => {
    const sonnet = PRICING.claude['claude-sonnet-4-6']
    const opus = PRICING.claude['claude-opus-4-6']
    expect(opus.inputPer1M).toBe(sonnet.inputPer1M * 5)
    expect(opus.outputPer1M).toBe(sonnet.outputPer1M * 5)
  })
})
