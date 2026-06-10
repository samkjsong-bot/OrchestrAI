// src/auth/geminiAuth.ts
// Gemini CLI의 OAuth 세션을 재사용. 유저는 'gemini' 명령어로 Google 로그인만 해두면 됨.

import { randomUUID } from 'crypto'
import * as vscode from 'vscode'
import { AuthStorage } from './storage'

const CLI_DETECTED_MARKER = '__cli_detected__'

// esbuild의 require() 치환 회피용 진짜 dynamic import
const esmImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>

function makeGeminiOAuthConfig(authType: any): any {
  const sessionId = randomUUID()
  const baseConfig: Record<string, any> = {
    getModel: () => 'gemini-3.1-flash-lite',
    getProxy: () => process.env.HTTP_PROXY || process.env.HTTPS_PROXY || undefined,
    getUsageStatisticsEnabled: () => false,
    getContentGeneratorConfig: () => ({
      authType,
      model: 'gemini-3.1-flash-lite',
      proxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY || undefined,
    }),
    getSessionId: () => sessionId,
    getDebugMode: () => false,
    getTelemetryEnabled: () => false,
    getTargetDir: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    getFullContext: () => false,
    getIdeMode: () => false,
    getCoreTools: () => [],
    getExcludeTools: () => [],
    getMaxSessionTurns: () => 100,
    getFileFilteringRespectGitIgnore: () => true,
    isBrowserLaunchSuppressed: () => false,
    getContextManager: () => undefined,
    getGlobalMemory: () => '',
    getEnvironmentMemory: () => '',
    getHookSystem: () => undefined,
    getModelAvailabilityService: () => undefined,
    getShellToolInactivityTimeout: () => 120000,
    getExperimentsAsync: () => Promise.resolve(undefined),
  }

  return new Proxy(baseConfig, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (typeof prop !== 'string') return undefined
      if (prop.startsWith('is') || prop.startsWith('has')) return () => false
      if (!prop.startsWith('get')) return undefined
      if (prop.includes('Enabled') || prop.includes('Mode')) return () => false
      if (prop.includes('Memory')) return () => ''
      if (prop.includes('Tools')) return () => []
      if (prop.includes('Timeout')) return () => 120000
      if (prop.includes('Config')) return () => ({})
      return () => undefined
    },
  })
}

export class GeminiAuth {
  constructor(private storage: AuthStorage) {}

  async login(): Promise<boolean> {
    try {
      const core = await esmImport('@google/gemini-cli-core')
      const authType = core.AuthType.LOGIN_WITH_GOOGLE
      vscode.window.showInformationMessage('Gemini Google 로그인을 브라우저에서 완료해주세요.')
      await core.getOauthClient(authType, makeGeminiOAuthConfig(authType))

      await this.storage.setGeminiTokens({ type: 'oauth', accessToken: CLI_DETECTED_MARKER })
      vscode.window.showInformationMessage('✅ Gemini OAuth 연결 완료!')
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(
        `Gemini 연결 실패: ${msg}\n` +
        `브라우저 로그인이 막히면 터미널에서 "npx @google/gemini-cli" 실행 후 Login with Google을 완료해주세요.`,
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
