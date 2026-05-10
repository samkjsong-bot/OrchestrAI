// src/util/commitMessage.ts
// 자동 git commit 메시지를 staged diff 기반으로 Haiku 가 생성.
// 실패 시 generic fallback 으로 떨어지므로 호출 측에서 throw 받지 않음 — null 만 받음.

import * as vscode from 'vscode'
import { spawn } from 'child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { record as perfRecord } from './perf'

const SYSTEM = `You write concise, conventional git commit messages from a staged diff.

Rules:
- ONE line subject (≤72 chars), present tense, imperative ("add X" not "added X")
- No trailing period
- Match the language used by the diff hunks (Korean if comments/strings are Korean)
- If multiple unrelated changes, pick the dominant one — don't list everything
- No emoji, no Conventional Commits prefix unless the repo clearly uses them already

Return ONLY the subject line — nothing else, no quotes, no markdown.`

function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  return env
}

function runGit(args: string[], cwd: string, timeoutMs = 5000): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn('git', args, { cwd })
    let stdout = ''
    const timer = setTimeout(() => { try { p.kill() } catch {} }, timeoutMs)
    p.stdout.on('data', (c: Buffer) => stdout += c.toString('utf8'))
    p.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, code: code ?? 1 }) })
    p.on('error', () => { clearTimeout(timer); resolve({ stdout: '', code: 1 }) })
  })
}

// staged diff 를 잘라서 모델한테 줌 — 너무 크면 truncate (cost 보호 + 빠른 응답)
const MAX_DIFF_CHARS = 12000

export async function generateCommitMessage(
  cwd: string,
  fallbackSubject: string,
): Promise<string | null> {
  const t0 = performance.now()
  try {
    // staged diff 만 — 자동 commit 은 우리가 직접 add 한 것만 stage 되어 있음
    const diff = await runGit(['diff', '--cached', '--no-color', '--stat=200', '--patch'], cwd, 4000)
    if (diff.code !== 0 || !diff.stdout.trim()) return null

    const truncated = diff.stdout.length > MAX_DIFF_CHARS
      ? diff.stdout.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated ...]'
      : diff.stdout

    const prompt = `## Staged diff
\`\`\`diff
${truncated}
\`\`\`

## Fallback subject (use only if diff genuinely unclear)
${fallbackSubject}

Write the commit subject line.`

    const q = query({
      prompt,
      options: {
        model: 'claude-haiku-4-5',
        systemPrompt: SYSTEM,
        tools: [],
        maxTurns: 1,
        persistSession: false,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? cwd,
        env: subscriptionEnv(),
      },
    })

    let text = ''
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') text += block.text
        }
      }
    }

    // 모델이 따옴표로 감쌌거나 마침표 붙였을 때 정리
    const subject = text
      .trim()
      .split('\n')[0]
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\.+$/, '')
      .slice(0, 72)

    if (!subject) return null
    perfRecord('generateCommitMessage', performance.now() - t0)
    return subject
  } catch {
    return null
  }
}
