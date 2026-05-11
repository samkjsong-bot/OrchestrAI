// src/util/commitMessage.ts
// 자동 git commit 메시지를 staged diff 기반으로 대장 모델이 생성.
// 실패 시 fallback subject 로 떨어지므로 호출 측에서 throw 받지 않음 — null 만 받음.

import { spawn } from 'child_process'
import { record as perfRecord } from './perf'
import { callCaptain, type CaptainChoice } from './captain'

const SYSTEM = `You write concise, conventional git commit messages from a staged diff.

Rules:
- ONE line subject (≤72 chars), present tense, imperative ("add X" not "added X")
- No trailing period
- Match the language used by the diff hunks (Korean if comments/strings are Korean)
- If multiple unrelated changes, pick the dominant one — don't list everything
- No emoji, no Conventional Commits prefix unless the repo clearly uses them already

Return ONLY the subject line — nothing else, no quotes, no markdown.`

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
  captain: CaptainChoice = 'claude',
): Promise<string | null> {
  if (captain === 'none') return null
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

    const text = await callCaptain(captain, SYSTEM, prompt)
    if (!text) return null

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
