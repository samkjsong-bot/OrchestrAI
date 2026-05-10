// history.ts — buildTaggedHistory + estimateTokens 회귀 테스트

import { describe, expect, it } from 'vitest'
import { buildTaggedHistory, estimateTokens, setContextWindowPreset } from '../src/util/history'
import type { ChatMessage } from '../src/router/types'

const m = (role: 'user' | 'assistant', content: string, model?: 'claude' | 'codex' | 'gemini'): ChatMessage => ({
  id: `${Date.now()}-${Math.random()}`,
  role,
  content,
  model,
  timestamp: Date.now(),
})

describe('estimateTokens', () => {
  it('한글 1자 ≈ 1 token', () => {
    expect(estimateTokens('가나다')).toBe(3)
  })
  it('영어 4자 ≈ 1 token', () => {
    expect(estimateTokens('hello')).toBe(2)  // 5/4 = 1.25 → ceil 2
  })
  it('빈 문자열 → 0', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('buildTaggedHistory — XML prior_turn 형식', () => {
  it('assistant message 가 <prior_turn from="..."> 로 wrap', () => {
    const messages = [
      m('user', '안녕'),
      m('assistant', '반가워', 'claude'),
    ]
    const h = buildTaggedHistory(messages, 'codex')
    expect(h.messages[1].content).toContain('<prior_turn from="claude">')
    expect(h.messages[1].content).toContain('반가워')
    expect(h.messages[1].content).toContain('</prior_turn>')
  })

  it('user message 는 wrap 없음', () => {
    const messages = [m('user', '하이')]
    const h = buildTaggedHistory(messages, 'claude')
    expect(h.messages[0].content).toBe('하이')
  })

  it('첫 메시지가 assistant 면 잘림 (user 부터 시작)', () => {
    const messages = [
      m('assistant', 'old', 'claude'),
      m('user', 'q'),
      m('assistant', 'a', 'codex'),
    ]
    const h = buildTaggedHistory(messages, 'gemini')
    expect(h.messages[0].content).toBe('q')
  })

  it('include count 가 limit 안 넘음', () => {
    setContextWindowPreset('narrow')  // gemini 60
    const messages = Array.from({ length: 100 }, (_, i) =>
      m(i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`, i % 2 === 1 ? 'claude' : undefined),
    )
    const h = buildTaggedHistory(messages, 'gemini')
    expect(h.includedMessages).toBeLessThanOrEqual(60)
    expect(h.totalMessages).toBe(100)
    expect(h.trimmed).toBe(true)
  })
})
