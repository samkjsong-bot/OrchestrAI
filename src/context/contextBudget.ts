// src/context/contextBudget.ts
// directive 6 + 16절 — TokenMode + intent → ContextLevel + 섹션별 토큰 한도.
// "각 모드에서 어떤 섹션에 몇 토큰까지 허용?" 의 단일 진실 (single source of truth).

import { ContextLevel, type IntentCategory, type TokenMode } from './types'
import { DEFAULT_CONTEXT_LEVEL_BY_INTENT } from './intentClassifier'

/** 각 mode 가 허용하는 ContextLevel 의 최대치. mode 가 더 좁으면 intent 가 요구해도 못 올라감. */
const MAX_LEVEL_BY_MODE: Record<TokenMode, ContextLevel> = {
  eco:      ContextLevel.ActiveSymbol,
  balanced: ContextLevel.RelatedFiles,
  deep:     ContextLevel.ProjectSummaryPlusDiff,
  full:     ContextLevel.FullContextExplicit,
}

/** mode 별 섹션 토큰 한도 (대략적인 휴리스틱 — 정확도보다 토큰 폭주 방지가 목적). */
export interface SectionBudget {
  activeFile: number       // selectedText + focusedSnippet + fileSummary 합쳐서
  relatedSnippets: number  // 모든 related snippet 합계
  relatedSummaries: number
  gitDiff: number
  projectSummary: number
  sessionSummary: number
  history: number          // 과거 대화 (eco 면 매우 작게)
}

const BUDGET_BY_MODE: Record<TokenMode, SectionBudget> = {
  eco: {
    activeFile: 800, relatedSnippets: 0, relatedSummaries: 0,
    gitDiff: 0, projectSummary: 0, sessionSummary: 0, history: 800,
  },
  balanced: {
    activeFile: 3000, relatedSnippets: 2500, relatedSummaries: 800,
    gitDiff: 1200, projectSummary: 400, sessionSummary: 600, history: 4000,
  },
  deep: {
    activeFile: 6000, relatedSnippets: 6000, relatedSummaries: 2000,
    gitDiff: 3000, projectSummary: 1500, sessionSummary: 1500, history: 12000,
  },
  full: {
    activeFile: 30000, relatedSnippets: 20000, relatedSummaries: 5000,
    gitDiff: 10000, projectSummary: 5000, sessionSummary: 3000, history: 40000,
  },
}

export interface ResolvedBudget {
  mode: TokenMode
  contextLevel: ContextLevel
  intent: IntentCategory
  sections: SectionBudget
  /** 사용자가 selectedText 있으면 우선순위 하향 — directive 8절 heuristic. */
  hasSelection: boolean
}

export interface ResolveOptions {
  mode: TokenMode
  intent: IntentCategory
  hasSelection?: boolean
  /** 명시적 override — argue/team/loop 같은 멀티모델 모드는 round 1 만 풍부하게. */
  forceLevel?: ContextLevel
}

/** mode + intent + selection → ContextLevel + 섹션 한도. */
export function resolveBudget(opts: ResolveOptions): ResolvedBudget {
  const { mode, intent, hasSelection = false, forceLevel } = opts
  const intentLevel = DEFAULT_CONTEXT_LEVEL_BY_INTENT[intent]
  // selection 있으면 한 단계 하향 (사용자가 이미 좁혀놓은 셈)
  const adjusted = hasSelection && intentLevel > ContextLevel.SelectionOnly
    ? (intentLevel - 1) as ContextLevel
    : intentLevel
  const max = MAX_LEVEL_BY_MODE[mode]
  const finalLevel = Math.min(forceLevel ?? adjusted, max) as ContextLevel
  return {
    mode, contextLevel: finalLevel, intent,
    sections: BUDGET_BY_MODE[mode], hasSelection,
  }
}

/** directive 14.1 매핑 — VSCode setting "narrow/default/wide" → TokenMode. */
export function tokenModeFromSetting(setting: string | undefined): TokenMode {
  switch (setting) {
    case 'narrow': return 'eco'
    case 'wide': return 'deep'
    case 'full': return 'full'
    case 'default':
    default: return 'balanced'
  }
}
