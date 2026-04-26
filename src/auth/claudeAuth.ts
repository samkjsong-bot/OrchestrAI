// src/auth/claudeAuth.ts
// Claude Agent SDK 경유로 로컬 Claude Code CLI 인증을 재사용.
// 더 이상 sk-ant-oat01- 토큰 입력 안 받음 (Anthropic이 3rd-party에 차단함).

import * as vscode from 'vscode'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { AuthStorage } from './storage'

const CLI_DETECTED_MARKER = '__cli_detected__'

function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}

export class ClaudeAuth {
  constructor(private storage: AuthStorage) {}

  // CLI가 설치·로그인되어 있는지 가벼운 system init 메시지로 확인
  async login(): Promise<boolean> {
    try {
      const q = query({
        prompt: 'ok',
        options: {
          model: 'claude-haiku-4-5',
          tools: [],
          maxTurns: 1,
          persistSession: false,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
          env: subscriptionEnv(),
        },
      })

      let apiKeySource: string | undefined
      let completed = false
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          apiKeySource = msg.apiKeySource
        }
        if (msg.type === 'result') {
          completed = true
          if (msg.is_error) {
            throw new Error(`CLI 에러: ${msg.subtype}`)
          }
          break
        }
      }

      if (!completed) {
        vscode.window.showErrorMessage('Claude Code CLI 응답 없음. 설치·로그인 상태 확인하세요.')
        return false
      }

      if (apiKeySource === 'env') {
        const choice = await vscode.window.showWarningMessage(
          'ANTHROPIC_API_KEY 환경변수가 감지됐어요. 이 상태로는 API 과금이 발생합니다.\n' +
          '구독(Max/Pro) 쿼터로 쓰려면 환경변수 제거 후 다시 시도해주세요.',
          '그래도 계속(API 과금 감수)',
        )
        if (choice !== '그래도 계속(API 과금 감수)') return false
      }

      await this.storage.setClaudeTokens({ type: 'oauth', accessToken: CLI_DETECTED_MARKER })
      vscode.window.showInformationMessage('✅ Claude Code CLI 연결 완료!')
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(
        `Claude 연결 실패: ${msg}\n` +
        `터미널에서 "claude" 명령어가 있는지, "claude /login" 되어있는지 확인해주세요.`,
      )
      return false
    }
  }

  async logout(): Promise<void> {
    await this.storage.deleteClaudeTokens()
    vscode.window.showInformationMessage('Claude 연결 해제 완료')
  }

  // 과거 API 키 기반 코드와의 호환용. 내용은 마커일 뿐이고 실제 인증은 SDK가 처리
  async getAccessToken(): Promise<string | null> {
    const tokens = await this.storage.getClaudeTokens()
    return tokens?.accessToken ?? null
  }

  async isLoggedIn(): Promise<boolean> {
    return !!(await this.storage.getClaudeTokens())
  }
}
