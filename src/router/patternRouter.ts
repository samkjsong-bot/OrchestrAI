// src/router/patternRouter.ts

import { RoutingDecision } from './types'

interface Rule {
  pattern: RegExp
  model: 'claude' | 'codex' | 'gemini'
  effort: 'low' | 'medium' | 'high'
  confidence: number
  label: string
}

const RULES: Rule[] = [
  {
    pattern: /빠르게|간단히|간단하게|한\s*줄|짧게|오타|typo|quick|simple|brief/i,
    model: 'codex', effort: 'low', confidence: 0.92,
    label: 'quick-impl',
  },
  {
    pattern: /\bgit\b|\bnpm\b|\byarn\b|\bpnpm\b|터미널|bash|shell|cli|커맨드|명령어|powershell/i,
    model: 'codex', effort: 'low', confidence: 0.95,
    label: 'terminal-cli',
  },
  {
    pattern: /에러|오류|버그|안\s*돼|안됨|fix|bug|error|exception/i,
    model: 'codex', effort: 'medium', confidence: 0.82,
    label: 'bug-fix',
  },
  {
    pattern: /만들어\s*줘|생성해|수정해|고쳐줘|scaffold|boilerplate|template|implement/i,
    model: 'codex', effort: 'medium', confidence: 0.82,
    label: 'implementation',
  },
  {
    pattern: /왜|어떻게\s*동작|이해|설명|원리|why|explain|understand/i,
    model: 'claude', effort: 'medium', confidence: 0.88,
    label: 'explain-reason',
  },
  {
    pattern: /설계|아키텍처|구조|패턴|design|architect|structure/i,
    model: 'claude', effort: 'high', confidence: 0.92,
    label: 'architecture',
  },
  {
    pattern: /리팩토링|refactor|고도화|최적화|전체|멀티|여러\s*파일|코드베이스/i,
    model: 'claude', effort: 'high', confidence: 0.90,
    label: 'refactor',
  },
  {
    pattern: /리뷰|review|검토|점검|취약|보안|security|audit/i,
    model: 'claude', effort: 'high', confidence: 0.88,
    label: 'review',
  },
  {
    pattern: /전체\s*(코드베이스|프로젝트|문서)|대용량|large\s*file|긴\s*문서|long\s*context|이미지|image|screenshot|스크린샷|pdf|다이어그램/i,
    model: 'gemini', effort: 'medium', confidence: 0.86,
    label: 'long-context-or-multimodal',
  },
  {
    pattern: /요약해|요약|summarize|정리해|정리|tldr|tl;dr|훑어|overview/i,
    model: 'gemini', effort: 'low', confidence: 0.82,
    label: 'summarize',
  },
]

export function patternRoute(input: string): RoutingDecision | null {
  for (const rule of RULES) {
    if (rule.pattern.test(input)) {
      return {
        model: rule.model,
        effort: rule.effort,
        confidence: rule.confidence,
        reason: 'pattern',
        ruleMatched: rule.label,
      }
    }
  }
  return null
}
