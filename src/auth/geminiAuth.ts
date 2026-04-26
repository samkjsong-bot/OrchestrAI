// src/auth/geminiAuth.ts
// Gemini CLI의 OAuth 세션을 재사용. 유저는 'gemini' 명령어로 Google 로그인만 해두면 됨.

import * as vscode from 'vscode'
import { AuthStorage } from './storage'

const CLI_DETECTED_MARKER = '__cli_detected__'

// esbuild의 require() 치환 회피용 진짜 dynamic import
const esmImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>

export class GeminiAuth {
  constructor(private storage: AuthStorage) {}

  async login(): Promise<boolean> {
    try {
      const [aiMod, geminiMod] = await Promise.all([
        esmImport('ai'),
        esmImport('ai-sdk-provider-gemini-cli'),
      ])
      const provider = geminiMod.createGeminiProvider({ authType: 'oauth-personal' })
      const result = aiMod.streamText({
        model: provider('gemini-2.5-flash'),
        prompt: 'ok',
      })

      let got = false
      for await (const chunk of result.textStream) {
        if (chunk) { got = true; break }
      }

      if (!got) {
        vscode.window.showErrorMessage('Gemini 응답 없음. "gemini" 명령어 설치·로그인 상태를 확인하세요.')
        return false
      }

      await this.storage.setGeminiTokens({ type: 'oauth', accessToken: CLI_DETECTED_MARKER })
      vscode.window.showInformationMessage('✅ Gemini CLI 연결 완료!')
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(
        `Gemini 연결 실패: ${msg}\n` +
        `터미널에서 "npm install -g @google/gemini-cli" 후 "gemini" 실행해서 구글 로그인 완료해주세요.`,
      )
      return false
    }
  }

  async logout(): Promise<void> {
    await this.storage.deleteGeminiTokens()
    vscode.window.showInformationMessage('Gemini 연결 해제 완료')
  }

  async isLoggedIn(): Promise<boolean> {
    return !!(await this.storage.getGeminiTokens())
  }
}
