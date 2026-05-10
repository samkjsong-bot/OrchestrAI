// testRunner.ts — 테스트 명령 감지 + 실패 출력 파싱

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { detectTestCommand, extractFailureSummary } from '../src/util/testRunner'

function tmpDir(): string {
  const d = path.join(os.tmpdir(), `tr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

describe('detectTestCommand', () => {
  it('package.json scripts.test 있으면 npm test', () => {
    const d = tmpDir()
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const res = detectTestCommand(d)
    expect(res?.cmd).toMatch(/^npm/)
    expect(res?.args).toEqual(['test', '--silent'])
  })

  it('package.json 의 default placeholder test 는 무시', () => {
    const d = tmpDir()
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    }))
    expect(detectTestCommand(d)).toBeNull()
  })

  it('pytest.ini 있으면 pytest', () => {
    const d = tmpDir()
    fs.writeFileSync(path.join(d, 'pytest.ini'), '[pytest]\n')
    const res = detectTestCommand(d)
    expect(res?.cmd).toMatch(/pytest/)
    expect(res?.args).toContain('-x')
  })

  it('pyproject.toml 있으면 pytest', () => {
    const d = tmpDir()
    fs.writeFileSync(path.join(d, 'pyproject.toml'), '[tool.pytest.ini_options]\n')
    const res = detectTestCommand(d)
    expect(res?.cmd).toMatch(/pytest/)
  })

  it('Cargo.toml 있으면 cargo test', () => {
    const d = tmpDir()
    fs.writeFileSync(path.join(d, 'Cargo.toml'), '[package]\nname = "x"\n')
    const res = detectTestCommand(d)
    expect(res?.cmd).toBe('cargo')
    expect(res?.args).toContain('test')
  })

  it('go.mod 있으면 go test', () => {
    const d = tmpDir()
    fs.writeFileSync(path.join(d, 'go.mod'), 'module x\n')
    const res = detectTestCommand(d)
    expect(res?.cmd).toBe('go')
    expect(res?.args).toEqual(['test', './...'])
  })

  it('아무것도 없으면 null', () => {
    const d = tmpDir()
    expect(detectTestCommand(d)).toBeNull()
  })
})

describe('extractFailureSummary', () => {
  it('vitest FAIL 라인만 추출', () => {
    const out = `
RUN v1.0.0
 ✓ src/foo.test.ts (2)
 FAIL src/bar.test.ts > should work
 AssertionError: expected 1 to be 2
   at test/bar.test.ts:5:10
 ✓ src/baz.test.ts (1)
Tests: 1 failed, 3 passed
    `.trim()
    const summary = extractFailureSummary(out)
    expect(summary).toContain('FAIL')
    expect(summary).toContain('AssertionError')
    expect(summary).not.toContain('✓')
  })

  it('pytest FAILED 패턴', () => {
    const out = `
test_foo.py::test_one PASSED
test_foo.py::test_two FAILED
=================================== FAILURES ===================================
__________________________________ test_two ___________________________________

    def test_two():
>       assert 1 == 2
E       assert 1 == 2

test_foo.py:5: AssertionError
    `.trim()
    const summary = extractFailureSummary(out)
    expect(summary).toContain('FAILED')
    expect(summary).toMatch(/E\s+assert/)
  })

  it('패턴 매칭 안 되면 마지막 60줄 fallback', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`)
    const out = lines.join('\n')
    const summary = extractFailureSummary(out)
    const summaryLines = summary.split('\n')
    expect(summaryLines.length).toBeLessThanOrEqual(60)
    expect(summaryLines[summaryLines.length - 1]).toBe('line99')
  })
})
