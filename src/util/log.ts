// src/util/log.ts
// VSCode OutputChannel 로거. 하단 Output 탭에서 "OrchestrAI" 선택하면 보임.

import * as vscode from 'vscode'

let channel: vscode.OutputChannel | null = null

function ch(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('OrchestrAI')
  return channel
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

export const log = {
  info(tag: string, ...args: unknown[]) {
    ch().appendLine(`[${stamp()}] [${tag}] ${args.map(serialize).join(' ')}`)
  },
  warn(tag: string, ...args: unknown[]) {
    ch().appendLine(`[${stamp()}] [WARN ${tag}] ${args.map(serialize).join(' ')}`)
  },
  error(tag: string, ...args: unknown[]) {
    ch().appendLine(`[${stamp()}] [ERROR ${tag}] ${args.map(serialize).join(' ')}`)
  },
  show() {
    ch().show(true)
  },
}

function serialize(v: unknown): string {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}
