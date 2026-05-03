// src/router/patternRouter.ts
//
// 작업 유형별 자동 라우팅. 우선순위 = 위에서 아래로. 첫 매칭 룰 사용.
//
// 모델 강점 분류:
// - **Codex (gpt-5)**: 코드 구현/수정/디버깅/터미널 명령. 빠르고 정확
// - **Claude (Sonnet/Opus)**: 설계·아키텍처·리뷰·복잡한 reasoning·plan·deep refactor
// - **Gemini (Flash/Pro)**: long-context 분석·요약·multimodal·전체 코드베이스 스캔

import { RoutingDecision } from './types'

interface Rule {
  pattern: RegExp
  model: 'claude' | 'codex' | 'gemini'
  effort: 'low' | 'medium' | 'high' | 'extra-high'
  confidence: number
  label: string
}

const RULES: Rule[] = [
  // ── 풀스케일 프로젝트 만들기 (extra-high) — Claude orchestrator로 가서 큰 그림 잡고 Codex에 위임 ──
  {
    pattern: /(게임|앱|어플|애플리케이션|웹사이트|사이트|서비스|프로그램|확장)\s*(?:을|를)?\s*(?:좀|하나)?\s*(?:만들|구현|짜|개발)/,
    model: 'claude', effort: 'extra-high', confidence: 0.95,
    label: 'full-app-build',
  },
  {
    pattern: /(make|build|create|develop|implement|scaffold)\s+(?:a |an |the )?(?:full|complete|entire|whole|polished|production|new)\s+\w+/i,
    model: 'claude', effort: 'extra-high', confidence: 0.95,
    label: 'full-app-build-en',
  },

  // ── 설계/아키텍처/리뷰 (Claude high) — 깊은 reasoning ──
  {
    pattern: /설계|아키텍처|아키텍쳐|구조\s*(설계|결정)|어떤\s*(패턴|구조)|design pattern|architect\b/i,
    model: 'claude', effort: 'high', confidence: 0.93,
    label: 'architecture',
  },
  {
    pattern: /리팩토링|refactor|구조\s*개선|모듈화|분리\s*해|책임\s*분리|관심사\s*분리/i,
    model: 'claude', effort: 'high', confidence: 0.92,
    label: 'refactor',
  },
  {
    pattern: /리뷰|review|검토|점검|코드\s*리뷰|취약(점)?|보안|security|audit/i,
    model: 'claude', effort: 'high', confidence: 0.90,
    label: 'review',
  },
  // ── 코드 구현/수정 (Codex) — 가장 흔한 케이스. bug-fix를 explain보다 앞에 둬서
  //    "안 돼 왜 그래" 같은 거가 codex로 가게 (explain-reason의 "왜"가 잡지 않게) ──
  // 코드 키워드 명시되면 무조건 Codex high
  {
    pattern: /(?:함수|메서드|클래스|컴포넌트|훅|hook|모듈|파일|api|엔드포인트)\s*(?:를|을)?\s*(?:만들|구현|작성|짜|추가)/,
    model: 'codex', effort: 'high', confidence: 0.92,
    label: 'code-impl',
  },
  {
    pattern: /(?:add|create|write|implement|build|make)\s+(?:a |an |the )?(?:[\w\- ]{0,30}?\b)?(function|method|class|component|hook|module|api|endpoint|file|route|handler|controller|service|model)/i,
    model: 'codex', effort: 'high', confidence: 0.92,
    label: 'code-impl-en',
  },
  {
    pattern: /버그|에러|오류|exception|crash|안\s*돼|안\s*됨|fix\s*it|fix bug|debug|\bfix\b.{0,30}?\b(bug|error|issue|problem|crash|broken)\b/i,
    model: 'codex', effort: 'high', confidence: 0.88,
    label: 'bug-fix',
  },
  {
    pattern: /(코드|로직)\s*(?:을|를)?\s*(?:고쳐|수정|바꿔|변경|개선|업데이트)/,
    model: 'codex', effort: 'high', confidence: 0.88,
    label: 'code-modify',
  },
  {
    pattern: /scaffold|boilerplate|template|초기\s*설정|init|setup|새\s*프로젝트|new project/i,
    model: 'codex', effort: 'high', confidence: 0.85,
    label: 'scaffold',
  },
  {
    pattern: /테스트\s*(작성|추가|짜)|write\s*tests?|unit test/i,
    model: 'codex', effort: 'medium', confidence: 0.85,
    label: 'tests',
  },
  {
    pattern: /\bgit\b\s+\w+|\bnpm\b\s+\w+|\byarn\b|\bpnpm\b|터미널|bash|shell|커맨드\s*(?:실행|쳐)|명령어\s*(?:실행|쳐)|powershell/i,
    model: 'codex', effort: 'low', confidence: 0.93,
    label: 'terminal-cli',
  },
  {
    pattern: /\b타이포\b|\btypo\b/i,
    model: 'codex', effort: 'low', confidence: 0.95,
    label: 'typo',
  },

  // explain-reason — code-impl/bug-fix 보다 뒤. "왜 안 돼" 같은 거가 bug-fix로 잡히게
  {
    pattern: /왜|어떻게\s*동작|이해|설명해|원리|why|explain|understand|개념\s*설명/i,
    model: 'claude', effort: 'medium', confidence: 0.85,
    label: 'explain-reason',
  },

  // ── Long context / multimodal / 요약 (Gemini) ──
  {
    pattern: /전체\s*(코드베이스|프로젝트|폴더|레포)|whole\s*(codebase|repo|project)|모든\s*파일/i,
    model: 'gemini', effort: 'high', confidence: 0.88,
    label: 'whole-codebase',
  },
  {
    pattern: /긴\s*(문서|로그|파일)|대용량|large\s*file|long\s*(context|document|log)|책\s*요약|논문/i,
    model: 'gemini', effort: 'medium', confidence: 0.85,
    label: 'long-context',
  },
  {
    pattern: /이미지|사진|image|screenshot|스크린샷|pdf|다이어그램|차트|그래프|chart|diagram/i,
    model: 'gemini', effort: 'medium', confidence: 0.86,
    label: 'multimodal',
  },
  {
    pattern: /요약|summarize|정리해\s*줘|tldr|tl;dr|overview|훑어|핵심\s*만/i,
    model: 'gemini', effort: 'low', confidence: 0.85,
    label: 'summarize',
  },

  // ── 단순/짧은 케이스 (low) ──
  {
    pattern: /^(?:안녕|hi|hello|ㅎㅇ|반가|good morning|good evening)/i,
    model: 'claude', effort: 'low', confidence: 0.95,
    label: 'greeting',
  },
]

export function patternRoute(input: string): RoutingDecision | null {
  for (const rule of RULES) {
    if (rule.pattern.test(input)) {
      return {
        model: rule.model,
        effort: rule.effort,
        confidence: rule.confidence,
        reason: 'pattern',
        ruleMatched: rule.label,
      }
    }
  }
  return null
}
