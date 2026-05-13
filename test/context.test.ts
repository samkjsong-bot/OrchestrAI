// test/context.test.ts
// directive Phase 1 — token-aware context budgeting 의 회귀 테스트.
// vscode 의존성 없는 순수 함수만 (intent classifier / secret scanner / budget / projection / receipt).

import { describe, expect, it } from 'vitest'
import { classifyIntent, DEFAULT_CONTEXT_LEVEL_BY_INTENT } from '../src/context/intentClassifier'
import { isSecretPath, isIgnoredPath, containsSecretValue, scanCandidates } from '../src/context/secretScanner'
import { resolveBudget, tokenModeFromSetting } from '../src/context/contextBudget'
import { projectForModel, providerFromModel } from '../src/context/contextProjection'
import { createTokenReceipt, formatReceiptShort, estimateTokens } from '../src/util/tokenReceipt'
import { ContextLevel, type ContextBundle } from '../src/context/types'

describe('classifyIntent', () => {
  it('스택 트레이스 → debug_runtime_error', () => {
    expect(classifyIntent('TypeError: x is not a function\n  at foo (a.js:10)')).toBe('debug_runtime_error')
    expect(classifyIntent('에러가 나는데 어디서 터지는지')).toBe('debug_runtime_error')
  })
  it('review 키워드 → review_diff', () => {
    expect(classifyIntent('review this diff')).toBe('review_diff')
    expect(classifyIntent('이 PR 리뷰해줘')).toBe('review_diff')
  })
  it('아키텍처 → architecture', () => {
    expect(classifyIntent('explain the architecture')).toBe('architecture')
    expect(classifyIntent('전체 구조 설명해줘')).toBe('architecture')
  })
  it('test 작성 → write_tests', () => {
    expect(classifyIntent('write unit tests for foo')).toBe('write_tests')
    expect(classifyIntent('테스트 짜줘')).toBe('write_tests')
  })
  it('보안 → security_review', () => {
    expect(classifyIntent('SQL injection 위험 있나?')).toBe('security_review')
  })
  it('성능 → performance_review', () => {
    expect(classifyIntent('이 함수 느려요 최적화')).toBe('performance_review')
  })
  it('explain → explain_code', () => {
    expect(classifyIntent('이게 뭐 하는 거야?')).toBe('explain_code')
    expect(classifyIntent('explain this function')).toBe('explain_code')
  })
  it('bug fix', () => {
    expect(classifyIntent('이거 버그 고쳐줘')).toBe('bug_fix')
    expect(classifyIntent('button click doesn\'t work')).toBe('bug_fix')
  })
  it('implement → implement_feature', () => {
    expect(classifyIntent('add a search feature')).toBe('implement_feature')
    expect(classifyIntent('로그인 페이지 만들어줘')).toBe('implement_feature')
  })
  it('단순 짧은 질문 → general_chat', () => {
    expect(classifyIntent('야?')).toBe('general_chat')
  })
  it('default mapping — intent 별 ContextLevel 있음', () => {
    for (const intent of Object.keys(DEFAULT_CONTEXT_LEVEL_BY_INTENT)) {
      const level = DEFAULT_CONTEXT_LEVEL_BY_INTENT[intent as keyof typeof DEFAULT_CONTEXT_LEVEL_BY_INTENT]
      expect(typeof level).toBe('number')
    }
  })
})

