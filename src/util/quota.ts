// src/util/quota.ts
// 모든 LLM의 쿼터/레이트리밋 에러를 공통 시그니처로 판별.
// Anthropic (429 / rate_limit_error / overloaded_error), OpenAI (429 / exhausted),
// Google (RESOURCE_EXHAUSTED / rateLimitExceeded / quotaExceeded) 전부 캐치.

export function isQuotaError(err: unknown): boolean {
  if (err == null) return false

  // 구조화된 에러 객체에서 코드·타입 추출
  const e = err as {
    status?: number
    code?: string
    error?: { type?: string; status?: string }
  }
  if (e.status === 429) return true
  if (e.error?.type === 'rate_limit_error') return true
  if (e.error?.type === 'overloaded_error') return true

  // 문자열로 변환해서 키워드 매칭 (SDK·API가 제각각이라 안전망)
  const blob = (err instanceof Error ? `${err.message}` : JSON.stringify(err)).toLowerCase()
  return (
    blob.includes('429') ||
    blob.includes('rate_limit') ||
    blob.includes('ratelimitexceeded') ||
    blob.includes('rate limit') ||
    blob.includes('resource_exhausted') ||
    blob.includes('exhausted your capacity') ||
    blob.includes('exhausted your quota') ||
    blob.includes('quotaexceeded') ||
    blob.includes('overloaded') ||
    blob.includes('quota')
  )
}

// 에러에서 사람이 읽을 수 있는 간단 설명 뽑기 (fallback UI 안내용)
export function summarizeQuotaError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message
    if (msg.length > 120) return msg.slice(0, 120) + '...'
    return msg
  }
  return '쿼터 소진'
}
