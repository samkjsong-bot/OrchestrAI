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

  // ── EXTRA-HIGH: 풀스케일 프로젝트/앱/게임 만들기 (모든 능력 풀가동) ──
  if (/\b(make|build|create|implement|develop|generate|scaffold)\s+(?:a |the |an )?(?:full|complete|entire|whole|complex|polished|production)\b/i.test(text)) {
    return 'extra-high'
  }
  if (/(게임|앱|어플|애플리케이션|웹사이트|사이트|서비스|프로그램|툴|확장|extension|game|app|website|service|program)\s*(?:을|를|좀|하나|좀\s*만들|만들|구현|짜|개발)/.test(text)) {
    return 'extra-high'
  }
  if (/(만들어|구현해|짜줘|개발해|풀버전|전체|풀\s*스택|fullstack|full-stack|full\s+app)/.test(text) && compact.length > 30) {
    return 'extra-high'
  }

  // ── HIGH: 코드 작성/수정/리팩토링/디버깅 — 모델의 깊은 사고 필요 ──
  if (/\b(high|deep|thorough|complex|architecture|architect|refactor|security|audit|optimize|debug)\b/i.test(text)) {
    return 'high'
  }
  if (/깊게|자세히|꼼꼼|복잡|설계|아키텍처|리팩토링|전체|대규모|보안|감사|최적화|고도화|검증/.test(text)) {
    return 'high'
  }
  if (/```|<file\b|여러\s*파일|코드베이스|프로젝트\s*전체|전체\s*구조|long\s*context/i.test(text)) {
    return 'high'
  }
  // ★ 코드 작업 키워드 — 단순 prompt도 high로 (구현/수정 계열은 mini로 보내면 결과 나쁨)
  if (/\b(code|function|class|implement|write|add|fix|update|modify|change|edit|create file)\b/i.test(text)) {
    return 'high'
  }
  if (/(코드|함수|클래스|메서드|컴포넌트|모듈|훅|hook|api|엔드포인트|로직|알고리즘|구조|패턴)\s*(?:를|을)?/.test(text)) {
    return 'high'
  }
  if (/(추가|수정|고쳐|고치|바꿔|변경|개선|버그|에러|오류|디버그|fix it)/.test(text)) {
    return 'high'
  }
  if (compact.length > 500) {
    return 'high'
  }

  // ── LOW: 명백히 단순한 작업 ──
  if (/\b(low|quick|simple|short|brief|tl;dr|tldr|summary|summarize|typo)\b/i.test(text)) {
    return 'low'
  }
  if (/짧게|간단|빠르게|대충|한\s*줄|요약|정리|오타|커맨드|명령어/.test(text)) {
    return 'low'
  }
  if (/\b(git|npm|yarn|pnpm|cmd|powershell|bash|shell)\s+\w+/i.test(lower)) {
    return 'low'
  }
  // 매우 짧은 단순 질문만 low (코드 키워드 없을 때)
  if (compact.length <= 60 && !/[?？]/.test(compact)) {
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

