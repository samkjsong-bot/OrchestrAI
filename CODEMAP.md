# 🗺️ OrchestrAI CODEMAP

VSCode 익스텐션. **Claude(Max 구독) + Codex(ChatGPT Pro) + Gemini(OAuth)** 셋을 한 사이드바에서 라우팅·협업시키는 오케스트레이터.

---

## 📁 디렉토리

```
orchestrai/
├── src/
│   ├── extension.ts                    ★ 메인 프로바이더 (2557 lines, 거의 모든 로직 여기)
│   ├── auth/                           각 모델 로그인/토큰 관리
│   │   ├── claudeAuth.ts               Claude Code CLI 인증 재사용 (Max 구독)
│   │   ├── codexAuth.ts                ChatGPT.com OAuth + PKCE (구독 백엔드용)
│   │   ├── geminiAuth.ts               gemini CLI OAuth 감지 (Google 무료 티어)
│   │   └── storage.ts                  토큰 디스크 저장
│   ├── providers/                      각 모델 호출 래퍼 (스트리밍, abort, 폴백)
│   │   ├── claudeProvider.ts           @anthropic-ai/claude-agent-sdk 통한 호출 + 툴 박스 포맷팅
│   │   ├── codexProvider.ts            chatgpt.com/backend-api/codex/responses (SSE)
│   │   ├── geminiProvider.ts           ai-sdk-provider-gemini-cli (ESM dynamic import)
│   │   └── geminiImageProvider.ts      Gemini API 키 기반 이미지 생성
│   ├── router/                         라우팅 로직
│   │   ├── types.ts                    Model/Effort/RoutingDecision/ChatMessage
│   │   ├── orchestrator.ts             메인 라우터 (mention → pattern → llm 순)
│   │   ├── patternRouter.ts            정규식 기반 1차 라우팅 (빠름, confidence 높을 때만)
│   │   ├── llmRouter.ts                Claude Haiku 기반 2차 라우팅 (애매할 때)
│   │   └── judge.ts                    argue 모드 판정 (Haiku, 0~10점)
│   ├── team/
│   │   └── teamMcp.ts                  team 모드 MCP 서버 (Claude→Codex/Gemini 위임 툴)
│   ├── telegram/                       원격 텔레그램 브릿지
│   │   ├── bridge.ts                   Hub/Worker 모드, 폴링
│   │   ├── registry.ts                 멀티-VSCode 인스턴스 레지스트리 (파일 기반)
│   │   ├── client.ts                   Telegram Bot API 클라이언트
│   │   └── workerServer.ts             HTTP 워커 서버 (hub→worker 메시지)
│   └── util/
│       ├── compaction.ts               대화 압축 (Haiku 요약 + 최근 verbatim)
│       ├── history.ts                  모델별 컨텍스트 트리밍
│       ├── usage.ts                    토큰 사용량 트래킹
│       ├── log.ts                      OrchestrAI Output 채널
│       ├── quota.ts                    쿼터 에러 감지/요약
│       └── retry.ts                    재시도 헬퍼
├── webview/
│   └── chat.html                       ★ UI 전체 (3396 lines) — 거의 모든 프론트엔드
├── resources/
│   ├── icon.svg                        Activity bar 아이콘 (3-circle Venn)
│   └── logo.svg                        브랜드 로고
└── package.json                        Extension manifest
```

---

## 🔄 데이터 흐름

```
[사용자 입력 (webview/chat.html textarea)]
  → postMessage({type:'send'})
  → OrchestrAIViewProvider._handleSend()  [extension.ts:1843]
  → Orchestrator.route()                   [router/orchestrator.ts:112]
       ├─ override(force) 있으면 즉시 반환
       ├─ @mention 있으면 모델 강제
       ├─ patternRouter.patternRoute()    confidence ≥ threshold면 종료
       └─ llmRouter.llmRoute()            Haiku로 결정
  → callClaude/callCodex/callGemini       [providers/*]
       ↓ 스트리밍 청크
  → onChunk() → this._post({type:'streamChunk'})
  → webview의 appendChunk(id, chunk)
  → 완료 시 saveChatStorage()              [extension.ts:112]
       → globalStorage/chats/{sha1(workspacePath)}.json
```

---

## 🎯 라우팅 모드 (override-bar 6종)

