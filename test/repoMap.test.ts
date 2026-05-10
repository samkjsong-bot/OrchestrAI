// repoMap.ts — symbol 추출 + query 매칭 검증

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { buildRepoMap, findRelevantSymbols, formatSymbolBlock } from '../src/util/repoMap'

function tmpDir(): string {
  const d = path.join(os.tmpdir(), `repomap-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

function write(dir: string, rel: string, content: string) {
  const full = path.join(dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

describe('buildRepoMap — 언어별 symbol 추출', () => {
  it('TypeScript: class / interface / function / type', async () => {
    const dir = tmpDir()
    write(dir, 'src/foo.ts', `
export class UserService {
  getUser() { return null }
}
export interface User { id: string }
export type UserId = string
export function fetchUser(id: string) { return null }
const helper = async () => 42
    `.trim())
    const storage = tmpDir()
    const map = await buildRepoMap(dir, storage)
    const names = Object.keys(map.symbolsByName)
    expect(names).toContain('userservice')
    expect(names).toContain('user')
    expect(names).toContain('userid')
    expect(names).toContain('fetchuser')
    expect(names).toContain('helper')
  })

  it('Python: class + def + async def', async () => {
    const dir = tmpDir()
    write(dir, 'pkg/foo.py', `
class UserService:
    def get_user(self):
        pass
    async def fetch_user(self, id):
        pass

def standalone():
    pass
    `.trim())
    const map = await buildRepoMap(dir, tmpDir())
    expect(map.symbolsByName).toHaveProperty('userservice')
    expect(map.symbolsByName).toHaveProperty('get_user')
    expect(map.symbolsByName).toHaveProperty('fetch_user')
    expect(map.symbolsByName).toHaveProperty('standalone')
  })

  it('Go: func + type struct', async () => {
    const dir = tmpDir()
    write(dir, 'main.go', `
package main

type Server struct {
  Port int
}

func (s *Server) Start() {}
func NewServer() *Server { return nil }
    `.trim())
    const map = await buildRepoMap(dir, tmpDir())
    expect(map.symbolsByName).toHaveProperty('server')
    expect(map.symbolsByName).toHaveProperty('start')
    expect(map.symbolsByName).toHaveProperty('newserver')
  })

  it('Rust: fn / struct / trait', async () => {
    const dir = tmpDir()
    write(dir, 'src/lib.rs', `
pub struct Config {
    pub port: u16,
}

pub trait Renderer {
    fn render(&self);
}

pub fn build_config() -> Config { Config { port: 8080 } }
    `.trim())
    const map = await buildRepoMap(dir, tmpDir())
    expect(map.symbolsByName).toHaveProperty('config')
    expect(map.symbolsByName).toHaveProperty('renderer')
    expect(map.symbolsByName).toHaveProperty('build_config')
  })

  it('reserved 키워드는 symbol 로 안 잡음', async () => {
    const dir = tmpDir()
    write(dir, 'a.ts', `function class() {}\nfunction return() {}\n`)
    const map = await buildRepoMap(dir, tmpDir())
    // class/return 은 RESERVED 셋에 있으므로 그냥 skip 됨 (regex 캡처는 됐지만 push 안 됨)
    expect(map.symbolsByName).not.toHaveProperty('class')
    expect(map.symbolsByName).not.toHaveProperty('return')
  })

  it('node_modules / .git / dist 등 EXCLUDE_DIRS 는 스캔 안 함', async () => {
    const dir = tmpDir()
    write(dir, 'src/app.ts', 'export function appFn() {}')
    write(dir, 'node_modules/lib/index.ts', 'export function libFn() {}')
    write(dir, 'dist/bundle.js', 'function bundleFn() {}')
    const map = await buildRepoMap(dir, tmpDir())
    expect(map.symbolsByName).toHaveProperty('appfn')
    expect(map.symbolsByName).not.toHaveProperty('libfn')
    expect(map.symbolsByName).not.toHaveProperty('bundlefn')
  })
})

describe('findRelevantSymbols — query 안 식별자 매칭', () => {
  it('CamelCase 식별자 매칭', async () => {
    const dir = tmpDir()
    write(dir, 'a.ts', `export class UserService {}\nexport function compute() {}\n`)
    const map = await buildRepoMap(dir, tmpDir())
    const hits = findRelevantSymbols('Where is UserService defined?', map)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].name).toBe('UserService')
  })

  it('snake_case 매칭', async () => {
    const dir = tmpDir()
    write(dir, 'a.py', `def fetch_user(): pass\n`)
    const map = await buildRepoMap(dir, tmpDir())
    const hits = findRelevantSymbols('explain fetch_user', map)
    expect(hits.length).toBe(1)
    expect(hits[0].name).toBe('fetch_user')
  })

  it('관련 없는 query 는 빈 결과', async () => {
    const dir = tmpDir()
    write(dir, 'a.ts', `export function foo() {}\n`)
    const map = await buildRepoMap(dir, tmpDir())
    const hits = findRelevantSymbols('what is the weather today?', map)
    expect(hits).toEqual([])
  })

  it('한국어 query 안 식별자도 매칭', async () => {
    const dir = tmpDir()
    write(dir, 'a.ts', `export function calculateTotal() {}\n`)
    const map = await buildRepoMap(dir, tmpDir())
    const hits = findRelevantSymbols('calculateTotal 함수 어디 있어?', map)
    expect(hits.length).toBe(1)
  })

  it('limit 적용', async () => {
    const dir = tmpDir()
    let code = ''
    for (let i = 0; i < 20; i++) code += `export function fn${i}() {}\n`
    write(dir, 'a.ts', code)
    const map = await buildRepoMap(dir, tmpDir())
    const allTokens = Array.from({ length: 20 }, (_, i) => `fn${i}`).join(' ')
    const hits = findRelevantSymbols(allTokens, map, 5)
    expect(hits.length).toBe(5)
  })
})

describe('formatSymbolBlock', () => {
  it('빈 배열 → 빈 문자열', () => {
    expect(formatSymbolBlock([])).toBe('')
  })

  it('파일별 그룹핑', () => {
    const block = formatSymbolBlock([
      { name: 'foo', kind: 'function', file: 'a.ts', line: 1, signature: 'function foo() {}' },
      { name: 'bar', kind: 'function', file: 'a.ts', line: 5, signature: 'function bar() {}' },
      { name: 'Baz', kind: 'class',    file: 'b.ts', line: 1, signature: 'class Baz {}' },
    ])
    expect(block).toContain('a.ts')
    expect(block).toContain('b.ts')
    expect(block).toContain('foo')
    expect(block).toContain('Baz')
  })
})
