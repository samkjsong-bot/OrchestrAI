<div align="center">

# 🎼 OrchestrAI

### **Claude · Codex · Gemini** — 한 사이드바에서 자동 라우팅·협업·토론

`auto-route` · `argue ⚡` · `team 👥` · `loop 🔁` · `boomerang 🪃` · `RAG 🧭` · `Telegram 📱` · `zero billing 💰`

추가 API 과금 없음 — 모두 사용자 자체 구독·무료 티어로 우회

[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![VSCode](https://img.shields.io/badge/VSCode-1.98%2B-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=samkj.orchestrai)
[![Marketplace](https://img.shields.io/badge/Marketplace-OrchestrAI-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=samkj.orchestrai)

**[🛒 Marketplace 설치](https://marketplace.visualstudio.com/items?itemName=samkj.orchestrai)** · [📦 Releases](https://github.com/samkjsong-bot/OrchestrAI/releases) · [📖 CODEMAP](./CODEMAP.md) · [🐛 Issues](https://github.com/samkjsong-bot/OrchestrAI/issues)

```
ext install samkj.orchestrai
```

</div>

---

## ✨ 한눈에

| | OrchestrAI | Cursor | Continue | Cline/Roo | Copilot |
|---|---|---|---|---|---|
| 멀티모델 자동 라우팅 | ✅ pattern + LLM | ❌ 수동 | ❌ 수동 | ❌ 수동 | ❌ 수동 |
| **모델 토론** (argue) | ✅ 0~10 채점 | ❌ | ❌ | ❌ | ❌ |
| **Team mode** Claude→Codex/Gemini 위임 | ✅ | ❌ | ❌ | Roo만 | ❌ |
| **Boomerang task** 자동 분할·병렬 | ✅ | ❌ | ❌ | Roo만 | ❌ |
| **Ralph Wiggum loop** 될 때까지 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 코드베이스 RAG | ✅ | ✅ | ✅ | ❌ | △ |
| **멀티모델 코드 리뷰** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Telegram 폰 통합** Hub/Worker | ✅ | ❌ | ❌ | ❌ | ❌ |
| Background agent + push 알림 | ✅ + Telegram | ✅ | ❌ | ❌ | ❌ |
| Multi-IDE sync (OneDrive/Dropbox) | ✅ | △ | ❌ | ❌ | △ |
| **Agent marketplace** (Gist 기반) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Inline ghost text 자동완성 | ✅ | ✅ | ✅ | ❌ | ✅ |
| 자동 git commit 체크포인트 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 자동 IDE diff (engine 무관) | ✅ | ✅ | △ | ❌ | △ |
| 자동 미리보기 HTML→Browser | ✅ | ❌ | ❌ | ❌ | ❌ |
| 자동 quota 폴백 (모델 간) | ✅ | N/A | N/A | N/A | N/A |
| **@ commands 풍부** | ✅ 7종 | △ | ✅ | ✅ | △ |
| `/pr` 자동 (gh + AI title/body) | ✅ | ❌ | ❌ | ❌ | △ |
| **Custom provider** (Ollama/LM Studio/OpenRouter) | ✅ | ❌ | ✅ | △ | ❌ |
| **Plan→Act 분리 흐름** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Composer 다중 파일 review** (collapse + revert) | ✅ | ✅ | △ | △ | ❌ |
| **Voice input** (한국어) | ✅ | △ | ❌ | ❌ | ❌ |
| **Browser tool** (Playwright + system Chrome) | ✅ | ❌ | △ | ✅ | ❌ |
| **ORCHESTRAI.md** 프로젝트 룰 | ✅ | △ | ✅ | ✅ | ❌ |
| 절약 추정 비용 표시 | ✅ | ❌ | ❌ | ❌ | ❌ |
| **API 과금 0원** (자체 구독 우회) | ✅ | ❌ | ❌ | ❌ | △ 구독 |

---

## 🎛 라우팅 모드 6+1종

| | 동작 |
|---|---|
| `auto` | pattern → LLM(Haiku) 순 자동 라우팅 |
| `claude` / `codex` / `gemini` | 모델 강제 |
| `argue` ⚡ | 모델들이 라운드 로빈 토론, Haiku가 0~10점 채점 |
| `team` 👥 | Claude orchestrator → Codex/Gemini 위임 (consult tool) |
| `loop` 🔁 | "될 때까지" 반복 (Ralph Wiggum 패턴, max 5회) |
| `boomerang` 🪃 | 큰 작업 자동 분할 → 병렬 위임 → 종합 |

## 🧰 권한 모드 4종

`ask` / `auto-edit` / `plan` / `smart-auto` — Claude SDK의 `permissionMode`로 매핑.
**Plan 모드** turn 끝나면 보라색 "▶ Act 모드로 실행" 버튼 → 클릭 시 자동 auto-edit 전환 + plan 따라 실행 (Cline 식 흐름).

## 💬 @ commands (입력창에 `@` 치면 자동완성)

| Command | 동작 |
|---|---|
| `@claude` / `@codex` / `@gemini` | 모델 강제 |
| `@<custom>` | settings 의 `customProviders` 에 등록한 OpenAI compatible (Ollama/LM Studio/OpenRouter 등) |
| `@file` | 파일 picker → 다중 선택해서 입력창 첨부 |
| `@codebase` | RAG 명시 호출 → 검색어 입력 → top-K chunk 첨부 |
| `@terminal` | 활성 터미널 선택 영역 첨부 (먼저 텍스트 select) |
| `@git` | git status / diff / log -10 첨부 |
| `@web` | URL fetch (정적 HTML) |
| `@browser` | Playwright + system Chrome (JS 실행 후, SPA 지원) |
| `@problem` | VS Code Problems 패널 진단 첨부 |

## ⚙ 슬래시 명령

```
/clear            대화 초기화
/plan             plan 모드 진입
/auto             auto-edit 모드
/team             team 모드
/argue            argue 토론 모드
/loop             반복 모드
/effort high      effort 강제
/review           multi-model 코드 리뷰 (3개 모델 + Haiku 종합)
/index            코드베이스 인덱싱
/pr [title]       gh CLI + AI 가 PR title/body 자동 생성
/bg <task>        background agent 시작
/agent ...        agent marketplace (import / list / use / remove)
/perf             성능 통계 출력
/perfreset        성능 통계 초기화
```

## 🎤 음성 입력
입력창의 🎤 버튼 → 한국어 default. 녹음 중 빨간 pulse. 다시 클릭으로 종료. 사용자 locale 자동 감지.

## 🔌 Custom Provider (LM Studio / Ollama / OpenRouter / vLLM / OpenAI compatible)

VSCode Settings 에 추가하면 `@<name>` mention 으로 호출:

```json
"orchestrai.customProviders": [
  { "name": "ollama", "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5-coder:32b" },
  { "name": "lm",     "baseUrl": "http://localhost:1234/v1",  "model": "llama-3.3-70b" },
  { "name": "or",     "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-or-...",
                       "model": "anthropic/claude-3.5-sonnet" }
]
```

## 📎 첨부 파일 (Claude Code 수준)

drag & drop / paste / 파일 picker — 모두 자동 분기:

| 형식 | Claude | Codex | Gemini | 처리 |
|---|---|---|---|---|
| 텍스트/코드 (md/json/ts/py/sh/sql 등 40+) | ✅ | ✅ | ✅ | inline 코드블록 |
| 이미지 (png/jpg/gif/webp/svg) | ✅ | ✅ | ✅ | base64 multimodal |
| PDF | ✅ | ❌ | ✅ | base64 multimodal (Codex 는 텍스트 fallback) |
| 엑셀 (xlsx/xls/xlsm/ods) | ✅ | ✅ | ✅ | SheetJS → CSV |
| Word (.docx) | ✅ | ✅ | ✅ | mammoth → markdown |
| Jupyter (.ipynb) | ✅ | ✅ | ✅ | cell 분리 |
| PowerPoint (.pptx) | ✅ | ✅ | ✅ | jszip 슬라이드+노트 텍스트 |
| 이메일 (.eml/.msg) | ✅ | ✅ | ✅ | mailparser |
| RTF / ODT | ✅ | ✅ | ✅ | inline 텍스트 |
| 음성 (mp3/wav/m4a/flac/ogg) | ❌ | ❌ | ✅ | Gemini multimodal |
| 영상 (mp4/mov/webm) | ❌ | ❌ | ✅ | Gemini multimodal |

multimodal 첨부 시 auto 모드면 자동으로 Gemini 라우팅. 음성/영상은 Gemini 만 인식.

## 📋 ORCHESTRAI.md (프로젝트 룰)

워크스페이스 루트에 `ORCHESTRAI.md` 파일 만들면 자동 로드됨 → 모든 모델 system prompt 에 prepend.
컨벤션, 금지 사항, 스택 정보, 도메인 지식 등을 한 번에 통합 주입.

## 🌐 응답 언어 자동 감지 (Locale)

VSCode 언어 설정 자동 감지 → 모델한테 "이 사용자 언어로 답하라" system prompt inject. 지원: ko / en / ja / zh / es / de / fr / pt / ru. 코드블록·기술 용어는 영어 유지.

## 🚀 핵심 기능

### 자동 인덱싱 + RAG
질문하면 코드베이스에서 관련 chunk를 자동 검색해 컨텍스트로 첨부. Cursor/Continue 수준.
```
/index   ← 첫 번째 인덱싱
이후 자동
```

### 멀티모델 코드 리뷰
세 모델이 각자 리뷰 → Haiku가 종합 점수.
```
/review            (last commit)
/review staged     (staged changes)
```

### 백그라운드 에이전트 + Telegram push
큰 작업 던지고 자거나 외출. 완료되면 폰으로 알림.
```
/bg 좀비 서바이벌 게임 풀버전 만들어줘
```

### Agent marketplace
GitHub Gist 기반 system prompt 공유. 누구나 만들고 누구나 import.
```
/agent import https://gist.github.com/USER/HASH
/agent list
/agent use vibe-game-builder
/agent off
```

### Telegram 브릿지 (폰 통합)
설정 → Telegram 연결 → DM/Topics 모드.
- Topics 모드: 그룹 안에서 워크스페이스별 자동 분리
- 폰에서 명령 → VSCode가 처리 → 응답 폰으로 stream
- 4096자 넘으면 자동 분할 발송

### 자동 git commit (체크포인트)
매 턴 끝나면 자동 commit. 망쳐도 한 턴씩 즉시 revert.

### 자동 미리보기
HTML 만들면 → Simple Browser 자동 열림  
package.json dev script → ▶ 실행 버튼  
Python/Node → ▶ run

---

## 📦 설치

### 빠른 설치 (권장)
1. [Releases](https://github.com/samkjsong-bot/OrchestrAI/releases)에서 `orchestrai.vsix` 다운로드
2. VSCode → 확장 패널 → `…` → "VSIX에서 설치"

또는 터미널:
```bash
code --install-extension orchestrai.vsix
```

### 직접 빌드
```bash
git clone https://github.com/samkjsong-bot/OrchestrAI.git
cd OrchestrAI
npm install
npm run package
code --install-extension orchestrai.vsix
```

## 🔐 사전 준비

OrchestrAI 자체엔 API 키 0개 필요. 각 모델별 인증만:

| 모델 | 필요한 것 | 무료? |
|---|---|---|
| Claude | 로컬 `claude` CLI 로그인 | Max 구독 필요 |
| Codex | OrchestrAI 안에서 ChatGPT OAuth | ChatGPT Pro 구독 필요 |
| Gemini | 로컬 `gemini` CLI 로그인 | ✅ Google 무료 |
| 이미지 생성 (옵션) | Gemini API 키 | △ |

설치 후: 사이드바 → ⚙ 설정 → 계정 연결.

## 💡 사용 팁

- **단순 질문**: 그냥 입력 → auto 라우팅
- **앱/게임 만들기**: `🪃 boom` 모드 → 자동 분할 + 병렬
- **모델 의견 비교**: `⚡ argue` 모드 → 토론 + 채점
- **될 때까지 반복**: `🔁 loop` 모드
- **외출 작업**: `/bg <작업>` + 폰 텔레그램 대기
- **PR 리뷰**: `/review`

## 🏗 스택

- TypeScript + esbuild
- `@anthropic-ai/claude-agent-sdk` (Claude tool loop)
- `ai` + `ai-sdk-provider-gemini-cli` (Gemini ESM)
- `codex.exe mcp-server` (Codex CLI 네이티브 MCP)
- 자체 Telegram polling, 자체 fetch SSE

자세한 구조: [CODEMAP.md](./CODEMAP.md)

## 🤝 라이선스

[MIT](./LICENSE)

## 🙏 영감

- Claude Code for VSCode — UI/UX 일부 참고
- Codex CLI — fingerprint 우회 경로
- Roo Code — boomerang task 패턴
- Cursor — RAG/checkpoint 아이디어
- Geoffrey Huntley — Ralph Wiggum loop 명명

---

<div align="center">
<sub>made for vibe coders · zero billing · open source</sub>
</div>