| 모드 | 동작 | 코드 위치 |
|------|------|----------|
| `auto` | pattern → llm 순 자동 결정 | orchestrator.ts:112 |
| `claude` | Claude 강제 | orchestrator.ts:113 |
| `codex` | Codex 강제 | 〃 |
| `gemini` | Gemini 강제 | 〃 |
| `argue` | 모든 로그인된 모델이 라운드 로빈 반박/보완, Haiku가 0~10점 채점 | extension.ts:1884 |
| `team` | Claude=설계, Codex=구현, Gemini=리뷰 (MCP 툴로 위임) | extension.ts:1958, team/teamMcp.ts |

---

## 🔐 인증 경로 (전부 구독·무료, API 과금 X)

- **Claude**: 로컬 `claude` CLI의 OAuth 토큰 재사용 → Claude Agent SDK가 자동 감지 (`ANTHROPIC_API_KEY` 환경변수 있으면 끔)
- **Codex**: 직접 PKCE OAuth → `chatgpt.com/backend-api/codex/responses` 직접 호출. Originator/User-Agent 헤더 진짜 CLI fingerprint 흉내 필수
- **Gemini**: 로컬 `gemini` CLI의 OAuth → ai-sdk-provider-gemini-cli ESM import
- **Gemini API key** (이미지 생성 전용): `orchestrai.geminiApiKey` 설정에 저장, 텍스트엔 안 씀

---

## 💾 영속 저장소

```
${globalStorage}/                       ~/AppData/Roaming/Code/User/globalStorage/samkj.orchestrai/
├── chats/
│   └── {sha1(workspacePath)}.json      워크스페이스별 대화 (현재 활성)
├── archives/
│   └── {sha1}_{timestamp}.json         삭제·복원 시 백업
├── registry/                            (telegram 멀티 인스턴스용)
│   ├── instances/{id}.json              살아있는 VSCode 인스턴스
│   ├── target.json                     활성 워커 (hub가 보낼 곳)
│   └── topics.json                     telegram topic_id ↔ workspace 맵
└── (config는 VSCode settings.json에)
```

**키 정규화**: Windows에서 같은 폴더라도 URI 인코딩이 달라 sha1이 어긋날 수 있어 `chatStateKey()`에서 lowercase + trailing slash 제거. 그래도 못 찾으면 `findMostRecentChat()` 폴백.

---

## 🛠️ "이거 고치려면 어디?" 인덱스

### 라우팅 결정 안 맞을 때
- **패턴 매칭 추가/수정** → `src/router/patternRouter.ts` `RULES` 배열
- **effort 추론 (low/medium/high)** → `src/router/orchestrator.ts:70` `inferEffort()`
- **LLM 라우터 프롬프트** → `src/router/llmRouter.ts:30`
- **모델별 confidence 기준** → `extension.ts` 에서 `confidenceThreshold` 설정

### UI 변경
- **입력창 placeholder/힌트** → `webview/chat.html:1901` (textarea), `:1906-1908` (hint chips)
- **override-bar 모드 버튼** → `webview/chat.html:1882-1887`
- **mode-popup (ask/auto-edit/plan/smart-auto)** → `webview/chat.html:1929-1976`
- **settings 모달 항목** → `webview/chat.html:1798-1870`
- **메시지 버블 렌더** → `webview/chat.html:2929` (`beginStreamBubble`)
- **툴 박스 표시** → `webview/chat.html` `formatToolCall` 마크다운 변환부, `claudeProvider.ts:54` `formatToolCall()`
- **변경 카드/diff** → `webview/chat.html:2115-2150` (`renderChangePanel`/`renderDiff`)

### 모델 호출 동작
- **Claude 시스템 프롬프트** → `extension.ts:563` `buildSystemPrompt()` (mode별, team role별 다 여기)
- **Claude 모델 매핑 (effort→ID)** → `providers/claudeProvider.ts:9` `MODEL_BY_EFFORT`
- **Codex 모델/엔드포인트** → `providers/codexProvider.ts:8-19`
- **Gemini 모델/폴백** → `providers/geminiProvider.ts:10-15`
- **이미지 생성** → `providers/geminiImageProvider.ts`

### 대화 저장/복원
- **저장 키 생성** → `extension.ts:31` `chatStateKey()`
- **로드 + 폴백** → `extension.ts:88` `loadChatStorage()`
- **저장** → `extension.ts:112` `saveChatStorage()`
- **archive/restore** → `extension.ts:1051-1142`
- **rehydrateMessages (UI 복원)** → `webview/chat.html:2670`

