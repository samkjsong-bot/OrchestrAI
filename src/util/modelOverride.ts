// src/util/modelOverride.ts
// 사용자가 settings 에서 모델 변종 + thinking mode 강제하는 옵션을 provider 가 읽기 위한 헬퍼.
// auto 면 기존 effort→model 매핑 유지, 그 외엔 강제.

import * as vscode from 'vscode'
import type { Effort } from '../router/types'

export type ClaudeModelChoice = 'auto' | 'claude-sonnet-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5'
export type CodexModelChoice = 'auto' | 'gpt-5.4-mini' | 'gpt-5.4' | 'gpt-5.5'
export type GeminiModelChoice = 'auto' | 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-2.0-flash'
export type ThinkingChoice = 'auto' | 'off' | 'on' | 'extra'

function read<T extends string>(key: string, fallback: T): T {
  const v = vscode.workspace.getConfiguration('orchestrai').get<string>(key)
  return (v && v.length > 0 ? v : fallback) as T
}

export function getClaudeModelOverride(): ClaudeModelChoice {
  return read<ClaudeModelChoice>('claudeModel', 'auto')
}
export function getCodexModelOverride(): CodexModelChoice {
  return read<CodexModelChoice>('codexModel', 'auto')
}
export function getGeminiModelOverride(): GeminiModelChoice {
  return read<GeminiModelChoice>('geminiModel', 'auto')
}
export function getThinkingMode(): ThinkingChoice {
  return read<ThinkingChoice>('thinkingMode', 'auto')
}

// thinking budget 결정 — effort 기반 default 와 사용자 override 합침.
// 호출 측 (provider) 의 hardcoded MODEL_BY_EFFORT 와 같이 쓰임.
export function resolveThinkingBudget(
  effort: Effort,
  defaults: Record<Effort, number | undefined>,
  maxByModel: number,  // 모델 한도 (예: opus 64k, sonnet 32k)
): number | undefined {
  const mode = getThinkingMode()
  if (mode === 'off') return undefined
  if (mode === 'on') return Math.min(5000, maxByModel)
  if (mode === 'extra') return maxByModel
  // auto — effort 기반 default
  return defaults[effort]
}
