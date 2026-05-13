// test/geminiCache.test.ts
// Gemini API Context Cache 회귀 — 순수 함수 (hash / size gate) 위주.
// 실제 fetch 호출 경로는 통합 테스트에서 (vscode 의존성).

import { describe, expect, it } from 'vitest'
import {
  hashKey, minTokensFor, isCacheableSize,
  invalidateGeminiCache, listGeminiCaches,
} from '../src/providers/geminiCacheManager'

describe('hashKey', () => {
  it('same model + same instruction → same hash', () => {
    const a = hashKey('gemini-2.5-flash', 'system prompt body')
    const b = hashKey('gemini-2.5-flash', 'system prompt body')
    expect(a).toBe(b)
  })
  it('다른 instruction → 다른 hash', () => {
    const a = hashKey('gemini-2.5-flash', 'sys A')
    const b = hashKey('gemini-2.5-flash', 'sys B')
    expect(a).not.toBe(b)
  })
  it('다른 model → 다른 hash (model 도 캐시 key 일부)', () => {
    const a = hashKey('gemini-2.5-flash', 'same body')
    const b = hashKey('gemini-2.5-pro',   'same body')
    expect(a).not.toBe(b)
  })
  it('hash 길이 16 hex (충돌 거의 0)', () => {
    const h = hashKey('gemini-2.5-flash', 'x')
    expect(h.length).toBe(16)
    expect(/^[0-9a-f]+$/.test(h)).toBe(true)
  })
})

describe('minTokensFor', () => {
  it('Pro 모델 = 4096 minimum', () => {
    expect(minTokensFor('gemini-2.5-pro')).toBe(4096)
    expect(minTokensFor('gemini-1.5-pro')).toBe(4096)
    expect(minTokensFor('models/gemini-2.5-pro')).toBe(4096)
  })
  it('Flash 등 기타 = 1024 minimum', () => {
    expect(minTokensFor('gemini-2.5-flash')).toBe(1024)
    expect(minTokensFor('gemini-1.5-flash')).toBe(1024)
    expect(minTokensFor('gemini-2.0-flash')).toBe(1024)
  })
})

describe('isCacheableSize', () => {
  it('짧은 system prompt → cacheable X (작은 캐시는 Gemini API 가 거절)', () => {
    expect(isCacheableSize('gemini-2.5-flash', 'short')).toBe(false)
    expect(isCacheableSize('gemini-2.5-pro', 'a'.repeat(100))).toBe(false)
  })
  it('Flash 의 1024 tok 보다 크면 cacheable', () => {
    // 영어 4자/tok → 1024 tok ≈ 4096 chars
    const big = 'x'.repeat(5000)
    expect(isCacheableSize('gemini-2.5-flash', big)).toBe(true)
  })
  it('한국어 1자/tok — Pro 의 4096 tok 도달', () => {
    // 한글 5000자 → ~5000 tok > 4096 → cacheable for Pro
    const longKr = '가'.repeat(5000)
    expect(isCacheableSize('gemini-2.5-pro', longKr)).toBe(true)
  })
  it('1024 tok 직전 Flash 는 false (boundary)', () => {
    // 영어 4000 chars = ~1000 tok (1024 미만)
    const justBelow = 'x'.repeat(4000)
    expect(isCacheableSize('gemini-2.5-flash', justBelow)).toBe(false)
  })
})

describe('invalidate / list', () => {
  it('invalidateGeminiCache(undefined) 가 in-memory cache 전체 비움', () => {
    invalidateGeminiCache()
    expect(listGeminiCaches()).toEqual([])
  })
})
