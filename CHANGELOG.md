# Changelog

## v0.1.14 — 2026-05-10 (환경설정 인패널화 — Ctrl+, 안 들어가도 됨)

지금까지 Ctrl+, settings 검색해야만 토글할 수 있던 OrchestrAI 설정 전부를 사이드바 ⚙ 에서 직접 조작 가능하게 함.

### 새 ⚙ → 환경설정 패널
- 🧬 모델 변종: Claude / Codex / Gemini 각 변종 dropdown + Thinking auto/off/on/extra
- 🤖 자동화: autoGitCommit / autoPreview / autoOpenDiff / aiMagicComments / inlineCompletion 토글
- 🧭 RAG: codebaseRag.enabled / codebaseRag.autoIndex 토글
- ⚡ 라우터·엔진: contextWindow segmented · codexEngine segmented · confidenceThreshold slider
- 🔌 고급(MCP/customProviders/syncDir): VSCode 네이티브 settings 으로 점프

### 구현
- webview/chat.html: prefs-overlay 패널 + segmented/toggle/slider CSS + apply/save JS
- extension.ts: getPrefs/setPref/openVscodeSettings 메시지 handler
- 저장은 vscode.workspace.getConfiguration('orchestrai').update(key, value, Global) — 즉시 반영
- contextWindow 변경 시 실시간 _applyContextWindow() 재실행

이제 사용자는 Ctrl+, 안 들어가고 사이드바 안에서 모든 토글·dropdown·slider 조작 가능.

## v0.1.13 — 2026-05-10 (모델 변종 + thinking 사용자 강제)

지금까지 effort(low/medium/high/extra-high)에 따라 모델 변종이 자동 결정됐고, thinking budget 도 effort 에 묶여 있었음. 이제 사용자가 settings 에서 직접 강제 가능.

### 추가 settings (4종)
- `orchestrai.claudeModel` — auto / sonnet 4.6 / **opus 4.7** / haiku 4.5
- `orchestrai.codexModel` — auto / gpt-5.4-mini / gpt-5.4 / gpt-5.5
- `orchestrai.geminiModel` — auto / 2.5-flash / 2.5-pro / 2.0-flash
- `orchestrai.thinkingMode` — auto / off / on / extra (effort 와 독립)

### 동작
- 모든 setting default = `auto` → 기존 동작 그대로 (effort 따라 변종 결정)
- `auto` 외 값 선택 시 → effort 무시하고 그 모델/모드 강제
- UI 의 actualModel 라벨도 override 반영
- thinking: off=비활성, on=5k budget 강제, extra=모델 한도까지 (Sonnet 32k / Opus 64k)

### Claude opus 4.7 업그레이드
- 기본 effort=extra-high 매핑이 `claude-opus-4-6` → `claude-opus-4-7` 로
- thinking budget 한도도 64k 그대로 (4-7 도 동일)

## v0.1.12 — 2026-05-10 (Aider 4종 + UX 보강)

오픈소스 경쟁 익스텐션 (Aider/Roo/Continue/Cline) 분석 후 우리 인프라에 fit 좋은 4개 기능을 도입.

### A. Smart commit message (Haiku 기반)
- `src/util/commitMessage.ts` — staged diff 를 Haiku 가 1초 내 요약 → 의미 있는 commit subject
- 매 턴 자동 commit 의 이전 generic 형식 (`[OrchestrAI] <응답 첫줄>`) → AI 가 변경 내용 보고 직접 작성
- 실패 시 fallback 으로 떨어지므로 throw 없음

### B. AI! 매직 코멘트 watch (Aider 시그니처)
- 코드에 `// AI! refactor this` 또는 `# AI? what does this do` 작성 후 저장 → 자동 chat 트리거
- AI! = 명령(수정 요청), AI? = 질문(코드는 그대로)
- 별도 FileSystemWatcher (RAG 와 무관). 매직 토큰 + 주변 ±5 줄 컨텍스트 자동 첨부
- setting `orchestrai.aiMagicComments` (default true) — 끄려면 false
- 30초 cooldown 으로 중복 트리거 방지

### C. Test-driven loop (Aider 의 "until tests pass")
- `src/util/testRunner.ts` — npm test / pytest / cargo test / go test 자동 감지
- `loop` 모드에서 매 iteration 끝나면 테스트 자동 실행
- 통과 → 즉시 종료 (✅ 토스트)
- 실패 → 실패 출력만 추출해서 다음 iteration prompt 에 주입 → 모델이 그것만 보고 fix
- 테스트 명령 못 찾으면 기존 자체 종료 신호 fallback

### D. Repo map (Aider 의 코드 그래프)
- `src/util/repoMap.ts` — regex 기반 symbol(함수·클래스·메서드) 추출 (ts/js/py/go/rs/java/c++/cs/kt)
- tree-sitter dep 없이 ~5KB code, vsix 크기 거의 안 늘어남
- query 안의 식별자 → repo map lookup → 정의 위치 + signature 를 system prompt 에 첨부
- embedding RAG 의 약점 ("이 함수 어디서 정의됐어?" 정확 매칭) 보완
- `/index` 시 같이 빌드. 디스크 캐시 (workspace hash 키)