describe('secretScanner', () => {
  it('isSecretPath — env / pem / id_rsa', () => {
    expect(isSecretPath('.env')).toBe(true)
    expect(isSecretPath('apps/.env.production')).toBe(true)
    expect(isSecretPath('keys/private.pem')).toBe(true)
    expect(isSecretPath('home/user/.ssh/id_rsa')).toBe(true)
    expect(isSecretPath('src/index.ts')).toBe(false)
  })
  it('isIgnoredPath — node_modules / lock files', () => {
    expect(isIgnoredPath('project/node_modules/x/index.js')).toBe(true)
    expect(isIgnoredPath('package-lock.json')).toBe(true)
    expect(isIgnoredPath('yarn.lock')).toBe(true)
    expect(isIgnoredPath('src/foo.lock')).toBe(true)
    expect(isIgnoredPath('src/index.ts')).toBe(false)
  })
  it('containsSecretValue — API key prefix', () => {
    expect(containsSecretValue('const k = "sk-abc1234567890def1234567890ghijkl"')).toBe(true)
    expect(containsSecretValue('AKIAABCDEFGHIJKLMNOP')).toBe(true)
    expect(containsSecretValue('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(containsSecretValue('const greeting = "hello world"')).toBe(false)
  })
  it('scanCandidates — env 차단, ignore 분리, 경고 누적', () => {
    const r = scanCandidates({
      filePaths: ['src/foo.ts', '.env', 'node_modules/x.js'],
      inlineText: 'no secrets here',
    })
    expect(r.blockedFiles).toContain('.env')
    expect(r.ignoredFiles).toContain('node_modules/x.js')
    expect(r.warnings.some(w => w.includes('potential secret'))).toBe(true)
    expect(r.hasSecretContent).toBe(false)
  })
})

describe('contextBudget', () => {
  it('tokenModeFromSetting — narrow→eco, default→balanced, wide→deep, full→full', () => {
    expect(tokenModeFromSetting('narrow')).toBe('eco')
    expect(tokenModeFromSetting('default')).toBe('balanced')
    expect(tokenModeFromSetting('wide')).toBe('deep')
    expect(tokenModeFromSetting('full')).toBe('full')
    expect(tokenModeFromSetting(undefined)).toBe('balanced')
  })
  it('resolveBudget — eco 는 ActiveSymbol 까지만 (architecture 라도 cap)', () => {
    const r = resolveBudget({ mode: 'eco', intent: 'architecture' })
    expect(r.contextLevel).toBe(ContextLevel.ActiveSymbol)  // architecture 는 원래 4 인데 eco 가 1 로 cap
  })
  it('resolveBudget — selection 있으면 level 한 단계 하향', () => {
    const noSel = resolveBudget({ mode: 'balanced', intent: 'refactor', hasSelection: false })
    const sel = resolveBudget({ mode: 'balanced', intent: 'refactor', hasSelection: true })
    expect(sel.contextLevel).toBeLessThan(noSel.contextLevel)
  })
  it('resolveBudget — balanced 는 RelatedFiles 까지', () => {
    const r = resolveBudget({ mode: 'balanced', intent: 'architecture' })
    expect(r.contextLevel).toBeLessThanOrEqual(ContextLevel.RelatedFiles)
  })
  it('resolveBudget — full 은 FullContextExplicit 도달 가능', () => {
    const r = resolveBudget({ mode: 'full', intent: 'architecture' })
    expect(r.contextLevel).toBeLessThanOrEqual(ContextLevel.FullContextExplicit)
  })
  it('resolveBudget — eco 의 section budget 은 minimum (relatedSnippets=0)', () => {
    const r = resolveBudget({ mode: 'eco', intent: 'bug_fix' })
    expect(r.sections.relatedSnippets).toBe(0)
    expect(r.sections.gitDiff).toBe(0)
  })
})

describe('contextProjection', () => {
  function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
    return {
      requestId: 'test', mode: 'balanced', intent: 'bug_fix', contextLevel: ContextLevel.RelatedFiles,
      userQuestion: 'fix this',
      activeFile: {
        path: 'src/foo.ts', language: 'typescript',
        selectedText: 'const x = 1',
        focusedSnippet: {
          path: 'src/foo.ts', startLine: 10, endLine: 20,
          code: 'function foo() { return 1 }',
          reason: 'enclosing function',
        },
        fileSummary: 'imports: react\nexports: foo',
      },
      relatedSnippets: [],
      relatedFileSummaries: [],
      safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
      tokenEstimate: { rawCandidateTokens: 0, finalInputTokens: 0, estimatedSavedTokens: 0, compressionRatio: 1, bySection: {} },
      ...overrides,
    }
  }
  it('providerFromModel — built-in + custom mapping', () => {
    expect(providerFromModel('claude')).toBe('claude')
    expect(providerFromModel('codex')).toBe('codex')
    expect(providerFromModel('gemini')).toBe('gemini')
    expect(providerFromModel('custom:gemma4')).toBe('custom')
  })
  it('Claude projection — fileSummary 제외 (expensive expert)', () => {
    const p = projectForModel({ bundle: makeBundle(), modelProvider: 'claude' })
    expect(p.includedSections).toContain('activeFile')
    expect(p.excludedSections.some(s => s.includes('summary'))).toBe(true)
    expect(p.prompt).toContain('const x = 1')  // selectedText 포함
    expect(p.prompt).toContain('function foo()')  // focused snippet 포함
    expect(p.prompt).not.toContain('imports: react')  // fileSummary 제외
  })
  it('Gemini projection — fileSummary 포함 (long-context)', () => {
    const p = projectForModel({ bundle: makeBundle(), modelProvider: 'gemini' })
    expect(p.prompt).toContain('imports: react')
  })
  it('gitDiff section — 있으면 projection 에 포함', () => {
    const p = projectForModel({
      bundle: makeBundle({ gitDiff: 'diff --git a/x b/x' }),
      modelProvider: 'claude',
    })
    expect(p.includedSections).toContain('gitDiff')
    expect(p.prompt).toContain('diff --git')
  })
  it('safety warnings 있으면 projection 에 안내 박힘', () => {
    const p = projectForModel({
      bundle: makeBundle({
        safety: { containsPotentialSecrets: true, blockedFiles: ['.env'], warnings: ['Excluded .env'], requiresUserApproval: true },
      }),
      modelProvider: 'claude',
    })
    expect(p.includedSections).toContain('safety')
    expect(p.prompt).toContain('Excluded .env')
  })
  it('빈 bundle — projection 도 빈 prompt', () => {
    const empty: ContextBundle = {
      requestId: 'e', mode: 'eco', intent: 'general_chat', contextLevel: ContextLevel.SelectionOnly,
      userQuestion: 'hi',
      relatedSnippets: [], relatedFileSummaries: [],
      safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
      tokenEstimate: { rawCandidateTokens: 0, finalInputTokens: 0, estimatedSavedTokens: 0, compressionRatio: 1, bySection: {} },
    }
    const p = projectForModel({ bundle: empty, modelProvider: 'claude' })
    expect(p.prompt).toBe('')
    expect(p.includedSections).toEqual([])
  })
})

describe('tokenReceipt', () => {
  it('estimateTokens — 한글 1자/tok, 영어 4자/tok', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens('안녕')).toBe(2)  // 2 korean = 2 tok
    expect(estimateTokens('abcd')).toBe(1)  // 4 char other = 1 tok
    expect(estimateTokens('안녕abcd')).toBe(3)  // 2 + 1
  })
  it('createTokenReceipt — saved% 계산', () => {
    const bundle: ContextBundle = {
      requestId: 'r1', mode: 'balanced', intent: 'bug_fix', contextLevel: ContextLevel.RelatedFiles,
      userQuestion: 'q',
      activeFile: { path: 'a.ts', focusedSnippet: { path: 'a.ts', code: 'short', reason: 'r' } },
      relatedSnippets: [], relatedFileSummaries: [],
      safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
      tokenEstimate: { rawCandidateTokens: 10000, finalInputTokens: 1500, estimatedSavedTokens: 8500, compressionRatio: 0.15, bySection: { activeFile: 1500 } },
    }
    const r = createTokenReceipt({ bundle, models: ['claude'], finalSentTokens: 1500 })
    expect(r.rawCandidateTokens).toBe(10000)
    expect(r.finalSentTokens).toBe(1500)
    expect(r.estimatedSavedTokens).toBe(8500)
    expect(r.compressionRatio).toBeCloseTo(0.15, 2)
    expect(r.filesSent.length).toBeGreaterThan(0)
  })
  it('formatReceiptShort — saved% 표시', () => {
    const bundle: ContextBundle = {
      requestId: 'r2', mode: 'balanced', intent: 'bug_fix', contextLevel: ContextLevel.RelatedFiles,
      userQuestion: 'q', relatedSnippets: [], relatedFileSummaries: [],
      safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
      tokenEstimate: { rawCandidateTokens: 10000, finalInputTokens: 0, estimatedSavedTokens: 0, compressionRatio: 1, bySection: {} },
    }
    const r = createTokenReceipt({ bundle, models: ['claude'], finalSentTokens: 1500 })
    const short = formatReceiptShort(r)
    expect(short).toContain('Balanced')
    expect(short).toContain('saved')
    expect(short).toContain('85%')
  })
  it('formatReceiptShort — final >= baseline 이면 saved% 표시 X (절약 0 일 때 거짓말 금지)', () => {
    // 회귀: 활성 파일 없거나 사용자가 ctx-btn 끔 → baseline=0 인데 user question 만 baseline 에 넣어서 "100% saved" 거짓말 발생했었음.
    const bundle: ContextBundle = {
      requestId: 'r3', mode: 'balanced', intent: 'general_chat', contextLevel: ContextLevel.SelectionOnly,
      userQuestion: '안녕', relatedSnippets: [], relatedFileSummaries: [],
      safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
      tokenEstimate: { rawCandidateTokens: 0, finalInputTokens: 0, estimatedSavedTokens: 0, compressionRatio: 1, bySection: {} },
    }
    const r = createTokenReceipt({ bundle, models: ['claude'], finalSentTokens: 0 })
    const short = formatReceiptShort(r)
    expect(short).not.toContain('saved')
    expect(short).toContain('Balanced')
    expect(short).toContain('0 tok')
    expect(r.estimatedSavedTokens).toBe(0)
  })
  it('formatReceiptShort — final > baseline (gitDiff 추가했을 때) 도 saved% 표시 X', () => {
    const bundle: ContextBundle = {
      requestId: 'r4', mode: 'balanced', intent: 'review_diff', contextLevel: ContextLevel.ProjectSummaryPlusDiff,
      userQuestion: 'review', relatedSnippets: [], relatedFileSummaries: [],
      safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
      tokenEstimate: { rawCandidateTokens: 500, finalInputTokens: 800, estimatedSavedTokens: 0, compressionRatio: 1.6, bySection: {} },
    }
    const r = createTokenReceipt({ bundle, models: ['claude'], finalSentTokens: 800 })
    const short = formatReceiptShort(r)
    expect(short).not.toContain('saved')
    expect(short).toContain('800 tok')
  })
})
