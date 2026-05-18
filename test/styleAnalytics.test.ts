// test/styleAnalytics.test.ts
// 모델별 응답 스타일 분석 — 고정 입력 vs 예상 출력 회귀.

import { describe, expect, it } from 'vitest'
import { analyzeMessageStyles } from '../src/util/styleAnalytics'
import type { ChatMessage } from '../src/router/types'

function asst(model: string, content: string, ts = Date.now()): ChatMessage {
  return { id: String(Math.random()), role: 'assistant', content, model: model as any, timestamp: ts }
}
function user(content: string): ChatMessage {
  return { id: String(Math.random()), role: 'user', content, timestamp: Date.now() }
}

describe('analyzeMessageStyles', () => {
  it('빈 메시지 배열 → 빈 분석 (no model stats)', () => {
    const a = analyzeMessageStyles([])
    expect(a.totalAssistantMessages).toBe(0)
    expect(Object.keys(a.byModel)).toEqual([])
  })

  it('user 메시지만 있으면 byModel 비어있음', () => {
    const a = analyzeMessageStyles([user('hi'), user('야')])
    expect(a.totalMessages).toBe(2)
    expect(a.totalAssistantMessages).toBe(0)
    expect(Object.keys(a.byModel)).toEqual([])
  })

  it('모델별 분리 — Claude/Codex/Gemini 각각 통계 separate', () => {
    const msgs = [
      asst('claude', 'Hello there.'),
      asst('codex', '```js\nconsole.log(1)\n```'),
      asst('gemini', '안녕하세요. 잘 부탁드립니다.'),
    ]
    const a = analyzeMessageStyles(msgs)
    expect(Object.keys(a.byModel).sort()).toEqual(['claude', 'codex', 'gemini'])
    expect(a.byModel.claude.count).toBe(1)
    expect(a.byModel.codex.count).toBe(1)
    expect(a.byModel.gemini.count).toBe(1)
  })

  it('코드 블록 비율 — ``` 한 쌍 들어가면 codeBlockRatio=1', () => {
    const a = analyzeMessageStyles([
      asst('codex', 'plain text'),
      asst('codex', '```js\nconst x = 1\n```'),
    ])
    expect(a.byModel.codex.codeBlockRatio).toBe(0.5)  // 2 중 1개에 코드
    expect(a.byModel.codex.codeFenceTotal).toBe(1)
  })

  it('이모지 카운트 — 1k 당 빈도', () => {
    const a = analyzeMessageStyles([
      // emoji 2개 (😀, 🚀) — ✓ 같은 unicode symbol 은 Extended_Pictographic 아님
      asst('claude', '😀 hello there 🚀 this is a test message here.'),
    ])
    expect(a.byModel.claude.emojiTotal).toBe(2)
    expect(a.byModel.claude.emojiPer1k).toBeGreaterThan(20)
  })

  it('정중함 점수 — 한국어 "감사", "요" 어미 잡힘', () => {
    const polite = '안녕하세요. 도와주셔서 감사합니다. 죄송하지만 한 가지만 더요.'
    const casual = '안녕 ㅋㅋ 그럼 해보자 됐다.'
    const a = analyzeMessageStyles([
      asst('claude', polite),
      asst('codex', casual),
    ])
    expect(a.byModel.claude.politenessScore).toBeGreaterThan(a.byModel.codex.politenessScore)
  })

  it('정중함 — 영어 "please / thanks" 도 잡음', () => {
    const a = analyzeMessageStyles([
      asst('claude', 'please do this. thanks a lot. sorry for the delay.'),
      asst('codex', 'do this. done. nope.'),
    ])
    expect(a.byModel.claude.politenessScore).toBeGreaterThan(a.byModel.codex.politenessScore)
  })

  it('한·영 비율 — 코드 블록 제외하고 본문만', () => {
    const a = analyzeMessageStyles([
      asst('claude', '안녕하세요 ```js\nconst foo = "bar"\n``` 끝났습니다'),
    ])
    // 본문은 "안녕하세요  끝났습니다" — 영문 char 0, 한글 char 8 → 비율 KR=1
    expect(a.byModel.claude.korCharRatio).toBeGreaterThan(0.9)
    expect(a.byModel.claude.engCharRatio).toBeLessThan(0.1)
  })

  it('top start patterns — 자주 쓰는 응답 시작 phrase top 3', () => {
    const a = analyzeMessageStyles([
      asst('codex', '응답: hello'),
      asst('codex', '응답: world'),
      asst('codex', 'OK done'),
    ])
    expect(a.byModel.codex.topStartPatterns.length).toBeGreaterThan(0)
    // "응답" 으로 시작하는 게 2회 → top
    expect(a.byModel.codex.topStartPatterns[0].count).toBe(2)
  })

  it('헤더 / 리스트 빈도 — 코드 제외 본문 기준', () => {
    const a = analyzeMessageStyles([
      asst('claude', '# Header\n## Sub\n\n- item 1\n- item 2\n1. step\n\nbody body body body body body body body'),
    ])
    expect(a.byModel.claude.headerTotal).toBe(2)
    expect(a.byModel.claude.listTotal).toBe(3)
  })

  it('scope 값 그대로 echoed', () => {
    const a1 = analyzeMessageStyles([asst('claude', 'hi')], 'active_chat')
    const a2 = analyzeMessageStyles([asst('claude', 'hi')], 'all_chats')
    expect(a1.scope).toBe('active_chat')
    expect(a2.scope).toBe('all_chats')
  })

  it('custom: 모델도 모델별 분리에 포함됨', () => {
    const a = analyzeMessageStyles([
      asst('custom:gemma4', '로컬 모델 응답이다'),
      asst('custom:gemma4', '두 번째'),
      asst('claude', 'claude'),
    ])
    expect(a.byModel['custom:gemma4'].count).toBe(2)
    expect(a.byModel.claude.count).toBe(1)
  })
})
