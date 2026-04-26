// src/router/orchestrator.ts

import { patternRoute } from './patternRouter'
import { llmRoute } from './llmRouter'
import { RoutingDecision, RouterConfig, RouterMode, Effort, Model } from './types'

const MODEL_ALIASES: Record<Model, string[]> = {
  claude: ['claude', '클로드'],
  codex: ['codex', '코덱스'],
  gemini: ['gemini', '제미나이', '제미니'],
}

const EFFORT_MAP: Record<Effort, number> = {
  low: 1024,
  medium: 4096,
  high: 10000,
  'extra-high': 20000,
}

const OPENAI_EFFORT_MAP: Record<Effort, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  'extra-high': 'high',
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectMentionIndexes(input: string, requireAt: boolean): Array<{ m: Model; i: number }> {
  const found: Array<{ m: Model; i: number }> = []

  for (const [model, aliases] of Object.entries(MODEL_ALIASES) as Array<[Model, string[]]>) {
    for (const alias of aliases) {
      const prefix = requireAt ? '@\\s*' : '@?\\s*'
      const source = `${prefix}${escapeRegExp(alias)}`
      const flags = alias === alias.toLowerCase() ? 'gi' : 'g'
      const re = new RegExp(source, flags)
      let match: RegExpExecArray | null

      while ((match = re.exec(input)) !== null) {
        found.push({ m: model, i: match.index })
      }
    }
  }

  return found
}

export function parseAllMentions(input: string): Model[] {
  const atMentions = collectMentionIndexes(input, true)
  const mentions = atMentions.length > 0
    ? atMentions
    : collectMentionIndexes(input, false)

  const seen = new Set<Model>()
  const ordered: Model[] = []

  for (const item of mentions.sort((a, b) => a.i - b.i)) {
    if (!seen.has(item.m)) {
      seen.add(item.m)
      ordered.push(item.m)
    }
  }

  return ordered
}

export function inferEffort(input: string): Effort {
  const text = input.trim()
  const lower = text.toLowerCase()
  const compact = text.replace(/\s+/g, ' ')

  if (/\b(high|deep|thorough|complex|architecture|architect|refactor|security|audit|optimize|debug)\b/i.test(text)) {
    return 'high'
  }
  if (/깊게|자세히|꼼꼼|복잡|설계|아키텍처|리팩토링|전체|대규모|보안|감사|최적화|고도화|검증/.test(text)) {
    return 'high'
  }
  if (/```|<file\b|여러\s*파일|코드베이스|프로젝트\s*전체|전체\s*구조|long\s*context/i.test(text)) {
    return 'high'
  }
  if (compact.length > 700) {
    return 'high'
  }

  if (/\b(low|quick|simple|short|brief|tl;dr|tldr|summary|summarize|typo)\b/i.test(text)) {
    return 'low'
  }
  if (/짧게|간단|빠르게|대충|한\s*줄|요약|정리|오타|커맨드|명령어/.test(text)) {
    return 'low'
  }
  if (/\b(git|npm|yarn|pnpm|cmd|powershell|bash|shell)\b/i.test(lower)) {
    return 'low'
  }
  if (compact.length <= 120 && !/[?？].*[?？]/.test(compact)) {
    return 'low'
  }

  return 'medium'
}

function parseMention(input: string): Model | null {
  const all = parseAllMentions(input)
  return all.length === 1 ? all[0] : null
}

export class Orchestrator {
  constructor(private config: RouterConfig) {}

  async route(input: string, override: RouterMode = 'auto'): Promise<RoutingDecision> {
    if (override !== 'auto' && override !== 'argue') {
      return {
        model: override as Model,
        effort: inferEffort(input),
        confidence: 1.0,
        reason: 'override',
      }
    }

    const mentioned = parseMention(input)
    if (mentioned) {
      return {
        model: mentioned,
        effort: inferEffort(input),
        confidence: 1.0,
        reason: 'mention',
        ruleMatched: `@${mentioned}`,
      }
    }

    const patternResult = patternRoute(input)
    if (patternResult && patternResult.confidence >= this.config.confidenceThreshold) {
      return patternResult
    }

    return llmRoute(input, this.config, patternResult ?? undefined)
  }

  getModelParams(effort: Effort) {
    return {
      claudeThinkingBudget: EFFORT_MAP[effort],
      codexReasoningEffort: OPENAI_EFFORT_MAP[effort],
    }
  }
}

