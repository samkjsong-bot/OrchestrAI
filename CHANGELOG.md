# Changelog

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
