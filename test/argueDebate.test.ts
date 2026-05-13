// test/argueDebate.test.ts
// Argue 토큰 절약 — summary chain + totals + output cap 회귀 테스트.

import { describe, expect, it } from 'vitest'
import {
  buildArgueHistoryOverride, addToArgueTotals, emptyArgueTotals,
  argueOutputCapKR, type DebateTurnSummary,
} from '../src/util/argueDebate'

describe('buildArgueHistoryOverride', () => {
  it('round 1 — summaries 비어있으면 history = [userMsg] 만 (raw 응답 X)', () => {
    const h = buildArgueHistoryOverride({ userQuestion: '한식과 양식 어떤 게 더 좋아?', summaries: [] })
    expect(h.length).toBe(1)
    expect(h[0].role).toBe('user')
    expect(h[0].content).toContain('한식과 양식')
  })

  it('round N — summaries 만 assistant 슬롯에 박힘 (raw 응답 누적 X)', () => {
    const summaries: DebateTurnSummary[] = [
      { round: 1, model: 'claude', text: '한식 추천 — 발효 음식 영양 가치 강조', rawTokens: 800, summaryTokens: 40 },
      { round: 2, model: 'codex',  text: '반대로 양식 — 단백질 섭취 효율',       rawTokens: 1200, summaryTokens: 35 },
    ]
    const h = buildArgueHistoryOverride({ userQuestion: '한식과 양식 어떤 게 더 좋아?', summaries })
    expect(h.length).toBe(3)
    expect(h[0].role).toBe('user')
    expect(h[1].role).toBe('assistant')
    expect(h[1].content).toContain('prior_turn from="claude"')
    expect(h[1].content).toContain('round="1"')
    expect(h[1].content).toContain('발효 음식')
    expect(h[2].role).toBe('assistant')
    expect(h[2].content).toContain('prior_turn from="codex"')
    expect(h[2].content).toContain('round="2"')
  })

  it('summary 본문만 들어감 — 원본 raw 응답 흔적 X (token 폭주 차단 보장)', () => {
    const summary: DebateTurnSummary = {
      round: 1, model: 'gemini',
      text: '간단 결론',
      rawTokens: 4000,    // 원본은 4000 tok
      summaryTokens: 20,
    }
    const h = buildArgueHistoryOverride({ userQuestion: 'q', summaries: [summary] })
    // history 안에 raw 본문이나 4000 tok 흔적 없음
    expect(h[1].content).toContain('간단 결론')
    expect(JSON.stringify(h)).not.toContain('4000')
  })
})

describe('ArgueTotals', () => {
  it('emptyArgueTotals — 초기값 0', () => {
    const t = emptyArgueTotals()
    expect(t.rounds).toBe(0)
    expect(t.inputTokens).toBe(0)
    expect(t.outputTokens).toBe(0)
    expect(t.totalTokens).toBe(0)
    expect(t.maxOutputTokens).toBe(0)
    expect(t.maxOutputModel).toBeUndefined()
  })

  it('addToArgueTotals — 누적 + max output model 추적', () => {
    const t = emptyArgueTotals()
    addToArgueTotals(t, 'claude', 100, 200)
    addToArgueTotals(t, 'codex',  120, 350)
    addToArgueTotals(t, 'gemini', 150, 3800)  // gemini 폭주
    addToArgueTotals(t, 'claude', 200, 250)
    expect(t.rounds).toBe(4)
    expect(t.inputTokens).toBe(100 + 120 + 150 + 200)
    expect(t.outputTokens).toBe(200 + 350 + 3800 + 250)
    expect(t.totalTokens).toBe(t.inputTokens + t.outputTokens)
    expect(t.maxOutputModel).toBe('gemini')
    expect(t.maxOutputTokens).toBe(3800)
    expect(t.byModel.claude?.rounds).toBe(2)
    expect(t.byModel.claude?.input).toBe(300)
    expect(t.byModel.claude?.output).toBe(450)
    expect(t.byModel.gemini?.rounds).toBe(1)
  })
})

describe('argueOutputCapKR', () => {
  it('eco=400, balanced=700, deep=1200, full=2000', () => {
    expect(argueOutputCapKR('eco')).toBe(400)
    expect(argueOutputCapKR('balanced')).toBe(700)
    expect(argueOutputCapKR('deep')).toBe(1200)
    expect(argueOutputCapKR('full')).toBe(2000)
  })
})
