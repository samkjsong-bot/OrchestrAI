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
    blob.includes('quota') ||
    // Claude Max — SDK가 result.is_error=true subtype='usage_limit_exceeded' 또는 텍스트로 안내문 보냄
    blob.includes('usage_limit_exceeded') ||
    blob.includes('usage limit') ||
    blob.includes('5-hour limit') ||
    blob.includes('your limit will reset') ||
    // Codex/OpenAI — 'insufficient_quota' / 'tokens-per-minute' 등 흔한 변형
    blob.includes('insufficient_quota') ||
    blob.includes('tokens per minute') ||
    blob.includes('tpm') ||
    // 한국어 안내 (모델이 한국어로 quota 안내 출력하는 경우)
    blob.includes('제한에 도달') ||
    blob.includes('쿼터 소진') ||
    blob.includes('사용량 한도') ||
    // 빈 응답 — 토큰은 썼는데 본문 못 받은 경우. 진짜 quota는 아니지만 다음 모델로 폴백하는 게 UX에 낫다.
    blob.includes('빈 응답') ||
    blob.includes('empty response')
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
