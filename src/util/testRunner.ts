// src/util/testRunner.ts
// loop 모드에서 매 iteration 후 자동으로 테스트 돌려서 실패 메시지를 다음 prompt 에 주입.
// Aider 의 시그니처 패턴 ("until tests pass") 의 우리 버전.

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface TestRunResult {
  ran: boolean              // 실제로 테스트가 실행됐는지 (없으면 false)
  passed: boolean           // 통과 여부 (ran=false 면 의미 없음)
  command: string
  durationMs: number
  output: string            // stdout + stderr 합본 (truncate 후)
  failureSummary: string    // 모델한테 줄 짧은 요약 (실패 줄들만)
}

const MAX_OUTPUT_CHARS = 6000

// package.json scripts.test 또는 pytest/cargo test 감지.
// 발견 못 하면 ran=false 로 종료 — loop 는 일반 모드처럼 동작.
export function detectTestCommand(cwd: string): { cmd: string; args: string[] } | null {
  const pkgPath = path.join(cwd, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        // npm test 가 가장 안전 — 사용자가 정의한 그대로 실행됨
        return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test', '--silent'] }
      }
    } catch {}
  }
  // python pytest
  if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    return { cmd: process.platform === 'win32' ? 'pytest.exe' : 'pytest', args: ['-x', '--tb=short', '-q'] }
  }
  // cargo
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    return { cmd: 'cargo', args: ['test', '--quiet'] }
  }
  // go
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    return { cmd: 'go', args: ['test', './...'] }
  }
  return null
}

export async function runTests(cwd: string, timeoutMs = 120_000): Promise<TestRunResult> {
  const detected = detectTestCommand(cwd)
  if (!detected) {
    return { ran: false, passed: false, command: '', durationMs: 0, output: '', failureSummary: '' }
  }
  const { cmd, args } = detected
  const t0 = Date.now()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: false,
    })

    const timer = setTimeout(() => {
      killed = true
      try { proc.kill('SIGKILL') } catch {}
    }, timeoutMs)

    proc.stdout.on('data', (c: Buffer) => stdout += c.toString('utf8'))
    proc.stderr.on('data', (c: Buffer) => stderr += c.toString('utf8'))
    proc.on('error', () => {
      clearTimeout(timer)
      resolve({ ran: false, passed: false, command: `${cmd} ${args.join(' ')}`, durationMs: Date.now() - t0, output: '', failureSummary: '' })
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      const combined = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim()
      const truncated = combined.length > MAX_OUTPUT_CHARS
        ? combined.slice(-MAX_OUTPUT_CHARS) + '\n[...output truncated, last ' + MAX_OUTPUT_CHARS + ' chars shown]'
        : combined
      const passed = !killed && code === 0
      resolve({
        ran: true,
        passed,
        command: `${cmd} ${args.join(' ')}`,
        durationMs: Date.now() - t0,
        output: truncated,
        failureSummary: passed ? '' : extractFailureSummary(combined),
      })
    })
  })
}

// vitest / jest / pytest 등 흔한 출력에서 실패 줄들만 뽑음.
// 실패 못 잡으면 마지막 60줄 그대로 fallback.
export function extractFailureSummary(output: string): string {
  const lines = output.split('\n')

  // vitest / jest 패턴
  const vitestFails = lines.filter(l =>
    /^\s*(FAIL|✗|×)\s/.test(l) ||
    /^\s*Tests:\s+\d+ failed/.test(l) ||
    /^\s*Error:/.test(l) ||
    /AssertionError/.test(l),
  )
  if (vitestFails.length > 0 && vitestFails.length < 50) {
    return vitestFails.join('\n')
  }

  // pytest 패턴
  const pytestFails = lines.filter(l =>
    /FAILED\s/.test(l) ||
    /^\s*E\s+/.test(l) ||
    /^=+ FAILURES =+$/.test(l),
  )
  if (pytestFails.length > 0 && pytestFails.length < 50) {
    return pytestFails.join('\n')
  }

  // fallback — 마지막 60줄
  return lines.slice(-60).join('\n')
}