### UX 보강
- **Smart commit chip**: AI 가 생성한 commit subject 가 chip 안에 표시 (이전엔 hash 만)
- **Repo map hit 인디케이터**: 보라색 카드로 "📍 repo map: N개 심볼 정의 첨부" + 클릭 → 파일 점프
- **AI! 감지 버블**: 매직 코멘트 트리거 시 채팅에 노란/시안색 카드로 "🤖 AI! 매직 코멘트 감지 — file:line → instruction"
- 자동 prompt 입력 진행 중 (locked) 이면 즉시 보내지 않고 입력창에 떨어뜨림 (현재 작업 보존)

## v0.1.11 — 2026-05-10 (글로벌 노출 + publish workflow 버그 fix)

- **README 영어 단일** + `README.ko.md` 분리 (Marketplace 글로벌 검색 SEO ↑)
- `package.json` description 영어로 — Marketplace 카드 노출
- 깨진 shields.io marketplace 배지 (retired) → 정상 정적 배지로 교체
- **publish.yml fix**: step-level `env: VSCE_PAT` 가 step-level `if:` 에서 평가 안 되는 GitHub Actions 알려진 함정 회피 — shell 안에서 분기 검사로 변경 (이전 버전 publish 가 silent skip 됐을 가능성 차단)
- 누락된 v0.1.8/v0.1.9/v0.1.10 changelog 항목 보강

## v0.1.10 — 2026-05-10 (Marketplace UX)

- `package.json` description 한국어 (롤백됨 — v0.1.11 에서 영어로 다시)
- shields.io marketplace 배지 retired 처리

## v0.1.9 — 2026-05-10 (perf instrumentation + i18n locale)

### G. Performance instrumentation
- `src/util/perf.ts` — `record/timed/timedAsync` 헬퍼 + `formatReport`
- `history.ts buildTaggedHistory` 측정 부착
- `/perf` slash 명령 (통계 출력) + `/perfreset` (초기화)

### H. i18n locale-aware responses
- `src/util/locale.ts` — `vscode.env.language` → ko/en/ja/zh/es/de/fr/pt/ru 매핑
- `buildSystemPrompt` 에 `localeBlock()` inject — 모델이 사용자 locale 자동 인지하고 그 언어로 응답
- 코드블록·기술 용어는 영어 유지

### I. Whisper API
- 보류 — chatgpt.com backend 형식 미공개, 1+일 분석 필요

## v0.1.8 — 2026-05-09 (Word + Jupyter 첨부)

- **Word (.docx)** — mammoth → markdown inline (모든 모델)
- **Jupyter (.ipynb)** — cell 분리 + outputs 표시 (모든 모델)
- 텔레그램 첨부 자동 다운로드 + OrchestrAI 자동 처리 (photo/document/voice/audio/video)
- PDF 텍스트 fallback (Codex 용 — unpdf, 2.2MB)
- **이메일** (.eml/.msg) — mailparser
- **PowerPoint 노트** 추출 (jszip)
- **RTF / ODT** — 정규식 / jszip
- TgClient `downloadFile` + bridge `_onTelegramMessage` 다운로드 처리
- 테스트 60 → 105 (+75%)
- dispose 누수 fix — `_reindexTimer` clearTimeout + `_currentAbort` abort

## v0.1.7 — 2026-05-09 (첨부 형식 대확장 + GitHub 인프라)

### 첨부 파일 형식 (Claude Code 수준 + 일부 그 이상)
- **이미지** (png/jpg/gif/webp/svg) — Claude/Codex/Gemini 모두 multimodal
- **PDF** — Claude/Gemini multimodal
- **엑셀** (xlsx/xls/xlsm/ods) — SheetJS → CSV inline (모든 모델)
- **Word** (.docx) — mammoth → markdown inline (모든 모델)
- **Jupyter** (.ipynb) — cell 분리 → 코드블록 + outputs (모든 모델)
- **PowerPoint** (.pptx) — jszip + 슬라이드 텍스트 추출 (모든 모델)
- **음성** (mp3/wav/m4a/flac/ogg) — Gemini multimodal
- **영상** (mp4/mov/webm) — Gemini multimodal
- 텍스트/코드 (40+ 확장자) — inline 코드블록

### Multimodal 정식 처리
- **Claude SDK**: `query()` 의 prompt 를 AsyncIterable<SDKUserMessage> 로 전달, content blocks (text/image/document) 구성
- **Gemini provider**: `type: 'file'` 추가 (PDF/audio/video)
- **Codex provider**: chatgpt.com 우회 경로의 `input_image` content type 직접 처리

### GitHub 인프라
- `.github/workflows/ci.yml` — Ubuntu+Windows × Node 20 매트릭스 CI
- `.github/workflows/publish.yml` — v* 태그 push 시 GitHub Release + Marketplace + Open VSX 자동 publish
- `.github/dependabot.yml` — npm 주간, GitHub Actions 월간, 그룹화
- `SECURITY.md` — threat model + 취약점 보고 정책

### 안정성
- spawn timeout (gh/git push 60s, 기본 15s) — auth hang process leak 방지
- webview message error boundary — 한 핸들러 fail 해도 다른 작동
- dispose 누수 fix — `_reindexTimer` clearTimeout + `_currentAbort` abort
- esbuild build 깨짐 fix (playwright-core / chromium-bidi external)

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
