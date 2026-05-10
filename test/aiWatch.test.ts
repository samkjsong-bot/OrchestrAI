// aiWatch.ts — 매직 코멘트 정규식 + cooldown 검증
// findAiMagic 만 실 파일 read 함 → tmp 파일 만들어서 검증

import { describe, expect, it, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { findAiMagic } from '../src/util/aiWatch'

function tmpFile(content: string, ext = '.ts'): string {
  const p = path.join(os.tmpdir(), `aiwatch-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  fs.writeFileSync(p, content, 'utf8')
  return p
}

describe('findAiMagic — 라인 주석 매직 코멘트', () => {
  it('// AI! 명령 매칭 (TS)', () => {
    const p = tmpFile(`function foo() {}\n// AI! refactor this to async\nfunction bar() {}\n`)
    const hit = findAiMagic(p)
    expect(hit).not.toBeNull()
    expect(hit?.kind).toBe('cmd')
    expect(hit?.instruction).toBe('refactor this to async')
    expect(hit?.line).toBe(2)
  })

  it('// AI? 질문 매칭', () => {
    const p = tmpFile(`function foo() {}\n// AI? what does this do\nfunction bar() {}\n`, '.js')
    const hit = findAiMagic(p)
    expect(hit?.kind).toBe('q')
    expect(hit?.instruction).toBe('what does this do')
  })

  it('# AI! 매칭 (Python)', () => {
    const p = tmpFile(`def foo(): pass\n# AI! add type hints\n`, '.py')
    const hit = findAiMagic(p)
    expect(hit?.kind).toBe('cmd')
    expect(hit?.instruction).toBe('add type hints')
  })

  it('-- AI! 매칭 (SQL/Lua)', () => {
    const p = tmpFile(`SELECT 1;\n-- AI! optimize this query\n`, '.sql')
    // sql 확장자는 watcher 가 다루지만 findAiMagic 자체는 모든 파일 시도. 패턴 매칭만 검증.
    const hit = findAiMagic(p)
    expect(hit?.instruction).toBe('optimize this query')
  })

  it('인라인 코드 뒤 주석에서도 매칭', () => {
    const p = tmpFile(`const x = 1; // AI! rename to userId\n`)
    const hit = findAiMagic(p)
    expect(hit?.instruction).toBe('rename to userId')
  })

  it('빈 instruction 은 매칭 안 함', () => {
    const p = tmpFile(`// AI!\n// AI?\n`)
    const hit = findAiMagic(p)
    expect(hit).toBeNull()
  })

  it('매직 토큰 없으면 null', () => {
    const p = tmpFile(`function foo() { return 42 }\n// just a comment\n`)
    expect(findAiMagic(p)).toBeNull()
  })

  it('읽을 수 없는 파일 → null (throw 안 함)', () => {
    expect(findAiMagic('/nonexistent/path/file.ts')).toBeNull()
  })

  it('매직 줄 주변 ±5 줄 컨텍스트 포함', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`)
    lines[9] = '// AI! do something'   // line 10
    const p = tmpFile(lines.join('\n'))
    const hit = findAiMagic(p)
    expect(hit?.line).toBe(10)
    expect(hit?.contextLines.length).toBeGreaterThanOrEqual(6)
    expect(hit?.contextLines.some(l => l.includes('AI!'))).toBe(true)
  })

  it('cooldown — 30초 안에 같은 위치 재트리거 안 함', () => {
    // 새 파일에 같은 instruction. cooldown key 는 path:line:instruction.
    const p = tmpFile(`// AI! same instruction\n`)
    const first = findAiMagic(p)
    expect(first).not.toBeNull()
    // 같은 파일 즉시 재호출 → null (cooldown)
    const second = findAiMagic(p)
    expect(second).toBeNull()
  })

  it('cooldown — 다른 instruction 이면 통과', () => {
    const p1 = tmpFile(`// AI! first\n`)
    const p2 = tmpFile(`// AI! second\n`)
    expect(findAiMagic(p1)).not.toBeNull()
    expect(findAiMagic(p2)).not.toBeNull()  // 다른 path 라 통과
  })

  it('500자 이상 긴 줄 (minified) 은 skip', () => {
    const longLine = '// AI! ' + 'x'.repeat(600)
    const p = tmpFile(longLine + '\n')
    // 패턴 자체엔 길이 제한 없지만 watcher 단계에서 length>500 skip — find 함수 자체는 매칭함.
    // 따라서 이 테스트는 findAiMagic 동작 그대로 — null 아님.
    // (만약 length 제한 추가하려면 module 수정 필요)
    const hit = findAiMagic(p)
    expect(hit).not.toBeNull()  // findAiMagic 단독으론 매칭. watcher 가 거름.
  })
})
