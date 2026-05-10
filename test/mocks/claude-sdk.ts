// Claude Agent SDK stub for unit/integration tests.
// 실제 query() 가 반환하는 Query 객체 흉내 — interrupt() 호출 추적 가능.

let _lastQuery: any = null
let _interruptCallCount = 0
let _yieldDelayMs = 5
let _yieldCount = 50
let _customMessages: any[] | null = null

export function _resetMockState() {
  _lastQuery = null
  _interruptCallCount = 0
  _yieldDelayMs = 5
  _yieldCount = 50
  _customMessages = null
}
export function _setYieldDelayMs(ms: number) { _yieldDelayMs = ms }
export function _setYieldCount(n: number) { _yieldCount = n }
export function _setCustomMessages(msgs: any[]) { _customMessages = msgs }
export function _getLastQuery() { return _lastQuery }
export function _getInterruptCallCount() { return _interruptCallCount }

export function query(opts: any) {
  let interrupted = false

  // AsyncGenerator 인터페이스 — for-await 가능
  async function* gen() {
    if (_customMessages) {
      for (const m of _customMessages) {
        if (interrupted) return
        yield m
      }
      return
    }
    // default: text_delta chunks
    for (let i = 0; i < _yieldCount; i++) {
      if (interrupted) return
      // abort signal 체크 — 실제 SDK 도 abort 시 throw 함
      if (opts?.options?.abortSignal?.aborted) {
        const err: any = new Error('aborted')
        err.name = 'AbortError'
        throw err
      }
      await new Promise(r => setTimeout(r, _yieldDelayMs))
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: `chunk-${i} ` },
        },
      }
    }
    // 마지막 result
    yield {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0,
      usage: { input_tokens: 100, output_tokens: 200 },
    }
  }

  const iter = gen()
  const obj: any = {
    next: () => iter.next(),
    return: () => iter.return!(),
    throw: (e: any) => iter.throw!(e),
    [Symbol.asyncIterator]() { return this },
    async interrupt() {
      _interruptCallCount++
      interrupted = true
    },
    async setPermissionMode() {},
  }
  _lastQuery = obj
  return obj
}
