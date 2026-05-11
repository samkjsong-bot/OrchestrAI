// src/util/boomerang.ts
// 큰 작업 → 대장 모델이 sub-task 분할 plan → 각 sub-task 적합한 모델에 병렬 위임 → 결과 통합
// 단순 team mode와 차이: sub-task가 명시적으로 분할·병렬·통합. Roo Code의 boomerang task 패턴.

import * as vscode from 'vscode'
import { log } from './log'
import { type CaptainChoice, callCaptain } from './captain'

export interface SubTask {
  id: string
  title: string
  model: 'claude' | 'codex' | 'gemini'
  effort: 'low' | 'medium' | 'high'
  prompt: string         // 그 sub-task에 던질 prompt (구체적으로)
  dependsOn?: string[]   // 이 sub-task 시작 전 완료돼야 할 다른 sub-task id (직렬 처리용)
}

export interface BoomerangPlan {
  goal: string             // 사용자 원래 요청 한 줄 요약
  subTasks: SubTask[]
  parallelGroups: string[][]  // 같이 병렬로 돌릴 sub-task id 묶음 (의존성 따라)
}

const PLANNER_SYSTEM = `You are a planner. Given a user task, decompose into sub-tasks for parallel multi-model execution.

Models available:
- claude (sonnet-4-6): planning, architecture, deep refactoring, code review, reasoning
- codex (gpt-5): fast code implementation, file writes, scaffolding, terminal ops, bug fixes
- gemini (2.5-flash/pro): long-context analysis, summarization, web/doc lookup, multimodal

Rules:
1. 2-5 sub-tasks max. Don't over-decompose.
2. Mark dependencies if order matters (e.g. "design first, implement after").
3. Independent sub-tasks should run in parallel.
4. Each sub-task prompt should be CONCRETE (file paths, acceptance criteria).
5. Pick the best model per sub-task based on strengths above.

Output ONLY valid JSON, no markdown:
{
  "goal": "1-line summary of user goal",
  "subTasks": [
    {"id": "T1", "title": "...", "model": "claude", "effort": "high", "prompt": "...", "dependsOn": []},
    {"id": "T2", "title": "...", "model": "codex", "effort": "high", "prompt": "...", "dependsOn": ["T1"]}
  ]
}`

// 사용자 input → 분할 plan.
// 이전 대화 history 가 있으면 같이 전달 — plan 단계에서 컨텍스트 인지해야
// "완성했어?" 같은 follow-up 을 "Clarify user intent" 로 분해하는 사고 방지.
export async function planBoomerang(
  userInput: string,
  priorHistory?: Array<{ role: 'user' | 'assistant'; content: string; model?: string }>,
  captain: CaptainChoice = 'claude',
): Promise<BoomerangPlan | null> {
  if (captain === 'none') return null
  try {
    let priorBlock = ''
    if (priorHistory && priorHistory.length > 0) {
      const recent = priorHistory.slice(-6)
      priorBlock = '\n\n## Prior conversation (for context — do NOT re-do these tasks):\n' +
        recent.map(m => {
          const tag = m.role === 'user' ? 'User' : `Assistant${m.model ? `(${m.model})` : ''}`
          return `${tag}: ${m.content.slice(0, 800)}`
        }).join('\n\n')
    }

    const userPrompt = `User task: ${userInput}\n${priorBlock}\n\nDecompose into sub-tasks for the LATEST user task only. If the latest user input is a short follow-up question about prior work (e.g. "완성했어?", "잘 됐어?"), output {"goal":"answer follow-up","subTasks":[]} so caller skips boomerang. Output JSON only.`

    const text = await callCaptain(captain, PLANNER_SYSTEM, userPrompt)
    if (!text) return null
    // JSON 추출 (모델이 fenced block에 넣을 수도)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed.subTasks) || parsed.subTasks.length === 0) return null

    // 의존성 따라 parallelGroups 계산
    const subTasks: SubTask[] = parsed.subTasks
    const completed = new Set<string>()
    const parallelGroups: string[][] = []
    while (completed.size < subTasks.length) {
      const ready = subTasks.filter(t => !completed.has(t.id) && (t.dependsOn ?? []).every(d => completed.has(d)))
      if (ready.length === 0) {
        // 순환 의존성 있으면 남은 거 모두 한 그룹
        const remaining = subTasks.filter(t => !completed.has(t.id))
        parallelGroups.push(remaining.map(t => t.id))
        remaining.forEach(t => completed.add(t.id))
        break
      }
      parallelGroups.push(ready.map(t => t.id))
      ready.forEach(t => completed.add(t.id))
    }

    return {
      goal: String(parsed.goal ?? userInput.slice(0, 80)),
      subTasks,
      parallelGroups,
    }
  } catch (err) {
    log.warn('boomerang', 'plan failed:', err)
    return null
  }
}
