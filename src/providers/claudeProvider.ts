// src/providers/claudeProvider.ts
// Claude Agent SDK를 통해 로컬 Claude Code CLI 인증을 재사용 — Max 구독 쿼터.
// Claude도 Read/Edit/Write/Bash/Grep/Glob 툴 활성 → Codex·Gemini와 동일하게 코드 수정 가능.

import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Effort } from '../router/types'

// 코딩 작업이 많으니 Sonnet 4.6 default — 빠르고 정확. Opus는 풀스케일 reasoning만.
const MODEL_BY_EFFORT: Record<Effort, string> = {
  low: 'claude-sonnet-4-6',
  medium: 'claude-sonnet-4-6',
  high: 'claude-sonnet-4-6',         // high도 Sonnet — 코드 작업엔 Opus보다 빠르고 동등
  'extra-high': 'claude-opus-4-6',   // 풀스케일 프로젝트만 Opus (큰 그림 + 위임)
}

// thinking budget 확대 — 깊은 reasoning 활용
const THINKING_BUDGET: Record<Effort, number | undefined> = {
  low: undefined,                    // thinking 없음
  medium: 5000,                      // 옛 3000 → 5000
  high: 16000,                       // 옛 10000 → 16000 (코드 작업 깊이 ↑)
  'extra-high': 64000,               // 옛 32000 → 64000 (Opus 4.6 thinking 한도)
}

function modelForEffort(effort: Effort | string): string {
  return MODEL_BY_EFFORT[effort as Effort] ?? 'claude-sonnet-4-6'
}
function thinkingBudgetFor(effort: Effort | string): number | undefined {
  return THINKING_BUDGET[effort as Effort]
}

// 응답 출력 max tokens — 한 턴에 큰 프로그램 통째로 만들 수 있게 모두 모델 한계까지.
// Sonnet 4.6: 64k 한도, Opus 4.6: 32k 한도. SDK 기본(8192)이면 응답 잘림.
const MAX_OUTPUT: Record<Effort, number> = {
  low: 64000,           // 옛 16k → 64k (Sonnet 한도까지). 한 페이지 짜리도 잘림 없이.
  medium: 64000,        // 옛 32k → 64k
  high: 64000,
  'extra-high': 32000,  // Opus 한도
}
function maxOutputFor(effort: Effort | string): number {
  return MAX_OUTPUT[effort as Effort] ?? 32000
}

// OrchestrAI의 permission mode → Claude Agent SDK의 permissionMode로 매핑
export type ClaudePermissionMode = 'ask' | 'auto-edit' | 'plan' | 'smart-auto'
function sdkPermissionMode(m: ClaudePermissionMode): 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' {
  // plan 모드는 시스템 프롬프트에서 Claude에게 "plan.md 하나만 쓰고 끝내라"고 강하게 지시함 → acceptEdits로 써도 무방
  if (m === 'plan') return 'acceptEdits'
  // ask/auto/smart 전부 bypass — 확인 UI 없이 돌아가게. 'ask' 모드는 시스템 프롬프트에서 모델이 스스로 묻도록 유도
  return 'bypassPermissions'
}

function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}

// Claude tool_use 블록을 Claude Code CLI 스타일 한 줄로 표시.
// 토큰 추가 비용 0 — 모델 출력에 이미 있는 정보를 UI에 보기 좋게 다듬을 뿐.
// 파일 경로는 markdown 링크로 감싸서 클릭하면 VSCode가 열어줌 (webview의 orchestrai-open: 핸들러)
function fileLink(p: string): string {
  if (!p) return '?'
  const base = p.split(/[\\/]+/).filter(Boolean).pop() || p
  return `[${base}](orchestrai-open:${encodeURIComponent(p)})`
}
function formatToolCall(name: string, input: any): string {
  const trim = (s: any, n = 80) => {
    const str = String(s ?? '').replace(/\s+/g, ' ').trim()
    return str.length > n ? str.slice(0, n) + '…' : str
  }
  switch (name) {
    case 'Read':
      return `Read(${fileLink(input?.file_path ?? '?')}${input?.offset ? `:${input.offset}` : ''}${input?.limit ? `+${input.limit}` : ''})`
    case 'Write':       return `Write(${fileLink(input?.file_path ?? '?')})`
    case 'Edit':        return `Edit(${fileLink(input?.file_path ?? '?')})`
    case 'MultiEdit':   return `MultiEdit(${fileLink(input?.file_path ?? '?')} · ${input?.edits?.length ?? 0} edits)`
    case 'Bash':        return `Bash(${trim(input?.command, 100)})`
    case 'Grep':        return `Grep(${trim(input?.pattern, 60)}${input?.path ? ` in ${input.path}` : ''})`
    case 'Glob':        return `Glob(${trim(input?.pattern, 80)})`
    case 'WebFetch':    return `WebFetch(${trim(input?.url, 80)})`
    case 'WebSearch':   return `WebSearch(${trim(input?.query, 60)})`
    case 'TodoWrite':   return `TodoWrite(${input?.todos?.length ?? 0} items)`
    case 'Task':        return `Task(${trim(input?.description, 60)})`
    case 'NotebookEdit': return `NotebookEdit(${fileLink(input?.notebook_path ?? '?')})`
    default: {
      const argStr = input ? Object.entries(input).slice(0, 1).map(([k, v]) => `${k}=${trim(v, 40)}`).join(', ') : ''
      return `${name}${argStr ? `(${argStr})` : ''}`
    }
  }
}

