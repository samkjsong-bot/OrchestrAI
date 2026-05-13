// src/util/argueDebate.ts
// Argue 모드 토큰 폭주 방지 — 각 라운드 응답 본문 대신 compact summary 를 다음 모델한테 전달.
// directive Phase 1 의 multi-model 규칙 (15.1) — round 2+ 는 raw history 보내지 마라.
//
// 흐름:
//   round 1: model A 응답 → summarizeDebateTurn → DebateTurnSummary 저장
//   round 2: B 한테 보낼 history = [userMsg, "Round 1 (A): <summary>"]  (raw A 응답 X)
//   round 3: C 한테 history = [userMsg, "Round 1 (A): ...", "Round 2 (B): ..."]
//
// 결과: raw 응답이 history 누적되지 않음 → input token 폭주 차단.

import type { Model } from '../router/types'
import { callCaptain, type CaptainChoice } from './captain'
import { log } from './log'

export interface DebateTurnSummary {
  round: number          // 1-based
  model: Model
  text: string           // 1-2 줄, ~150 한국어 chars
  rawTokens: number      // 원본 응답의 token 추정 (token 절감 효과 측정용)
  summaryTokens: number  // summary 자체의 token 추정
}

const SUMMARIZER_SYSTEM = `You compress one debate-round response for context-passing to the NEXT debater.

Rules:
- Output 2-3 lines, MAX 150 Korean characters total (or ~60 English words).
- Capture: core position + main reasoning. Skip examples, pleasantries, repetition.
- No model name prefix. No quotes. Just the compressed claim.
- Same language as the input (Korean in → Korean out).
- If the response was vague/off-topic, say so honestly in 1 line.`

/** Haiku/captain 으로 한 응답을 ~150자로 압축. captain='none' 이면 naive truncate. */
export async function summarizeDebateTurn(
  args: { round: number; model: Model; text: string; captain: CaptainChoice },
): Promise<DebateTurnSummary> {
  const { round, model, text, captain } = args
  const rawTokens = estimateKoreanTokens(text)
  // captain 없으면 첫 200자 + "..." 로 대충 자름 (LLM 호출 없이 fallback).
  if (captain === 'none' || !text.trim()) {
    const truncated = text.length > 200 ? text.slice(0, 200).trim() + '...' : text
    return { round, model, text: truncated, rawTokens, summaryTokens: estimateKoreanTokens(truncated) }
  }
  try {
    const userPrompt = `Round ${round} response by ${model}:\n\n${text.slice(0, 4000)}`
    const summary = await callCaptain(captain, SUMMARIZER_SYSTEM, userPrompt)
    if (!summary || !summary.trim()) {
      log.warn('argue', `summarize round ${round} (${model}) — empty captain reply, truncate fallback`)
      const truncated = text.length > 200 ? text.slice(0, 200).trim() + '...' : text
      return { round, model, text: truncated, rawTokens, summaryTokens: estimateKoreanTokens(truncated) }
    }
    const cleaned = summary.trim()
    return { round, model, text: cleaned, rawTokens, summaryTokens: estimateKoreanTokens(cleaned) }
  } catch (err) {
    log.warn('argue', `summarize round ${round} (${model}) failed:`, err)
    const truncated = text.length > 200 ? text.slice(0, 200).trim() + '...' : text
    return { round, model, text: truncated, rawTokens, summaryTokens: estimateKoreanTokens(truncated) }
  }
}

/**
 * 다음 argue 라운드 model 한테 보낼 messages history 구성.
 * - userMsg (질문) 그대로
 * - 이전 각 라운드는 summary 만 (raw 응답 X)
 *
 * buildTaggedHistory 가 _messages 전체 사용하는 것과 별개 — 이 override 를 _runTurn 에 넘기면
 * buildTaggedHistory 건너뛰고 이걸 그대로 history 로 사용.
 */
export function buildArgueHistoryOverride(args: {
  userQuestion: string
  summaries: DebateTurnSummary[]
}): Array<{ role: 'user' | 'assistant'; content: string }> {
  const { userQuestion, summaries } = args
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  out.push({ role: 'user', content: userQuestion })
  for (const s of summaries) {
    // <prior_turn from="X"> 태그 — buildTaggedHistory 와 동일 포맷. 모델이 자기 답인 척 안 함.
    out.push({
      role: 'assistant',
      content: `<prior_turn from="${s.model}" round="${s.round}">\n${s.text}\n</prior_turn>`,
    })
  }
  return out
}

/** Argue 라운드 전체 totals — UI 카드 표시용. */
export interface ArgueTotals {
  rounds: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  maxOutputModel?: Model     // 가장 길게 답한 모델 (사용자가 "얘가 폭주했다" 식별)
  maxOutputTokens: number
  byModel: Partial<Record<Model, { input: number; output: number; rounds: number }>>
}

export function emptyArgueTotals(): ArgueTotals {
  return { rounds: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, maxOutputTokens: 0, byModel: {} }
}

export function addToArgueTotals(
  totals: ArgueTotals,
  model: Model,
  inputTokens: number,
  outputTokens: number,
): ArgueTotals {
  totals.rounds += 1
  totals.inputTokens += inputTokens
  totals.outputTokens += outputTokens
  totals.totalTokens = totals.inputTokens + totals.outputTokens
  if (outputTokens > totals.maxOutputTokens) {
    totals.maxOutputTokens = outputTokens
    totals.maxOutputModel = model
  }
  const key = String(model) as Model
  if (!totals.byModel[key]) totals.byModel[key] = { input: 0, output: 0, rounds: 0 }
  totals.byModel[key]!.input += inputTokens
  totals.byModel[key]!.output += outputTokens
  totals.byModel[key]!.rounds += 1
  return totals
}

/** 한국어 1자/tok, 그 외 4자/tok — util/tokenReceipt 와 동일 휴리스틱. duplicate 피하려고 동일 함수 재정의 X 하고 싶지만 순환 의존성 방지로 별도. */
function estimateKoreanTokens(text: string | undefined | null): number {
  if (!text) return 0
  const korean = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - korean
  return Math.ceil(korean + other / 4)
}

/** TokenMode → Argue 모드 응답 길이 cap (한국어 char). directive Phase 1 — Argue 폭주 방지. */
export function argueOutputCapKR(mode: 'eco' | 'balanced' | 'deep' | 'full'): number {
  switch (mode) {
    case 'eco':      return 400
    case 'balanced': return 700
    case 'deep':     return 1200
    case 'full':     return 2000
  }
}
