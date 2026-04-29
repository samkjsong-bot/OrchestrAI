// src/providers/codexMcpProvider.ts
// callCodex 드롭인 교체 — codex CLI mcp-server 통한 호출.
// 기존 codexProvider와 동일 시그니처. _runCodexAgent에서 setting에 따라 어느 쪽 부를지 분기.

import { Effort } from '../router/types'
import { getCodexMcpClient } from './codexMcpClient'

const MODEL_BY_EFFORT: Record<Effort, string | undefined> = {
  low: undefined,            // codex CLI default 사용 (보통 gpt-5.2)
  medium: undefined,
  high: 'gpt-5.2-codex',     // 코딩 특화 모델
  'extra-high': 'gpt-5.2-codex',
}

export async function callCodexNative(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  effort: Effort,
  cwd: string,
  onChunk: (text: string) => void,
  systemPrompt?: string,
  abortSignal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  if (abortSignal?.aborted) throw new Error('aborted')
  const client = getCodexMcpClient()
  if (!client.isAvailable()) {
    throw new Error('Codex CLI 바이너리를 찾을 수 없습니다 (Codex VSCode 확장 설치 필요).')
  }

  // messages를 단일 prompt로 평탄화. 마지막 user 메시지는 그대로, 나머지는 history로 합침.
  const last = messages[messages.length - 1]
  const prior = messages.slice(0, -1)
  const historyBlock = prior.length > 0
    ? prior.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\n---\n\n'
    : ''
  const prompt = historyBlock + (last?.content ?? '')

  const result = await client.run({
    prompt,
    cwd,
    baseInstructions: systemPrompt,
    model: MODEL_BY_EFFORT[effort],
    approvalPolicy: 'never',  // OrchestrAI에서 자동 모드 — codex가 자체 sandbox로 안전 보장
    onProgress: onChunk,
    abortSignal,
  })

  return result
}
