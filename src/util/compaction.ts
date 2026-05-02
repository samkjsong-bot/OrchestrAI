// src/util/compaction.ts
// Claude Code 스타일 하이브리드 컨텍스트 압축.
// 누적 토큰이 임계치 넘으면 오래된 메시지 N개를 Haiku로 요약.
// 최근 K개는 원문 보존 — 디테일 안 잃음. 다음 호출 시 [요약 + 최근 원문]만 모델에 전달.

import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ChatMessage } from '../router/types'
import { estimateTokens } from './history'
import { log } from './log'

export interface CompactionState {
  summary: string             // Haiku가 만든 마크다운 요약본
  summarizedUpTo: number      // messages 배열 인덱스 (exclusive). 이 인덱스 이전이 요약됨.
  summarizedAt: number        // 마지막 압축 시각 (ms)
  originalTokens: number      // 압축 전 누적 토큰 (디버그·UI용)
  summaryTokens: number       // 요약 후 토큰 추정
}

// 압축 트리거 — Claude Code 수준으로 매우 늦게. 모델 context 한계 가까워질 때만.
// Claude 1M / Codex 256k / Gemini 1M 기준으로 ~150k 도달 시에만 트리거 (전체 안전마진).
const TRIGGER_TOKENS = 150_000  // 압축 대상 토큰량 (옛 15k → 50k → 150k)
const KEEP_RECENT = 100         // 최근 verbatim 보존 (옛 10 → 30 → 100)
const MIN_OLDER = 30            // 그 이전에 최소 이만큼 있어야 압축 의미 있음

const SUMMARIZER_SYSTEM = `You are compacting a multi-turn AI coding assistant chat history to save tokens. The conversation will continue after this summary, so include everything a future assistant would need to continue coherently.

Output as markdown:

## Goal
What the user is building (1-2 lines).

## Decisions made
- File paths created/modified (full paths, one per line)
- Design choices with brief reasoning
- User constraints and preferences — KEEP VERBATIM when specific (e.g. "use Tailwind, no extra libs")
- Naming conventions agreed
- Things explicitly NOT to touch

## Code state
File-by-file: \`path/to/file.ts\` — one-line role description.

## Open items
- What's pending or in progress
- Last question being addressed

Rules:
- Preserve VERBATIM: explicit user requirements, file/function/variable names, key constants, error messages, version numbers, paths.
- Compress: exploration, resolved discussions, intermediate reasoning.
- Be terse, bullet points, no fluff.
- Stay under 800 tokens.
- Korean if the conversation is Korean, English if English. Match the user's language.`

function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}

/** 압축이 의미있는 시점인지 판단 */
export function shouldCompact(
  messages: ChatMessage[],
  existing?: CompactionState,
): boolean {
  const start = existing?.summarizedUpTo ?? 0
  const remaining = messages.slice(start).filter(m => m.role === 'user' || m.role === 'assistant')
  // 최근 KEEP_RECENT 빼고 그 이전 영역만 압축 후보
  const candidateLen = remaining.length - KEEP_RECENT
  if (candidateLen < MIN_OLDER) return false

  const candidates = remaining.slice(0, candidateLen)
  const tokens = candidates.reduce((s, m) => s + estimateTokens(m.content), 0)
  return tokens >= TRIGGER_TOKENS
}

/** 메시지 영역을 Haiku로 요약. 기존 요약 있으면 누적 */
export async function compactMessages(
  messages: ChatMessage[],
  existing: CompactionState | undefined,
  onActivity?: (text: string) => void,
): Promise<CompactionState | null> {
  const start = existing?.summarizedUpTo ?? 0
  const cutoff = messages.length - KEEP_RECENT
  if (cutoff <= start) return existing ?? null

  const toCompact = messages.slice(start, cutoff).filter(m => m.role === 'user' || m.role === 'assistant')
  if (toCompact.length === 0) return existing ?? null

  const originalDeltaTokens = toCompact.reduce((s, m) => s + estimateTokens(m.content), 0)

  const previous = existing?.summary
    ? `[Previous compaction summary — extend by merging with new chunk below]\n\n${existing.summary}\n\n[New chunk to merge]\n\n`
    : ''

  const blob = toCompact.map(m => {
    if (m.role === 'user') return `USER:\n${m.content}`
    const tag = m.model === 'claude' ? 'CLAUDE' : m.model === 'codex' ? 'CODEX' : 'GEMINI'
    return `${tag}:\n${m.content}`
  }).join('\n\n---\n\n')

  const prompt = previous + blob

  log.info('compact', `compacting ${toCompact.length} msgs, ${originalDeltaTokens} tokens`)
  onActivity?.(`📦 ${toCompact.length}개 메시지 압축 중...`)

  try {
    const q = query({
      prompt,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt: SUMMARIZER_SYSTEM,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        env: subscriptionEnv(),
      },
    })

    let summary = ''
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') summary += block.text
        }
      } else if (msg.type === 'result' && msg.is_error) {
        throw new Error(`compaction error: ${msg.subtype}`)
      }
    }

    if (!summary.trim()) throw new Error('empty summary returned')

    const summaryTokens = estimateTokens(summary)
    const newState: CompactionState = {
      summary,
      summarizedUpTo: cutoff,
      summarizedAt: Date.now(),
      originalTokens: (existing?.originalTokens ?? 0) + originalDeltaTokens,
      summaryTokens,
    }
    log.info('compact', `done. ${originalDeltaTokens} → ${summaryTokens} tok (${Math.round((1 - summaryTokens / originalDeltaTokens) * 100)}% 절감)`)
    return newState
  } catch (err) {
    log.error('compact', 'failed:', err)
    onActivity?.(`압축 실패: ${err instanceof Error ? err.message : String(err)}`)
    return existing ?? null
  }
}
