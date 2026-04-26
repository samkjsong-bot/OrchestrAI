# OrchestrAI

VSCode 익스텐션 — **Claude(Max 구독) + Codex(ChatGPT Pro) + Gemini(OAuth)** 셋을 한 사이드바에서 라우팅·협업시키는 오케스트레이터.

**핵심 원칙: 추가 API 과금 0원.** 모든 텍스트 모델 호출은 사용자가 이미 쓰는 구독·무료 티어를 통해 우회 — Claude는 로컬 `claude` CLI 인증 재사용, Codex는 chatgpt.com 백엔드 직접 호출, Gemini는 로컬 `gemini` CLI OAuth.

## ✨ 주요 기능

- **자동 라우팅** — 입력 분석해서 가장 적합한 모델로 자동 선택 (pattern → llm 단계)
- **모드 6종** — `auto` / `claude` / `codex` / `gemini` 강제, `argue`(라운드 로빈 토론, Haiku 채점), `team`(Claude 설계 → Codex 구현 → Gemini 리뷰)
- **권한 모드 4종** — `ask` / `auto-edit` / `plan` / `smart-auto` (Claude Code SDK 호환)
- **컨텍스트 압축** — 한계치 도달 시 Haiku로 자동 요약, 모델별 윈도우 트리밍
- **MCP 서버 지원** — 사용자 설정 MCP 도구 자동 주입 (Codex/Gemini는 프롬프트, Claude는 SDK 직접)
- **Telegram 브릿지** — 외부에서 봇으로 명령. Hub/Worker 멀티 인스턴스, 워크스페이스별 Topic 분리
- **이미지 생성** — Gemini API 키로 (모델 폴백 체인: 2.5 Flash → 2.0 Flash exp → Imagen 3)
- **변경 사항 카드** — 파일 수정한 턴마다 diff preview + 파일 열기 / diff 보기 버튼
- **Kill switch** — 진행 중 모든 LLM 호출·툴 루프 즉시 중단

## 📦 설치

### VSIX로 설치 (권장)
1. [Releases](https://github.com/samkjsong-bot/OrchestrAI/releases) 에서 최신 `.vsix` 다운로드 또는 직접 빌드
2. VSCode → 확장 → `…` → "VSIX에서 설치..." → 파일 선택

또는 터미널:
```bash
code --install-extension orchestrai.vsix
```

### 직접 빌드
```bash
git clone https://github.com/<your>/orchestrai.git
cd orchestrai
npm install
npm run package
code --install-extension orchestrai.vsix
```

## 🔧 사전 준비

OrchestrAI 자체엔 API 키가 필요 없지만, 각 모델별 인증이 필요:

| 모델 | 필요한 것 | 무료 가능? |
|------|----------|------------|
| Claude | 로컬 `claude` CLI 설치 + 로그인 | Max 구독 필요 |
| Codex | OrchestrAI 안에서 ChatGPT OAuth | ChatGPT Pro 구독 필요 |
| Gemini | 로컬 `gemini` CLI 설치 + 로그인 | ✅ Google 무료 티어 |
| 이미지 생성 (선택) | Gemini API 키 | 무료 / Paid (모델별) |

설치 후 사이드바 → ⚙ 설정 → 계정 연결에서 각 모델 로그인.

## 🎛 사용법

설치 후 Activity Bar에 OrchestrAI 아이콘(3원 Venn) 등장 → 클릭하면 사이드바 채팅 패널.

- **자동 라우팅**: 그냥 질문하면 적절한 모델로 자동
- **강제 모델**: `@claude` / `@codex` / `@gemini` 멘션 또는 force 버튼
- **토론**: force `argue` — 모델들이 서로 반박/보완
- **협업**: force `team` — Claude가 plan 짜고 Codex 구현, Gemini 리뷰

자세한 구조는 [CODEMAP.md](./CODEMAP.md) 참조.

## 🏗 아키텍처

```
[VSCode webview UI]
  ↓ postMessage
[OrchestrAIViewProvider — extension.ts]
  ↓ Orchestrator.route()
[router/]: pattern → llm → decision
  ↓
[providers/]: claudeProvider | codexProvider | geminiProvider
  ↓ streaming chunks
[webview]: tool boxes, change cards, diffs
```

스택:
- TypeScript + esbuild bundle
- `@anthropic-ai/claude-agent-sdk` (Claude tool loop)
- `ai` + `ai-sdk-provider-gemini-cli` (Gemini ESM)
- 자체 fetch 기반 Codex SSE / Telegram polling

## 📜 라이선스

MIT (예정)

## 🙏 Inspired by

- Claude Code for VSCode — UI/UX 참고
- Codex CLI — fingerprint 우회 경로
