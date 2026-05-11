// src/router/types.ts

export type Model = 'claude' | 'codex' | 'gemini'
export type Effort = 'low' | 'medium' | 'high' | 'extra-high'
// auto / 모델 강제 / argue 토론 / team 협업 / loop 반복 / boomerang 자동 분할·병렬·통합
export type RouterMode = 'auto' | 'claude' | 'codex' | 'gemini' | 'argue' | 'team' | 'loop' | 'boomerang'

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
  commitHash?: string         // 자동 git commit 후 hash (이 턴 → 그 commit 으로 revert 가능)
  commitShort?: string        // 사용자 표시용 7자
  commitMessage?: string      // Haiku 가 생성한 의미 있는 commit subject (UX chip 노출용)
  verdict?: { score: number; reason: string }  // argue 모드에서 Haiku 가 매긴 점수 (rehydrate 보존용)
}
