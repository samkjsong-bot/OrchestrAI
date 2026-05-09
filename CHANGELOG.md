# Changelog

## v0.1.6 — 2026-05-08~09 (대규모 기능 + 안정성 패스)

### 🎯 새 기능 (상용 도구 핵심 따라잡기)

#### @ commands (Continue 스타일)
- `@file` — 파일 picker 다중 선택 → 입력창 첨부
- `@codebase` — RAG 명시 호출 → top-K chunk 첨부
- `@terminal` — 활성 터미널 선택 영역 첨부 (clipboard 우회)
- `@git` — git status / diff / log 첨부
- `@web` — URL fetch + HTML strip
- `@browser` — Playwright + system Chrome 으로 SPA / JS-rendered 페이지 추출
- `@problem` — VS Code Problems 패널 진단 첨부

#### `/pr` 자동 PR 생성
- gh CLI + AI(Haiku) 가 commit log + diff stat 보고 title/body 자동 작성
- gh 미설치 시 사용자 수동 입력 fallback

#### Custom Provider (LM Studio / Ollama / OpenRouter / vLLM / OpenAI compatible)
- `orchestrai.customProviders` settings 배열로 추가
- `@<name>` mention 으로 호출 (`@ollama`, `@local` 등)
- 의존성 추가 0 (직접 fetch + SSE 파싱)

#### Plan → Act 흐름 (Cline 스타일)
- Plan 모드 turn 끝나면 보라색 CTA 버튼 표시
- 클릭 시 자동 auto-edit 전환 + plan 내용을 user prompt 로 실행
- reload 후 DOM fallback 으로 안전하게 작동

#### Composer 다중 파일 review (Cursor 스타일)
- 5+ 파일 자동 collapse + ▾ 토글
- 파일별 ↶ revert 버튼 (단일 파일 git checkout)
- 일괄 액션: 이 turn 다 되돌리기 / 전부 열기

#### Voice input (Web Speech API)
- 입력창 옆 🎤 마이크 버튼 (한국어 default)
- 녹음 중 빨간 pulse 애니메이션
- continuous + interim 결과 실시간 textarea 갱신
- 의존성 0

#### Browser tool (Playwright + system Chrome)
- Chromium 자체 다운로드 X (`channel: 'chrome'` / `'msedge'`)
- JS 실행 후 페이지 텍스트 추출 (SPA 지원)

#### ORCHESTRAI.md 자동 룰
- workspace root 의 `ORCHESTRAI.md` / `.orchestrai/rules.md` 자동 prepend
- 모든 모델 system prompt 에 통합 주입 (5분 캐시 + mtime 갱신)

### 🛠 UI / UX 개선
- force bar 8개 → 5개 (auto/claude/codex/gemini → dropdown 통합)
- Plan / Ask 모드 시 입력창 색 + placeholder 시각화
- 사이드바 ⚙ 설정 → 👤 계정 연결 메뉴에 "ⓘ 계정 정보 보기"
- usage panel 한글 mojibake 6곳 fix
- usage panel 에 절약 추정 비용 표시 (구독 우회로 실제 청구 0)

### 🐛 안정성 fix (다수)
- `maxTokens` 옵션 SDK 가 받음 — 다시 추가 (응답 cut-off 방지)
- Reload Window 시 메시지 사라지는 race condition (ready 이후 500ms / 1500ms retry)
- rehydrate 일부 실패해도 나머지는 그리는 try/catch 보강
- marked.parse 실패 시 manualMarkdownFallback (bold/italic/code/codeblock 수동 처리)
- team consult 응답 disk 영속화 (reload 후 사라지던 거)
- argue 모드 fallback 비활성화 + ventriloquism 차단
- history tag `[Claude]` → `<prior_turn from="claude">` (학습 trigger 제거)
- Gemini API key 텍스트 호출에도 활용 (Code Assist OAuth tier 대비 한도 ↑)
- Gemini RESOURCE_EXHAUSTED 시 1.5/2.0-flash fallback
- Codex 빈 응답 SSE 핸들러 3개 추가 (output_text.done / content_part / response.completed)
- review/boomerang user msg 즉시 persist 누락 보완
- rehydrate 후 자동 스크롤 (reload 시 최상단 머무르던 거)
- esbuild build 깨짐 fix (playwright-core / chromium-bidi external)
- Korean encoding mojibake 6곳 (usage panel + 로그인 카드)

