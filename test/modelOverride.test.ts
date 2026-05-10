// modelOverride.ts — vscode.workspace.getConfiguration mock 으로 override + thinking budget 검증

import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  resolveThinkingBudget,
} from '../src/util/modelOverride'

// vscode mock 의 getConfiguration 을 동적으로 swap 하기 위해 module 직접 mock
// 실제 mock 은 vitest.config.ts alias 로 test/mocks/vscode.ts 가 로드됨
// 그 안의 getConfiguration 을 override 해서 thinkingMode 강제값 주입

import * as vscodeMock from 'vscode'

function setMockedThinking(mode: string | undefined) {
  ;(vscodeMock as any).workspace.getConfiguration = () => ({
    get: (k: string) => k === 'thinkingMode' ? mode : undefined,
  })
}

describe('resolveThinkingBudget', () => {
  const defaults = {
    low: undefined,
    medium: 5000,
    high: 16000,
    'extra-high': 64000,
  }

  beforeEach(() => {
    // 각 테스트 전 reset
    setMockedThinking('auto')
  })

  it('auto + low → undefined', () => {
    setMockedThinking('auto')
    expect(resolveThinkingBudget('low', defaults, 32000)).toBeUndefined()
  })

  it('auto + medium → 5000', () => {
    setMockedThinking('auto')
    expect(resolveThinkingBudget('medium', defaults, 32000)).toBe(5000)
  })

  it('auto + extra-high + 모델 한도 64k → 64000', () => {
    setMockedThinking('auto')
    expect(resolveThinkingBudget('extra-high', defaults, 64000)).toBe(64000)
  })

  it('off — effort 무관하게 undefined', () => {
    setMockedThinking('off')
    expect(resolveThinkingBudget('low', defaults, 64000)).toBeUndefined()
    expect(resolveThinkingBudget('extra-high', defaults, 64000)).toBeUndefined()
  })

  it('on — 5000 강제 (모델 한도가 더 작으면 한도 적용)', () => {
    setMockedThinking('on')
    expect(resolveThinkingBudget('low', defaults, 32000)).toBe(5000)
    expect(resolveThinkingBudget('low', defaults, 3000)).toBe(3000)  // 한도 < 5000
  })

  it('extra — 모델 한도 그대로 사용', () => {
    setMockedThinking('extra')
    expect(resolveThinkingBudget('low', defaults, 32000)).toBe(32000)
    expect(resolveThinkingBudget('low', defaults, 64000)).toBe(64000)
  })
})

describe('modelOverride get* 함수', () => {
  it('auto 가 default — undefined 일 때도 auto 반환', async () => {
    ;(vscodeMock as any).workspace.getConfiguration = () => ({
      get: () => undefined,
    })
    const { getClaudeModelOverride, getCodexModelOverride, getGeminiModelOverride, getThinkingMode } =
      await import('../src/util/modelOverride')
    expect(getClaudeModelOverride()).toBe('auto')
    expect(getCodexModelOverride()).toBe('auto')
    expect(getGeminiModelOverride()).toBe('auto')
    expect(getThinkingMode()).toBe('auto')
  })

  it('명시적 값 우선', async () => {
    ;(vscodeMock as any).workspace.getConfiguration = () => ({
      get: (k: string) => ({
        claudeModel: 'claude-opus-4-7',
        codexModel: 'gpt-5.5',
        geminiModel: 'gemini-2.5-pro',
        thinkingMode: 'extra',
      } as any)[k],
    })
    const { getClaudeModelOverride, getCodexModelOverride, getGeminiModelOverride, getThinkingMode } =
      await import('../src/util/modelOverride')
    expect(getClaudeModelOverride()).toBe('claude-opus-4-7')
    expect(getCodexModelOverride()).toBe('gpt-5.5')
    expect(getGeminiModelOverride()).toBe('gemini-2.5-pro')
    expect(getThinkingMode()).toBe('extra')
  })
})
