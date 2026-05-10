// quota.ts — isQuotaError + summarizeQuotaError 회귀 테스트

import { describe, expect, it } from 'vitest'
import { isQuotaError, summarizeQuotaError } from '../src/util/quota'

describe('isQuotaError — 표준 quota 에러', () => {
  it.each([
    [new Error('429 rate limit exceeded')],
    [new Error('rate_limit_error: usage limit')],
    [new Error('RESOURCE_EXHAUSTED: ratelimitexceeded')],
    [new Error('exhausted your capacity')],
    [new Error('quotaExceeded')],
    [new Error('overloaded — try later')],
  ])('"%s" → quota', (err) => {
    expect(isQuotaError(err)).toBe(true)
  })
})

describe('isQuotaError — Claude Max 안내문', () => {
  it.each([
    [new Error('Claude usage_limit_exceeded')],
    [new Error('Your usage limit will reset soon')],
    [new Error('5-hour limit reached')],
  ])('"%s" → quota', (err) => {
    expect(isQuotaError(err)).toBe(true)
  })
})

describe('isQuotaError — 한국어', () => {
  it.each([
    ['사용량 한도에 도달했습니다'],
    ['쿼터 소진'],
    ['제한에 도달'],
  ])('"%s" → quota', (msg) => {
    expect(isQuotaError(new Error(msg))).toBe(true)
  })
})

describe('isQuotaError — 빈 응답 (fallback 트리거용)', () => {
  it('"빈 응답" 키워드', () => {
    expect(isQuotaError(new Error('Gemini 응답 실패: 빈 응답 (finishReason: stop)'))).toBe(true)
  })
  it('"empty response"', () => {
    expect(isQuotaError(new Error('empty response from model'))).toBe(true)
  })
})

describe('isQuotaError — 일반 에러는 false', () => {
  it.each([
    [new Error('network error: ECONNRESET')],
    [new Error('JSON parse failed')],
    [new Error('file not found')],
    [null],
    [undefined],
  ])('"%s" → not quota', (err) => {
    expect(isQuotaError(err)).toBe(false)
  })
})

describe('isQuotaError — 구조화 에러', () => {
  it('status 429', () => {
    expect(isQuotaError({ status: 429, message: 'too many' })).toBe(true)
  })
  it('error.type rate_limit_error', () => {
    expect(isQuotaError({ error: { type: 'rate_limit_error' } })).toBe(true)
  })
  it('error.type overloaded_error', () => {
    expect(isQuotaError({ error: { type: 'overloaded_error' } })).toBe(true)
  })
})

describe('summarizeQuotaError', () => {
  it('Error → message', () => {
    expect(summarizeQuotaError(new Error('hello'))).toBe('hello')
  })
  it('long message → 잘림', () => {
    const long = 'x'.repeat(200)
    const summary = summarizeQuotaError(new Error(long))
    expect(summary.length).toBeLessThanOrEqual(125)  // 120 + '...'
    expect(summary).toContain('...')
  })
  it('non-Error → 기본 메시지', () => {
    expect(summarizeQuotaError({ random: 'thing' })).toBe('쿼터 소진')
  })
})
