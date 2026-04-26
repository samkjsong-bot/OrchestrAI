// src/router/llmRouter.ts
// 2단계: 패턴 매칭이 애매할 때만 호출. Haiku 같은 싼 모델로 intent 분석.
// Claude Agent SDK 경유 → 구독 쿼터 사용.

import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { RoutingDecision, RouterConfig } from './types'

const SYSTEM_PROMPT = `You are an AI request router. Analyze the user's coding request and return ONLY a JSON object.

Output format:
{"model":"claude"|"codex"|"gemini","effort":"low"|"medium"|"high","confidence":0.0-1.0,"reason":"one sentence"}

Routing rules:
- claude: architecture, multi-file refactoring, debugging complex issues, explaining concepts, code review, nuanced reasoning
- codex: fast implementation, terminal/CLI, simple bug fixes, boilerplate, well-specified tasks, quick code generation
- gemini: long-context tasks (large files, whole codebase scans), multimodal (images/PDFs/diagrams), summarization, fast lookups
- low effort: simple, single-line, clear spec
- medium effort: moderate complexity, some reasoning needed
- high effort: complex, ambiguous, multi-step reasoning

Return ONLY the JSON, no other text.`

function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}

export async function llmRoute(
  input: string,
  config: RouterConfig,
  fallback?: RoutingDecision,
): Promise<RoutingDecision> {
  try {
    const q = query({
      prompt: input,
      options: {
        model: config.metaModel,
        systemPrompt: SYSTEM_PROMPT,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        env: subscriptionEnv(),
      },
    })

    let responseText = ''
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') responseText += block.text
        }
      } else if (msg.type === 'result' && msg.is_error) {
        throw new Error(`router-error: ${msg.subtype}`)
      }
    }

    const parsed = JSON.parse(responseText.trim())
    return {
      model: parsed.model,
      effort: parsed.effort,
      confidence: parsed.confidence,
      reason: 'llm',
      ruleMatched: parsed.reason,
    }
  } catch {
    // LLM 라우터 실패 → 호출자가 준 폴백(패턴 결과) 우선, 없으면 기본값
    return fallback ?? {
      model: 'claude',
      effort: 'medium',
      confidence: 0.5,
      reason: 'fallback',
    }
  }
}
