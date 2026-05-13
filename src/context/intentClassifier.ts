// src/context/intentClassifier.ts
// directive 8절 — heuristic 기반 intent 분류. LLM 호출 X (Phase 1).
// 매 turn 마다 호출되므로 빠른 정규식만.

import type { IntentCategory } from './types'

/**
 * 사용자 prompt 한 줄 분석해서 IntentCategory 추정.
 * 매칭 시 가장 구체적인 카테고리 우선. 매칭 없으면 'unknown'.
 *
 * 한국어/영어 양쪽 키워드 모두 지원.
 */
export function classifyIntent(text: string): IntentCategory {
  const t = text.trim()
  if (!t) return 'general_chat'
  const lower = t.toLowerCase()

  // ── 스택 트레이스 / runtime error ──
  if (/\b(traceback|stack trace|stacktrace|exception|^\s*at\s+\w+\s*\()/i.test(t) ||
      /TypeError|ReferenceError|SyntaxError|NullPointerException|panic:/i.test(t) ||
      /에러가\s*나|런타임\s*에러|에러\s*고쳐|크래시|crash|undefined is not a function/i.test(t)) {
    return 'debug_runtime_error'
  }

  // ── diff / review ──
  if (/\b(diff|review|pr review|code review|patch)\b/i.test(t) ||
      /(리뷰|차이|diff\s*봐|변경\s*점)/.test(t)) {
    return 'review_diff'
  }

  // ── security ──
  if (/\b(security|vulnerability|exploit|injection|xss|csrf|sanitiz)/i.test(lower) ||
      /(보안|취약|보안\s*검토|injection|XSS)/.test(t)) {
    return 'security_review'
  }

  // ── performance ──
  if (/\b(performance|latency|profil|optimiz|slow|bottleneck|memory leak)/i.test(lower) ||
      /(느려|성능|최적화|병목|메모리\s*누수)/.test(t)) {
    return 'performance_review'
  }

  // ── dependency / package issue ──
  if (/\b(npm install|yarn add|pip install|package-lock|peer dependency|version conflict|dependabot)\b/i.test(lower) ||
      /(패키지\s*에러|의존성|version\s*충돌|버전\s*충돌|node_modules)/.test(t)) {
    return 'dependency_issue'
  }

  // ── refactor (단일 파일·여러 파일 둘 다 여기) ──
  if (/\b(refactor|rename|extract|cleanup|tidy up|deduplicate)\b/i.test(lower) ||
      /(리팩토링|리팩토|정리해|중복\s*제거|이름\s*바꿔)/.test(t)) {
    return 'refactor'
  }

  // ── architecture / design ──
  if (/\b(architecture|design pattern|system design|module structure|monorepo|whole project|entire codebase|전체\s*구조|design doc)\b/i.test(lower) ||
      /(아키텍처|설계|구조|전체\s*프로젝트|전체\s*코드)/.test(t)) {
    return 'architecture'
  }

  // ── tests ──
  if (/\b(write tests?|test cases?|unit tests?|integration tests?|e2e tests?|jest|vitest|pytest|cypress|playwright)\b/i.test(lower) ||
      /(테스트\s*(?:짜|작성|추가|만들)|단위\s*테스트)/.test(t)) {
    return 'write_tests'
  }

  // ── documentation ──
  if (/\b(document|readme|jsdoc|docstring|comment this|explain in comments)\b/i.test(lower) ||
      /(주석|문서화|README|설명\s*해줘\s*$)/.test(t)) {
    return 'documentation'
  }

  // ── bug fix (구체적 fix 요청) ──
  if (/\b(fix|bug|broken|doesn'?t work|not working|fails?)\b/i.test(lower) ||
      /(버그|고쳐|안\s*돼|안\s*되|작동\s*안|동작\s*안)/.test(t)) {
    return 'bug_fix'
  }

  // ── implement / build feature ──
  if (/\b(implement|build|create|scaffold|make\s+a)\b/i.test(lower) ||
      /\badd\b[^.!?]*\b(feature|component|page|endpoint|api|cli|button|form|hook|screen|view|service|module|route|command|panel)\b/i.test(lower) ||
      /(만들어|구현|추가\s*해|기능\s*추가|짜줘)/.test(t)) {
    return 'implement_feature'
  }

  // ── explain code ──
  if (/\b(explain|what does this|how does .* work|walk me through|이게\s*뭐|왜\s*동작)\b/i.test(t) ||
      /(설명|이해\s*안|뭐\s*하는\s*거|어떻게\s*작동|왜\s*그래)/.test(t)) {
    return 'explain_code'
  }

  // ── general chat (짧은 한 줄, 의문문) ──
  if (t.length < 50 && /[?？]/.test(t)) return 'general_chat'

  return 'unknown'
}

/** intent 별 default context level 매핑 (directive 8절). */
import { ContextLevel } from './types'
export const DEFAULT_CONTEXT_LEVEL_BY_INTENT: Record<IntentCategory, ContextLevel> = {
  explain_code: ContextLevel.ActiveSymbol,
  bug_fix: ContextLevel.RelatedFiles,
  implement_feature: ContextLevel.ProjectSummaryPlusDiff,
  refactor: ContextLevel.RelatedFiles,
  write_tests: ContextLevel.RelatedFiles,
  review_diff: ContextLevel.ProjectSummaryPlusDiff,
  architecture: ContextLevel.ProjectSummaryPlusDiff,
  debug_runtime_error: ContextLevel.RelatedFiles,
  dependency_issue: ContextLevel.RelatedFiles,
  security_review: ContextLevel.RelatedFiles,
  performance_review: ContextLevel.RelatedFiles,
  documentation: ContextLevel.ActiveFileFocused,
  general_chat: ContextLevel.SelectionOnly,
  unknown: ContextLevel.ActiveSymbol,
}