### 🧹 리팩토링
- dead code 정리 (BoomerangPlan / findMostRecentChat / CODEX_TOOL_RE / modelTag 등)
- inline ventriloquism strip (라인 시작 + markdown bold + inline 다 잡음)

## v0.1.3 — 2026-05-07

### Diagnostics
- rehydrate 루프 per-item try/catch — 메시지 한 개가 throw 해도 나머지는 그림
- 부분 실패 시 화면 상단에 빨간 에러 박스 표시 (silent fail 방지)
- 전역 `window.error` 핸들러 추가 — 미잡힌 JS 에러도 화면에 즉시 노출

## v0.1.2 — 2026-05-06

### Fixed
- **Reload Window 시 메시지 사라지는 버그**: 디스크엔 데이터 살아있지만 webview 가 빈 채로 시작하는 race condition
  - host: `webviewReady` 받으면 push + 500ms / 1500ms 후 한 번씩 더 (idempotent)
  - webview: 빈 rehydrate 가 화면을 지우지 않게 (이미 메시지 있으면 무시)
  - webview→host `requestRehydrate` 역방향 safety net

## v0.1.1 — 2026-05-06

### Fixed
- **응답 중간 cut-off 버그**: yaml/markdown 도중 잘림
- 원인: SDK type definition 에 `maxTokens` 가 없어서 dead config 로 판단해 제거했는데, 실제 cli.js 는 받음
- 복구 후 Sonnet 4.6 한도(64k) / Opus 4.6 한도(32k) 까지 사용

## v0.1.0 — 2026-05-03 (initial public release)

### 라우팅 모드 6+1
- `auto` — pattern + LLM(Haiku) 자동 라우팅
- `claude` / `codex` / `gemini` — 모델 강제
- `argue` ⚡ — 모델 토론 + Haiku 0~10점 채점
- `team` 👥 — Claude orchestrator + consult_codex/gemini 위임
- `loop` 🔁 — 될 때까지 반복 (Ralph Wiggum)
- `boomerang` 🪃 — 큰 작업 자동 분할 + 병렬

### 코어 기능
- 코드베이스 RAG (Gemini 무료 임베딩)
- 멀티모델 코드 리뷰 (`/review`)
- 백그라운드 에이전트 + Telegram push
- 자동 git commit (체크포인트, 한 턴씩 revert)
- 자동 IDE diff (FileSystemWatcher 기반, engine 무관)
- 자동 미리보기 (HTML→Simple Browser, ▶ run)
- Inline ghost text 자동완성 (선택, default off)
- Agent marketplace (Gist 기반 system prompt 공유)
- Multi-IDE sync (OneDrive/Dropbox 폴더 활용)

### 멀티모델 인프라
- Claude: `@anthropic-ai/claude-agent-sdk` (Max 구독, 로컬 CLI 인증 재사용)
- Codex: 두 엔진 — `native` (codex.exe mcp-server stdio, 권장) + `legacy` (chatgpt.com 직접 fetch, fallback)
- Gemini: `ai-sdk-provider-gemini-cli` (ESM dynamic import 트릭)
- 자동 quota 폴백 (Claude→Codex→Gemini)
- 컨텍스트 윈도우 preset (narrow/default/wide)
- 컨텍스트 압축 (Haiku 요약 + 최근 verbatim)

### Telegram 브릿지
- Hub/Worker 구조 (멀티 VSCode 인스턴스)
- Topics 모드 (워크스페이스별 자동 분리)
- 메시지 큐잉 + 끼어들기
- 4096자 넘는 응답 자동 분할 발송
- polling 안정화 (hard timeout, 409 자동 강등, 자동 재연결)

### UI/UX
- 진행 표시 바 (입력창 위, 현재 도는 툴 즉시 표시)
- 응답 톤 강화 (action verb, 산문 단락 금지)
- near-bottom 스크롤 (위로 보면 자동 스크롤 멈춤)
- 파일 경로 자동 클릭 링크 (file:line 점프)
- 권한 모드 4종 (ask/auto-edit/plan/smart-auto)
- 메시지 큐잉 패널, 백그라운드 작업 패널, RAG chunk 표시, boomerang plan 시각화

### 핵심 원칙
- **Zero API billing** — 모든 텍스트 모델 호출이 사용자 자체 구독·무료 티어 우회
- 단일 코드베이스에서 동작 (외부 서버 인프라 0)
- 오픈소스 — [MIT License](./LICENSE)
