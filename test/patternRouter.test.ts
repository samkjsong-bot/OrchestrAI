// patternRouter + inferEffort 회귀 테스트
// 실행: npm test (vitest 자동 인식)

import { describe, expect, it } from 'vitest'
import { patternRoute } from '../src/router/patternRouter'
import { inferEffort } from '../src/router/orchestrator'

describe('inferEffort — 풀스케일 빌드', () => {
  it.each([
    ['좀비 서바이벌 게임 만들어줘'],
    ['todo 앱 만들어줘'],
    ['React로 포트폴리오 사이트 좀 만들어'],
    ['Build a complete chess game in React'],
    ['Build a polished blog with comments'],
    ['Implement a full authentication system'],
  ])('"%s" → extra-high', (text) => {
    expect(inferEffort(text)).toBe('extra-high')
  })
})

describe('inferEffort — 코드 작업 (high)', () => {
  it.each([
    ['sum 함수 추가해줘'],
    ['이 버그 고쳐줘'],
    ['Header 컴포넌트 만들어'],
    ['리팩토링 해줘'],
    ['아키텍처 어떻게 가야'],
    ['debug this issue'],
    ['보안 감사 해줘'],
  ])('"%s" → high', (text) => {
    expect(inferEffort(text)).toBe('high')
  })
})

describe('inferEffort — 단순/짧은 (low)', () => {
  it.each([
    ['git rebase 하는 법'],
    ['npm install react'],
    ['typo 고쳐'],
    ['요약'],
    ['quick summary'],
  ])('"%s" → low', (text) => {
    expect(inferEffort(text)).toBe('low')
  })
})

describe('patternRoute — 풀스케일 빌드 (claude/extra-high)', () => {
  it.each([
    '게임 만들어줘',
    '앱 좀 만들어줘',
    '웹사이트 하나 짜줘',
    'Build a complete chess game',
    'Create a polished blog',
  ])('"%s" → claude/extra-high', (text) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('claude')
    expect(r?.effort).toBe('extra-high')
  })
})

describe('patternRoute — 설계/리뷰 (claude/high)', () => {
  it.each([
    ['아키텍처 어떻게 가야', 'architecture'],
    ['리팩토링 해줘', 'refactor'],
    ['이 PR 리뷰해줘', 'review'],
    ['code review please', 'review'],
    ['보안 감사 필요해', 'review'],
    ['design pattern 추천', 'architecture'],
  ])('"%s" → claude/high (rule: %s)', (text, rule) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('claude')
    expect(r?.effort).toBe('high')
    expect(r?.ruleMatched).toBe(rule)
  })
})

describe('patternRoute — 코드 구현 (codex/high)', () => {
  it.each([
    'sum 함수 추가해줘',
    '컴포넌트 만들어줘',
    'API 엔드포인트 추가해',
    'Add a function for parsing',
    'Create a class for users',
    'Write a hook to fetch data',
    'implement a controller',
  ])('"%s" → codex/high', (text) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('codex')
    expect(r?.effort).toBe('high')
  })
})

describe('patternRoute — 버그 수정 (codex/high · bug-fix)', () => {
  it.each([
    '이 버그 고쳐',
    '에러 발생함',
    'fix this bug for me',
    'crash 일어남',
    'debug me',
    '안 돼 왜 그래',
  ])('"%s" → codex/high · bug-fix', (text) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('codex')
    expect(r?.ruleMatched).toBe('bug-fix')
  })
})

describe('patternRoute — 터미널/CLI (codex/low)', () => {
  it.each([
    'git rebase main',
    'npm install react',
    'yarn add typescript',
    '터미널에서 명령어 실행해',
  ])('"%s" → codex/low · terminal-cli', (text) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('codex')
    expect(r?.effort).toBe('low')
    expect(r?.ruleMatched).toBe('terminal-cli')
  })
})

describe('patternRoute — long context / multimodal (gemini)', () => {
  it.each([
    ['전체 코드베이스 훑어봐', 'whole-codebase'],
    ['whole project scan', 'whole-codebase'],
    ['이 스크린샷 분석해줘', 'multimodal'],
    ['긴 문서 요약', 'long-context'],
    ['요약해줘', 'summarize'],
    ['tldr please', 'summarize'],
  ])('"%s" → gemini (rule: %s)', (text, rule) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('gemini')
    expect(r?.ruleMatched).toBe(rule)
  })
})

describe('patternRoute — 인사 (claude/low)', () => {
  it.each([
    '안녕',
    'hi',
    'hello',
    'ㅎㅇ',
  ])('"%s" → claude/low · greeting', (text) => {
    const r = patternRoute(text)
    expect(r?.model).toBe('claude')
    expect(r?.effort).toBe('low')
    expect(r?.ruleMatched).toBe('greeting')
  })
})

describe('patternRoute — 매칭 안 되는 케이스 (null 반환)', () => {
  it.each([
    'asdf qwer',
    '12345',
    '...',
  ])('"%s" → null', (text) => {
    expect(patternRoute(text)).toBeNull()
  })
})

describe('confidence threshold 보장', () => {
  it('모든 룰이 0.8 이상의 confidence를 가져야', () => {
    const samples = [
      '게임 만들어', '버그 고쳐', '함수 추가', 'git push',
      '아키텍처 결정', '코드 리뷰', '전체 코드베이스', '안녕',
    ]
    for (const text of samples) {
      const r = patternRoute(text)
      if (r) expect(r.confidence).toBeGreaterThanOrEqual(0.8)
    }
  })
})
