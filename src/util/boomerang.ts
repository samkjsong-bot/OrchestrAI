// src/util/boomerang.ts
// 큰 작업 → Claude(Haiku 또는 Sonnet)가 sub-task 분할 plan → 각 sub-task 적합한 모델에 병렬 위임 → 결과 통합
// 단순 team mode와 차이: sub-task가 명시적으로 분할·병렬·통합. Roo Code의 boomerang task 패턴.

import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { log } from './log'

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

function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}

// 사용자 input → 분할 plan
export async function planBoomerang(userInput: string): Promise<BoomerangPlan | null> {
  try {
    const q = query({
      prompt: `User task: ${userInput}\n\nDecompose into sub-tasks. Output JSON only.`,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt: PLANNER_SYSTEM,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        env: subscriptionEnv(),
      },
    })
    let text = ''
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'text') text += b.text
        }
      }
    }
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
