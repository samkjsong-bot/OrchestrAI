// src/auth/codexAuth.ts
// Codex PKCE OAuth - 브라우저 띄워서 ChatGPT 계정으로 로그인

import * as vscode from 'vscode'
import * as http from 'http'
import * as crypto from 'crypto'
import { AuthStorage, CodexTokens } from './storage'

// OpenCode/OpenClaw에서 리버스 엔지니어링된 공개 client_id
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTH_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REDIRECT_PORT = 1455
const REDIRECT_PATH = '/auth/callback'
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`
const SCOPES = 'openid profile email offline_access'

// 5분 여유 두고 만료 체크
const REFRESH_BUFFER_MS = 5 * 60 * 1000

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')
  return { verifier, challenge }
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

function extractAccountId(accessToken: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString()
    )
    // OpenAI JWT에 accountId가 들어있는 claim 키
    return payload['https://api.openai.com/profile']?.id
      ?? payload.sub
      ?? ''
  } catch {
    return ''
  }
}

export class CodexAuth {
  constructor(private storage: AuthStorage) {}

  async login(): Promise<boolean> {
    const { verifier, challenge } = generatePKCE()
    const state = generateState()

    // Auth URL 생성 - 실제 Codex CLI가 보내는 파라미터와 동일해야 OpenAI가 허용
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    })

    const authUrl = `${AUTH_URL}?${params}`

    // 콜백 받을 로컬 서버 시작
    const codePromise = this._startCallbackServer(state)

    // 브라우저 열기
    await vscode.env.openExternal(vscode.Uri.parse(authUrl))
    vscode.window.showInformationMessage('브라우저에서 ChatGPT 계정으로 로그인해주세요...')

    let code: string
    try {
      code = await Promise.race([
        codePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 120_000)
        ),
      ])
    } catch (e: any) {
      if (e.message === 'timeout') {
        vscode.window.showErrorMessage('로그인 시간 초과 (2분). 다시 시도해주세요.')
      }
      return false
    }

    // 코드 → 토큰 교환
    const tokens = await this._exchangeCode(code, verifier)
    if (!tokens) {
      vscode.window.showErrorMessage('토큰 교환 실패. 다시 시도해주세요.')
      return false
    }

    await this.storage.setCodexTokens(tokens)
    vscode.window.showInformationMessage('✅ Codex (ChatGPT) 로그인 완료!')
    return true
  }

  async logout(): Promise<void> {
    await this.storage.deleteCodexTokens()
    vscode.window.showInformationMessage('Codex 로그아웃 완료')
  }

  // 유효한 access token 반환 (만료 시 자동 갱신)
  async getAccessToken(): Promise<string | null> {
    const tokens = await this.storage.getCodexTokens()
    if (!tokens) return null

    // 만료 임박 시 갱신
    if (Date.now() + REFRESH_BUFFER_MS >= tokens.expiresAt) {
      const refreshed = await this._refresh(tokens.refreshToken)
      if (!refreshed) return null
      await this.storage.setCodexTokens(refreshed)
      return refreshed.accessToken
    }

    return tokens.accessToken
  }

  async getAccountId(): Promise<string | null> {
    const tokens = await this.storage.getCodexTokens()
    return tokens?.accountId ?? null
  }

  async isLoggedIn(): Promise<boolean> {
    return !!(await this.storage.getCodexTokens())
  }

  // ── Private ──────────────────────────────────────────────────────

  private _startCallbackServer(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`)

        if (url.pathname !== REDIRECT_PATH) {
          res.writeHead(404)
          res.end()
          return
        }

        const returnedState = url.searchParams.get('state')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        // 성공 HTML
        const successHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
          <title>OrchestrAI</title>
          <style>body{font-family:sans-serif;background:#0d0d0f;color:#e8e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
          .box{text-align:center}.icon{font-size:48px}.title{font-size:20px;margin:16px 0}.sub{color:#6b6b80;font-size:14px}</style></head>
          <body><div class="box"><div class="icon">✅</div>
          <div class="title">로그인 완료!</div>
          <div class="sub">VSCode로 돌아가세요</div></div></body></html>`

        const errorHtml = (msg: string) => `<!DOCTYPE html><html><head><meta charset="utf-8">
          <title>OrchestrAI</title>
          <style>body{font-family:sans-serif;background:#0d0d0f;color:#e8e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
          .box{text-align:center}.icon{font-size:48px}.title{font-size:20px;margin:16px 0}.sub{color:#f87171;font-size:14px}</style></head>
          <body><div class="box"><div class="icon">❌</div>
          <div class="title">로그인 실패</div>
          <div class="sub">${msg}</div></div></body></html>`

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(errorHtml(error))
          server.close()
          reject(new Error(error))
          return
        }

        if (returnedState !== expectedState) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(errorHtml('state mismatch'))
          server.close()
          reject(new Error('state mismatch'))
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(successHtml)
        server.close()
        resolve(code!)
      })

      server.listen(REDIRECT_PORT, '127.0.0.1')
      server.on('error', reject)
    })
  }

  private async _exchangeCode(
    code: string,
    verifier: string
  ): Promise<CodexTokens | null> {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      })

      if (!res.ok) return null
      const data = await res.json() as any

      return {
        type: 'oauth',
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        accountId: extractAccountId(data.access_token),
      }
    } catch {
      return null
    }
  }

  private async _refresh(refreshToken: string): Promise<CodexTokens | null> {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      })

      if (!res.ok) return null
      const data = await res.json() as any

      return {
        type: 'oauth',
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
        accountId: extractAccountId(data.access_token),
      }
    } catch {
      return null
    }
  }
}
