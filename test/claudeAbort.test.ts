// Claude provider abort/interrupt 통합 테스트.
// v0.1.16 fix 가 실제로 작동하는지 — abortSignal 발화 시 q.interrupt() 호출 + for-await 종료 검증.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { callClaude } from '../src/providers/claudeProvider'
import {
  _resetMockState,
  _setYieldDelayMs,
  _setYieldCount,
  _getInterruptCallCount,
} from './mocks/claude-sdk'

beforeEach(() => {
  _resetMockState()
  _setYieldDelayMs(10)
  _setYieldCount(100)  // 100 chunks × 10ms = 1초 → 중간 abort 가능
})

describe('Claude abort + interrupt 통합', () => {
  it('abortSignal 발화 시 q.interrupt() 호출됨', async () => {
    const ctrl = new AbortController()
    const chunks: string[] = []

    const promise = callClaude(
      [{ role: 'user', content: 'long task' }],
      'medium',
      'fake-token',
      (t) => chunks.push(t),
      'sys',
      'auto-edit',
      undefined,
      ctrl.signal,
    )

    // 50ms 후 abort
    await new Promise(r => setTimeout(r, 50))
    ctrl.abort()

    // 호출 결과 — abort 후 reject 되거나 부분 결과 return
    try { await promise } catch { /* abort 됐으면 throw OK */ }

    // 핵심 검증: interrupt() 가 호출됐는가
    expect(_getInterruptCallCount()).toBe(1)
  })

  it('abort 후 stream 더 이상 chunk 안 받음', async () => {
    const ctrl = new AbortController()
    const chunks: string[] = []

    const promise = callClaude(
      [{ role: 'user', content: 'task' }],
      'medium',
      'fake-token',
      (t) => chunks.push(t),
      'sys',
      'auto-edit',
      undefined,
      ctrl.signal,
    )

    await new Promise(r => setTimeout(r, 50))
    const chunkCountAtAbort = chunks.length
    ctrl.abort()

    try { await promise } catch {}

    // abort 후 약간 더 기다려도 chunk 가 무한정 늘어나면 안 됨
    await new Promise(r => setTimeout(r, 100))
    const chunkCountAfter = chunks.length

    // 5개 이내로만 더 들어와야 (mocking buffer 차이로 1~2 chunk 더 올 수 있음)
    expect(chunkCountAfter - chunkCountAtAbort).toBeLessThan(5)
    // 절대 100 chunk 다 받으면 안 됨
    expect(chunks.length).toBeLessThan(80)
  })

  it('abort 안 시키면 interrupt() 호출 안 됨', async () => {
    _setYieldCount(3)  // 빨리 끝남
    _setYieldDelayMs(1)

    await callClaude(
      [{ role: 'user', content: 'short' }],
      'low',
      'fake-token',
      () => {},
      'sys',
      'auto-edit',
    )

    expect(_getInterruptCallCount()).toBe(0)
  })

  it('이미 abort 된 signal 로 시작하면 즉시 interrupt() 호출', async () => {
    const ctrl = new AbortController()
    ctrl.abort()  // 시작 전 abort

    try {
      await callClaude(
        [{ role: 'user', content: 'x' }],
        'low',
        'fake-token',
        () => {},
        'sys',
        'auto-edit',
        undefined,
        ctrl.signal,
      )
    } catch {}

    expect(_getInterruptCallCount()).toBe(1)
  })
})
