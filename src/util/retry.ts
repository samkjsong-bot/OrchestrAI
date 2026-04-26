// src/util/retry.ts
// 429 / 5xx / overloaded 에러에 대해 지수 백오프로 재시도

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  let lastErr: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts - 1) break
      if (!isRetryable(err)) break
      await sleep(1000 * 2 ** attempt)  // 1s, 2s, 4s
    }
  }
  throw lastErr
}

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number }; error?: { type?: string } }
  const status = e?.status ?? e?.response?.status
  if (status === 429) return true
  if (typeof status === 'number' && status >= 500 && status < 600) return true
  const type = e?.error?.type
  if (type === 'rate_limit_error' || type === 'overloaded_error') return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
