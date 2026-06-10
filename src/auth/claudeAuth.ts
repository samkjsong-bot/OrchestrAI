// src/auth/claudeAuth.ts
// Claude Agent SDK 경유로 로컬 Claude Code CLI 인증을 재사용.
// 더 이상 sk-ant-oat01- 토큰 입력 안 받음 (Anthropic이 3rd-party에 차단함).

import * as vscode from 'vscode'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, join } from 'path'
import { promisify } from 'util'
import { AuthStorage } from './storage'

const CLI_DETECTED_MARKER = '__cli_detected__'
const execFileAsync = promisify(execFile)

interface ClaudeCliStatus {
  loggedIn?: boolean
  authMethod?: string
  apiProvider?: string
  subscriptionType?: string
}

interface ClaudeCliCommand {
  file: string
  prefixArgs: string[]
  terminalLoginCommand: string
}

function quoteCmdPath(file: string): string {
  return `"${file.replace(/"/g, '""')}"`
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find(p => p && existsSync(p))
}

function findOnPath(names: string[]): string | undefined {
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    const hit = firstExisting(names.map(name => join(dir, name)))
    if (hit) return hit
  }
  return undefined
}

function resolveClaudeCli(): ClaudeCliCommand {
  if (process.platform === 'win32') {
    const npmDir = process.env.APPDATA
      ? join(process.env.APPDATA, 'npm')
      : process.env.USERPROFILE
        ? join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm')
        : ''
    const exe = firstExisting([
      npmDir ? join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe') : '',
      findOnPath(['claude.exe']) || '',
    ])
    if (exe) {
      const quoted = quoteCmdPath(exe)
      return {
        file: exe,
        prefixArgs: [],
        terminalLoginCommand: `cmd.exe /d /c "${quoted} auth login --claudeai"`,
      }
    }

    const cmd = firstExisting([
      npmDir ? join(npmDir, 'claude.cmd') : '',
      findOnPath(['claude.cmd']) || '',
    ])
    if (cmd) {
      const quoted = quoteCmdPath(cmd)
      return {
        file: process.env.ComSpec || 'cmd.exe',
        prefixArgs: ['/d', '/c', quoted],
        terminalLoginCommand: `cmd.exe /d /c "${quoted} auth login --claudeai"`,
      }
    }

    throw new Error('Claude CLI를 찾지 못했습니다. 터미널에서 `npm install -g @anthropic-ai/claude-code` 후 다시 시도해주세요.')
  }
  return { file: 'claude', prefixArgs: [], terminalLoginCommand: 'claude auth login --claudeai' }
}

function loginCommandHint(): string {
  try {
    return resolveClaudeCli().terminalLoginCommand
  } catch {
    return process.platform === 'win32'
      ? 'claude.cmd auth login --claudeai'
      : 'claude auth login --claudeai'
  }
}

function parseStatusJson(text: string): ClaudeCliStatus {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error(`Claude auth status 응답을 JSON으로 읽지 못했습니다: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text.slice(start, end + 1)) as ClaudeCliStatus
}

async function readClaudeCliStatus(): Promise<ClaudeCliStatus> {
  const { file, prefixArgs } = resolveClaudeCli()
  try {
    const { stdout, stderr } = await execFileAsync(file, [...prefixArgs, 'auth', 'status'], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000,
      windowsHide: true,
    })
    return parseStatusJson(`${stdout}\n${stderr}`.trim())
  } catch (err: any) {
    const output = String(err?.stderr || err?.stdout || err?.message || err).trim()
    if (/not recognized|is not recognized|ENOENT|not found/i.test(output)) {
      throw new Error(`Claude CLI를 실행하지 못했습니다. 터미널에서 "${loginCommandHint()}"를 확인해주세요.`)
    }
    throw new Error(output || 'Claude CLI 실행 실패')
  }
}

export class ClaudeAuth {
  constructor(private storage: AuthStorage) {}

  private async completeCliConnection(status: ClaudeCliStatus): Promise<boolean> {
    if (status.apiProvider && status.apiProvider !== 'firstParty') {
      const choice = await vscode.window.showWarningMessage(
        `Claude CLI가 구독 계정이 아닌 ${status.apiProvider} 인증으로 설정되어 있습니다. API 과금 경로일 수 있어요.\n` +
        `구독(Pro/Max) 쿼터로 쓰려면 "${loginCommandHint()}"로 다시 로그인해주세요.`,
        '그래도 계속',
      )
      if (choice !== '그래도 계속') return false
    }

    await this.storage.setClaudeTokens({ type: 'oauth', accessToken: CLI_DETECTED_MARKER })
    const plan = status.subscriptionType ? ` (${status.subscriptionType})` : ''
    vscode.window.showInformationMessage(`✅ Claude Code CLI 연결 완료!${plan}`)
    return true
  }

  private async startBrowserLogin(): Promise<boolean> {
    const terminal = vscode.window.createTerminal({ name: 'Claude Login' })
    terminal.show()
    terminal.sendText(loginCommandHint(), true)

    const done = await vscode.window.showInformationMessage(
      'Claude 브라우저 로그인을 완료한 뒤 "연결 확인"을 눌러주세요.',
      { modal: true },
      '연결 확인',
    )
    if (done !== '연결 확인') return false

    const status = await readClaudeCliStatus()
    if (!status.loggedIn) {
      vscode.window.showErrorMessage('Claude 로그인이 아직 완료되지 않았습니다. 브라우저 로그인 완료 후 다시 시도해주세요.')
      return false
    }
    return this.completeCliConnection(status)
  }

  // CLI가 설치·로그인되어 있는지 실제 모델 호출 없이 확인.
  async login(): Promise<boolean> {
    try {
      const status = await readClaudeCliStatus()

      if (!status.loggedIn) {
        return this.startBrowserLogin()
      }

      return this.completeCliConnection(status)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(
        `Claude 연결 실패: ${msg}\n` +
        `터미널에서 "claude.cmd --version" 및 "${loginCommandHint()}"를 확인해주세요.`,
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