### MCP 서버
- **MCP 매니저** → `extension.ts:401` `McpManager` 클래스
- **MCP 설정 (사용자)** → `package.json` 의 `orchestrai.mcpServers` 또는 settings.json
- **MCP 툴 호출** → `extension.ts:328` `executeCodexTool()` 안 `mcp` 케이스

### 컨텍스트 압축
- **압축 트리거** → `util/compaction.ts:60` `shouldCompact()`
- **압축 실행** → `util/compaction.ts:76` `compactMessages()` (Haiku로 요약)
- **모델별 트리밍** → `util/history.ts:33` `buildTaggedHistory()`

### Telegram 브릿지
- **Hub/Worker 결정** → `telegram/bridge.ts:42` `TelegramBridge.start()`
- **명령 파싱** → `telegram/bridge.ts` 안 `handleCommand()`
- **워크스페이스 ↔ topic 매핑** → `telegram/registry.ts:74` `workspaceTopicKey()`

### Kill Switch (STOP 버튼)
- **버튼 UI** → `webview/chat.html:1778` `gen-stop`
- **백엔드 abort** → `extension.ts:1298` `case 'stopGeneration'`, `_currentAbort.abort()`
- **각 provider의 abortSignal** → `providers/*Provider.ts` 의 `abortSignal` 파라미터

---

## 🎨 UI 상태 (webview)

```
┌─────────────────────────────────┐
│ header (logo + Review/Usage/Clear)│
├─────────────────────────────────┤
│ ctx-gauge (memory 토큰 게이지)    │
├─────────────────────────────────┤
│ argue-board (argue 모드 점수표) │ ← 평소 display:none
├─────────────────────────────────┤
│ model-filter-bar (all/Claude/..)│
├─────────────────────────────────┤
│ messages (대화 영역, flex:1)    │
├─────────────────────────────────┤
│ review-bar (변경 요약)          │ ← 변경 있을 때만
├─────────────────────────────────┤
│ input-area                      │
│  ├ override-bar (force buttons) │
│  ├ ctx-btn (현재 파일 토글)     │
│  └ input-wrap                   │
│     ├ textarea                  │
│     ├ hint-chips                │
│     ├ mode-btn (popup trigger)  │
│     └ send-btn                  │
└─────────────────────────────────┘
```

오버레이 (z-index 250+): `usage-overlay`, `settings-overlay`, `mode-popup`, `vibe-modal` (동적), `compaction-notice` (sticky).

---

## ⚙️ Build & Install

```bash
npm run build          # esbuild → dist/extension.js (single bundle)
npm run package        # vsce package → orchestrai.vsix
code --install-extension orchestrai.vsix --force
```

핵심 externals (esbuild 안 묶음, node_modules 통째로 들어감):
- `vscode`
- `@anthropic-ai/claude-agent-sdk`
- `ai`, `ai-sdk-provider-gemini-cli`, `@google/gemini-cli-core`
- `zod`

---

## 🚨 알려진 함정

- **한글 인코딩**: chat.html / extension.ts 한글 주석/문자열은 반드시 UTF-8 저장. cp949·utf-16 변환되면 `</div>` 같은 닫힘 태그까지 깨져서 webview 통째로 죽음 (실제로 코덱스가 1번 깨뜨려서 입력창 사라진 적 있음).
- **ANTHROPIC_API_KEY 환경변수 금지**: 켜져 있으면 SDK가 API 과금 경로로 빠져 Max 구독 안 씀. claudeProvider에서 강제 throw.
- **Codex 헤더 fingerprint**: `originator: codex_cli_rs`, User-Agent에 `codex_cli_rs/0.40.0` 안 들어가면 OpenAI가 401/403 반환.
- **Gemini ai-sdk ESM**: esbuild가 `require()`로 변환하면 깨짐. `Function('return import(arguments[0])')` 트릭으로 dynamic import 보존.
- **ripgrep 바이너리**: claude-agent-sdk가 Read/Grep/Glob 위해 필요. `.vscodeignore`에서 제외하면 안 됨.
- **webview 100vh**: VSCode webview에서 일부 환경에서 작아질 수 있음. body는 `flex column + overflow:hidden`.
