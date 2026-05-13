// src/context/types.ts
// Token-aware context budgeting 의 공통 타입. directive 의 10절 데이터 모델.

export type TokenMode = 'eco' | 'balanced' | 'deep' | 'full'

export enum ContextLevel {
  SelectionOnly = 0,
  ActiveSymbol = 1,
  ActiveFileFocused = 2,
  RelatedFiles = 3,
  ProjectSummaryPlusDiff = 4,
  FullContextExplicit = 5,
}

export type IntentCategory =
  | 'explain_code'
  | 'bug_fix'
  | 'implement_feature'
  | 'refactor'
  | 'write_tests'
  | 'review_diff'
  | 'architecture'
  | 'debug_runtime_error'
  | 'dependency_issue'
  | 'security_review'
  | 'performance_review'
  | 'documentation'
  | 'general_chat'
  | 'unknown'

export interface CodeSnippet {
  path: string
  language?: string
  startLine?: number
  endLine?: number
  code: string
  reason: string
  relevanceScore?: number
  tokenEstimate?: number
}

export interface ContextSafetyReport {
  containsPotentialSecrets: boolean
  blockedFiles: string[]   // 경로만 (내용 X)
  warnings: string[]
  requiresUserApproval: boolean
}

export interface TokenEstimate {
  rawCandidateTokens: number       // 만약 모든 후보 컨텍스트 다 보냈으면 이만큼
  finalInputTokens: number          // 실제 projection 후 보낸 토큰
  estimatedSavedTokens: number      // rawCandidate - finalInput (clamp ≥ 0)
  compressionRatio: number          // finalInput / rawCandidate (1 = no compression)
  bySection: Record<string, number> // section name → tokens
}

export interface ContextBundle {
  requestId: string
  mode: TokenMode
  intent: IntentCategory
  contextLevel: ContextLevel
  userQuestion: string

  activeFile?: {
    path: string
    language?: string
    selectedText?: string
    activeSymbolName?: string
    focusedSnippet?: CodeSnippet
    fileSummary?: string
  }

  relatedSnippets: CodeSnippet[]
  relatedFileSummaries: Array<{
    path: string
    summary: string
    reason: string
    tokenEstimate?: number
  }>

  gitDiff?: string
  terminalOutput?: string
  diagnostics?: unknown[]
  projectSummary?: string
  sessionSummary?: string

  safety: ContextSafetyReport
  tokenEstimate: TokenEstimate
}

export type ModelProvider = 'gemini' | 'claude' | 'codex' | 'gpt' | 'local' | 'custom' | 'synthesizer'

export interface ModelContextProjection {
  modelProvider: ModelProvider
  prompt: string                    // projection 결과 텍스트 (system prompt 의 file-context 자리에 박힘)
  messages?: unknown[]              // 필요시 multi-turn 메시지 (Phase 1 미사용)
  includedSections: string[]
  excludedSections: string[]
  tokenEstimate: number
  reason: string
}
