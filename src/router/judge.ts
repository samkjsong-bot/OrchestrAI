// src/router/judge.ts
// argue 모드 중 각 턴의 주장을 다른 LLM(Claude Haiku)이 평가해 점수 매김.
// 점수 누적 → UI 스코어보드.

import { Model } from './types'
import { callCaptain, type CaptainChoice } from '../util/captain'

const JUDGE_SYSTEM = `You are a neutral AI judge scoring a debate between coding AI models (Claude, Codex, Gemini).

You receive:
1. The original user question
2. The latest argument from one model
3. Prior arguments in the debate (if any)

Return ONLY a JSON object, no other text:
{"score": 0-10, "reason": "one sentence why (Korean if args are Korean)"}

Scoring criteria (0-10 scale):
- 10: exceptional — decisive insight, correct, concise
- 7-9: strong — solid reasoning, useful
- 4-6: adequate — on topic but shallow or partly wrong
- 1-3: weak — missed point, filler, or repetitive
- 0: meaningless or contradicts the user's actual need

Score this LATEST argument relative to the prior ones. Reward originality and catching what peers missed. Penalize repetition and hedging.`

export interface JudgeVerdict {
  model: Model
  score: number  // 0-10
  reason: string
}

export async function judgeTurn(
  userQuestion: string,
  currentModel: Model,
  currentText: string,
  priorTurns: Array<{ model: Model; text: string }>,
  captain: CaptainChoice = 'claude',
): Promise<JudgeVerdict | null> {
  if (captain === 'none') return null
  const priorBlock = priorTurns.length === 0
    ? '(none — this is the opening argument)'
    : priorTurns.map(t => `[${t.model}]\n${t.text.slice(0, 2000)}`).join('\n\n---\n\n')

  const prompt = `## User question
${userQuestion}

## Prior arguments
${priorBlock}

## Latest argument (from ${currentModel})
${currentText.slice(0, 4000)}

Score this latest argument.`

  try {
    const text = await callCaptain(captain, JUDGE_SYSTEM, prompt)
    if (!text) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    const score = Math.max(0, Math.min(10, Number(parsed.score) || 0))
    return { model: currentModel, score, reason: String(parsed.reason ?? '') }
  } catch {
    return null
  }
}
