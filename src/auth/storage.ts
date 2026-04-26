// src/auth/storage.ts
// VSCode SecretStorage에 토큰 저장 (평문 settings.json 대신)

import * as vscode from 'vscode'

export interface ClaudeTokens {
  type: 'oauth'
  accessToken: string  // sk-ant-oat01-... (setup-token 결과)
}

export interface CodexTokens {
  type: 'oauth'
  accessToken: string
  refreshToken: string
  expiresAt: number   // ms timestamp
  accountId: string
}

const KEYS = {
  claude: 'orchestrai.claude.tokens',
  codex: 'orchestrai.codex.tokens',
  gemini: 'orchestrai.gemini.tokens',
  geminiApiKey: 'orchestrai.gemini.apiKey',
  telegram: 'orchestrai.telegram.config',
}

export interface GeminiMarker {
  type: 'oauth'
  accessToken: string  // CLI 감지 마커
}

export interface TelegramConfig {
  token: string          // bot 토큰 (@BotFather 발급)
  chatId: string         // DM 모드면 본인 chat_id / topics 모드면 그룹 chat_id
  workspaceName: string  // 이 워크스페이스의 별칭 (`/list`에서 구분용)
  useTopics?: boolean    // true면 Forum Topics로 폴더별 분리된 스레드 자동 생성
}

export class AuthStorage {
  constructor(private secrets: vscode.SecretStorage) {}

  async getClaudeTokens(): Promise<ClaudeTokens | null> {
    const raw = await this.secrets.get(KEYS.claude)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  async setClaudeTokens(tokens: ClaudeTokens): Promise<void> {
    await this.secrets.store(KEYS.claude, JSON.stringify(tokens))
  }

  async getCodexTokens(): Promise<CodexTokens | null> {
    const raw = await this.secrets.get(KEYS.codex)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  async setCodexTokens(tokens: CodexTokens): Promise<void> {
    await this.secrets.store(KEYS.codex, JSON.stringify(tokens))
  }

  async deleteClaudeTokens(): Promise<void> {
    await this.secrets.delete(KEYS.claude)
  }

  async deleteCodexTokens(): Promise<void> {
    await this.secrets.delete(KEYS.codex)
  }

  async getGeminiTokens(): Promise<GeminiMarker | null> {
    const raw = await this.secrets.get(KEYS.gemini)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  async setGeminiTokens(tokens: GeminiMarker): Promise<void> {
    await this.secrets.store(KEYS.gemini, JSON.stringify(tokens))
  }

  async deleteGeminiTokens(): Promise<void> {
    await this.secrets.delete(KEYS.gemini)
  }

  async getGeminiApiKey(): Promise<string | null> {
    return (await this.secrets.get(KEYS.geminiApiKey)) ?? null
  }

  async setGeminiApiKey(key: string): Promise<void> {
    await this.secrets.store(KEYS.geminiApiKey, key)
  }

  async deleteGeminiApiKey(): Promise<void> {
    await this.secrets.delete(KEYS.geminiApiKey)
  }

  async getTelegramConfig(): Promise<TelegramConfig | null> {
    const raw = await this.secrets.get(KEYS.telegram)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  async setTelegramConfig(cfg: TelegramConfig): Promise<void> {
    await this.secrets.store(KEYS.telegram, JSON.stringify(cfg))
  }

  async deleteTelegramConfig(): Promise<void> {
    await this.secrets.delete(KEYS.telegram)
  }

  async clearAll(): Promise<void> {
    await this.secrets.delete(KEYS.claude)
    await this.secrets.delete(KEYS.codex)
    await this.secrets.delete(KEYS.gemini)
    await this.secrets.delete(KEYS.telegram)
  }

  async getStatus(): Promise<{ claude: boolean; codex: boolean; gemini: boolean }> {
    const [c, o, g] = await Promise.all([
      this.getClaudeTokens(),
      this.getCodexTokens(),
      this.getGeminiTokens(),
    ])
    return { claude: !!c, codex: !!o, gemini: !!g }
  }
}