export async function callClaude(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  effort: Effort,
  _apiKey: string,  // 무시: 로컬 CLI 인증 사용
  onChunk: (text: string) => void,
  systemPrompt?: string,
  permissionMode: ClaudePermissionMode = 'auto-edit',
  extraMcpServers?: Record<string, any>,  // team 모드 등에서 동료 호출 툴 주입용
  abortSignal?: AbortSignal,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const promptText = messages.length === 1
    ? messages[0].content
    : messages.map(m =>
        m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`
      ).join('\n\n')

  const q = query({
    prompt: promptText,
    options: {
      model: modelForEffort(effort),
      systemPrompt: systemPrompt ?? 'You are an expert coding assistant. Be concise and practical.',
      includePartialMessages: true,
      // 기본 Claude Code 툴셋 활성 — Read/Edit/Write/Bash/Grep/Glob 등 워크스페이스 조작 가능
      tools: { type: 'preset', preset: 'claude_code' },
      permissionMode: sdkPermissionMode(permissionMode),
      // bypassPermissions 쓰려면 반드시 true여야 함 (SDK 안전장치)
      allowDangerouslySkipPermissions: true,
      // team 모드면 동료 호출 툴 추가 주입
      ...(extraMcpServers ? { mcpServers: extraMcpServers } : {}),
      // 외부에서 abort 가능 (kill switch)
      ...(abortSignal ? { abortSignal } : {}),
      maxTurns: 100,         // 사실상 무제한 — 무한 루프 방지용 상한만
      persistSession: false,
      maxThinkingTokens: thinkingBudgetFor(effort),
      maxTokens: maxOutputFor(effort),  // 응답 잘림 방지 — SDK 기본 8192보다 크게
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      env: subscriptionEnv(),
    },
  })

  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0
  let apiKeySource: string | undefined

  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      apiKeySource = msg.apiKeySource
      if (apiKeySource === 'env') {
        throw new Error(
          'ANTHROPIC_API_KEY 환경변수가 감지되어 API 과금 경로로 빠졌습니다. ' +
          '환경변수 제거 후 재시도하세요 (구독 쿼터 사용을 위해).'
        )
      }
    } else if (msg.type === 'stream_event') {
      const ev = msg.event
      if (
        ev.type === 'content_block_delta' &&
        ev.delta.type === 'text_delta'
      ) {
        const text = ev.delta.text
        if (text) {
          fullContent += text
          onChunk(text)
        }
      }
    } else if (msg.type === 'assistant') {
      // tool_use 블록을 Claude Code CLI 스타일 한 줄로 표시 (Read(path), Bash(cmd) 등)
      for (const block of msg.message.content) {
        if ((block as any).type === 'tool_use') {
          const tu = block as { name?: string; input?: any }
          onChunk(`\n\n  ⏺ ${formatToolCall(tu.name ?? 'unknown', tu.input)}\n`)
        }
      }
    } else if (msg.type === 'result') {
      if (msg.usage) {
        inputTokens = msg.usage.input_tokens ?? 0
        outputTokens = msg.usage.output_tokens ?? 0
      }
      if (msg.is_error) {
        const detail = msg.subtype === 'error_during_execution'
          ? (msg.errors?.[0] ?? 'unknown')
          : msg.subtype
        throw new Error(`Claude 응답 실패: ${detail}`)
      }
    }
  }

  // Claude Max 5-hour limit 도달 시 SDK가 정상 result로 끝내면서 텍스트로 안내문 줌.
  // is_error=false 이지만 실제로는 quota 파산 → throw해서 폴백 트리거
  const QUOTA_PATTERNS = [
    /usage limit reached/i,
    /your limit will reset/i,
    /5-hour limit/i,
    /usage_limit_exceeded/i,
    /rate.limit reached/i,
    /quota.{0,30}exceeded/i,
    /Claude.{0,30}usage limit/i,
    /제한.{0,10}도달|쿼터.{0,10}소진|사용량.{0,10}한도/,
  ]
  if (QUOTA_PATTERNS.some(re => re.test(fullContent))) {
    throw new Error(`rate_limit reached: ${fullContent.slice(0, 200)}`)
  }

  return { content: fullContent, inputTokens, outputTokens }
}
