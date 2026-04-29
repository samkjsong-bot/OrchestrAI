// src/router/types.ts

export type Model = 'claude' | 'codex' | 'gemini'
export type Effort = 'low' | 'medium' | 'high' | 'extra-high'
// auto: 라우터 판단 / claude·codex·gemini: 강제 / argue: 라운드로빈 토론 / team: 순차 협업 / loop: Ralph Wiggum 반복(될 때까지)
export type RouterMode = 'auto' | 'claude' | 'codex' | 'gemini' | 'argue' | 'team' | 'loop'

export interface RoutingDecision {
  model: Model
  effort: Effort
  reason: string       // 'pattern' | 'llm' | 'override'
  confidence: number   // 0~1
  ruleMatched?: string // 어떤 패턴이 매칭됐는지 (디버깅용)
  actualModel?: string
}

export interface ChangeSummary {
  turnId: string
  files: number
  additions: number
  deletions: number
  paths: string[]
}

export interface RouterConfig {
  confidenceThreshold: number  // 이 값 이상이면 LLM 라우터 스킵
  metaModel: string
  anthropicApiKey: string
  openaiApiKey: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: Array<{
    name: string
    mime: string
    dataUrl: string
  }>
  model?: Model
  effort?: Effort
  actualModel?: string
  changeSummary?: ChangeSummary
  tokens?: number
  routing?: RoutingDecision
  timestamp: number
}
