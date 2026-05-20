# Changelog

## v0.1.40 — 2026-05-21 (marketplace 업데이트 배지)

새 marketplace 버전이 publish 되면 헤더의 OrchestrAI 옆에 초록색 `↑ v0.1.41` 같은 배지가 자동으로 뜸. 클릭하면 마켓플레이스 페이지가 열려서 1클릭으로 업데이트 가능.

- **폴링:** activate 5s 후 1회 + 24h interval. GitHub releases latest API 사용 (인증 없음, rate limit 충분).
- **캐시:** `globalState` 에 결과 저장 → 오프라인 시 직전 값 사용 + reload 즉시 배지 복원 (network fetch 안 기다림).
- **클릭 동작:** VSCode 내장 `extension.open samkj.orchestrai` → 사용자가 Update 버튼 명시 클릭. 자동 install 강제 안 함 (권한 안전).
- 신규 파일: `src/util/updateChecker.ts` + 8 회귀 tests.

Tests: 228 → 236 (+8).

## v0.1.39 — 2026-05-20 (Codex cache 진짜로 잡힘 + Usage 영속화 + 절약 체감 + 토론 연장)

### Codex prompt cache 본격 작동 (v0.1.37 버그 fix)
v0.1.37 에서 Static/Dynamic 분리 박았지만 codex cache 가 여전히 0 으로만 표시되던 문제 진단:

1. **dynamicContext 가 input[0] 앞에 prepend 됨** → OpenAI cache prefix 는 `instructions + input[0]` 부터 hash 라서 collabHint 같은 라운드별 변동분이 prefix 깨뜨림
   - fix: dynamicContext 를 **마지막 user msg 직전** 으로 이동 → 사용자 원본 질문이 input 앞쪽 안정
2. **`_runCodexAgent` / `_runGeminiAgent` 의 cache 토큰 누락** — tool loop 안에서 callCodex 결과의 cacheReadInputTokens 를 누적·return 안 함 → UI 표시 0
   - fix: cacheReadAccum / cacheCreationAccum 누적 + return 객체에 포함
3. **argue 모드에서 fileCtx 가 매 라운드 prefix 깨뜨림** — 출력 채널 같은 active editor 가 라운드마다 길어지면 dynamicContext 안의 fileCtx 도 매번 달라짐
   - fix: argue 모드에선 fileCtx 무시 (채팅 토론이라 파일 컨텍스트 불필요)

결과: R2/R5 모두 `cached_tokens: 1792` 잡힘. argue UI 의 codex `⚡` 칸이 0 → 1,792 로 정상 표시.

### Usage 영속화 — Reload 해도 토큰 카드 살아있음
이전엔 reload 마다 토큰 사용량 0 으로 리셋됨. fix:
- `UsageTracker.attachStorage(globalState)` — record() 시 200ms debounce 자동 영속화
- `_pushWebviewState` 가 reload 후 자동으로 usage push (이전엔 requestUsage 명시 요청해야만)

### 💰 절약 효과 카드
argue 종료 카드에 비용 절감 추정 추가:
- 실제 비용 (with cache) vs 가상 비용 (no cache) → 절약 % 표시
- Claude Pro 5h 한도 (~45 msg) 중 사용량 추정

### 라운드 제한 설정 노출
이전: argue=6 / team=4 하드코딩 → settings 로 변경 가능:
- `orchestrai.argueMaxRounds` (2~30, default 6)
- `orchestrai.argueContinueRounds` (1~12, default 3) — "이어서 토론" 클릭 시 추가 라운드
- `orchestrai.teamMaxRounds` (1~15, default 4)

### ➕ "이어서 토론" 버튼
argue 종료 카드에 버튼 추가. 클릭 시 직전 라운드들의 summaries 그대로 인계 + `argueContinueRounds` 만큼 추가 라운드. 새 argue 시작이 아니라 **컨텍스트 보존 연장**.

### Tests: 228 passing (회귀 0)

## v0.1.38 — 2026-05-18 (docs only — Marketplace listing 시연 영상 섬네일)

VSCode Marketplace 는 README 의 `<video>` 태그도 `https://github.com/user-attachments/...` 자동 임베드도 strip 함 (이미지만 허용). v0.1.37 publish 후 marketplace listing 의 demo 섹션이 빈 채로 보이는 문제를 해결.

- `resources/demo-thumb.png` — 동영상 5초 지점 720p 프레임 추출 (264KB)
- README 섬네일 클릭 → GitHub release asset (원본 mp4) 새 탭 재생
- github.com 메인 페이지엔 user-attachments inline player 도 그대로 유지
- 코드 변경 0, README/리소스만

## v0.1.37 — 2026-05-18 (Codex 도 Static/Dynamic 분리 → OpenAI 자동 prompt cache hit)

### Codex Static/Dynamic 분리 (v0.1.36 의 Gemini-only 분리를 Codex 까지 확장)

argue/team 실험에서 Claude 캐시는 잘 잡혔는데 Codex 캐시 read 가 0 으로 찍혀서 원인 분석. OpenAI Responses API auto cache 는 strict prefix match (1024+ tok 동일 prefix, 5분 윈도우) 인데 `instructions` 필드에 `collabHint` 같은 per-turn 변동분이 섞이면 prefix 가 매번 달라져서 hit 안 됨.

해결:
- **`codexProvider.callCodex(staticPrompt?, dynamicContext?)`** — staticPrompt 가 들어오면 `instructions = staticPrompt` 만 (안정), `dynamicContext` 는 input 첫 항목 앞에 `<context>` 래퍼 user msg 로 prepend
- **`_runCodexAgent(staticPrompt?, dynamicContext?)`** — native MCP 경로에서 `baseInstructions = staticPrompt`, prompt 첫 부분에 `<context>` 래퍼 prepend. legacy 폴백도 동일 인자 forward
- 메인 dispatch (단일 turn) 가 `staticPrompt, fullDynamic` 그대로 전달 → 이제 Gemini/Codex 둘 다 cache 친화 prefix
- boomerang / multi-model review 등 단발성 호출은 optional 미사용 (backward compat) — sys prompt 가 호출마다 다르니 cache 효과 어차피 0

기대 효과: argue 라운드 사이 system prompt 2k tok prefix 가 안정 → 2회차부터 OpenAI cached input price (~50%) 적용. Codex 사용량 토큰 표시도 native MCP engine 에 token meta 노출되면 실측 가능.

### Tests: 228 passing (변경 없음 — 인자가 optional 이라 회귀 0)

## v0.1.36 — 2026-05-18 (Static/Dynamic 캐시 분리 + /style 슬래시 + team mode 실험 결과)

### Static/Dynamic 섬 분리 (Gemini Context Cache hit rate 90%+ 목표)
team mode 로 자기 자신을 개선하는 실험. 결과: Codex (legacy SSE) 가 한자 spam + fake JSON-RPC fragment 출력 사고 (메모리 `feedback_codex_delegation_hazards.md` 그대로 재현), Gemini 도 가짜 파일 (`src/prompts/systemPrompt.ts` 같은 거 없음) 만들어내고. Claude orchestrator 가 결국 직접 Edit tool 로 패치.

기능 자체는 잘 들어감:
- **`buildStaticPrompt(model, mode, mcpTools, teamRole)`** — cache hash 의 stable 한 부분만. 파일 바뀌어도 hit
- **`buildDynamicContext(ctx, projection, collabHint, argueCap)`** — file context / argue / RAG → history 첫 항목 앞에 prepend
- `_tryGeminiCachedCall(staticPrompt?, dynamicContext?)` — cache 키는 static, dynamic 은 `<context>` 래퍼로 messages 에 prepend
- non-Gemini-cached (Claude/Codex/custom) 는 `staticPrompt + fullDynamic` combined 그대로 → backward compat 100%

기대 효과: argue/team 다중 호출에서 sys prompt 2,170 tok 가 첫 호출만 풀 비용 + 이후 cache_read (~25% 단가). hit rate 90%+ 가능 (파일 바뀐다고 cache miss 안 됨).

### /style slash command — 모델 응답 스타일 분석 카드
사용자 입력 `/style` 또는 `/stats` → 활성 chat 의 assistant 메시지 스캔 → 모델별 통계 비교 카드.

- **지표**: 평균 길이·줄수, 코드 블록 포함률, 이모지/헤더/리스트 빈도 (1k char 당), 정중함 score (한·영 "요·습니다·감사·please·sorry" 신호), 한·영 비율 (코드 제외 본문 기준), top 시작 phrase
- **이모지 매칭**: `\p{Extended_Pictographic}` Unicode property — true emoji 만 (✓ 같은 일반 symbol 제외)
- **i18n** 완전 지원 (한·영 카드 컬럼/legend)
- **`/style all`** 옵션 — 모든 chat 통합 분석
- `src/util/styleAnalytics.ts` (순수 함수, 의존성 0) + 12 회귀 tests

### 메모리 검증 (이번 실험으로)
- `feedback_codex_delegation_hazards.md` 의 "한자 spam + fake JSON" 사고 패턴 재현됨 — Codex legacy 위임 시 진단 어려운 silent fail
- Gemini consult 의 file fetch 한계 — 실제 코드 못 보고 hallucinate. consult 시 prompt 에 raw 코드 전달 필수
- Team mode 의 위임 효율 = 0% (이번 케이스). Claude orchestrator 가 결국 다 함. 단 사용자가 결과 검증할 수 있다는 점에서 일반 chat 보다 진단 도구로 가치 있음.

### Tests: 216 → 228 (+12)
styleAnalytics 회귀: 빈 입력, 모델별 분리, 코드 비율, 이모지 카운트, 정중함 한·영, 한·영 비율, top start phrase, 헤더·리스트, scope echo, custom: 모델 포함.

## v0.1.35 — 2026-05-18 (i18n Phase 3 — hover tooltips + dynamic content 마무리)

사용자 보고: "각 모드들 호버메시지 마우스 갖다대면 설명 뜨는거 다 한글로만 나오는데". v0.1.33/34 에서 핵심 라벨은 잡았지만 `title=` 속성 (hover tooltip) 들이 sweep 안 됐던 문제.

### 호버 tooltip / title 속성 i18n
- **override-bar 모드 버튼**: `argue / team / loop / boomerang` 의 title 다 영문/한국어
- **route dropdown**: `✦ auto` tooltip
- **컨텍스트 윈도우 segment**: `narrow / default / wide / full` 각각 모드별 설명
- **Codex 엔진 segment**: `native / legacy`
- **⚙ 톱니 / 📄 ctx-btn / mode-btn / 음성 입력 / memory 게이지 / ■ 중단 버튼**
- **mcp 삭제 ×** / **bg-task 취소 ✕** / **chat 탭 hover (닫기/포크)** / **commit chip "↶ 이 턴 되돌리기"**

### Dynamic content 마무리
- **변경 파일 카드**: `↗ 파일 열기 / ≡ diff 보기 / ↶ 이 파일만 되돌리기 / ↶ 이 turn 다 되돌리기 / ↗ 전부 열기` 다 영어
- **commit revert confirm 다이얼로그**: `이 턴 작업을 되돌리고 이전 상태로 reset 하시겠어요?` 한·영
- **MCP 빈 리스트** `등록된 MCP 서버 없음.` → `No MCP servers registered.`
- **로컬 LLM probe 실패** `로컬 LLM 서버 발견 안 됨 — Ollama (port 11434) 또는 LM Studio (port 1234) 실행 중인지 확인`
- **custom provider 활성 토글** `gemma4 (model) 활성` → `gemma4 (model) active`
- **Gemini API key saved placeholder** `(저장됨 — 새 값 입력 시 덮어쓰기)`
- **input hint chips** `리팩토링 / git / 설명` → `Refactor / git / Explain` + 클릭 시 영어 prompt 자동 채움
- **모델 변종 select** `auto (effort 따라)` × 3 (Claude/Codex/Gemini) → `auto (by effort)`
- **Custom Provider 폼**: 이름 / URL / 모델 ID / API Key / 저장 / 취소 / "🔍 로컬 LLM 자동 감지" / "+ 수동 추가"

### 추가된 strings.ts 키
~25 개 — hover tooltip + custom provider 폼 + dynamic 라벨.

### 결과
i18n 가 사용자 보는 거의 모든 텍스트 커버. 남은 한국어:
- `extension.ts` 의 `vscode.window.show*Message` 들 (인덱싱·텔레그램·복원 모달 — 가끔 보임)
- 일부 발화 시 한국어 (debug 로그 — 개발자용)
- system prompt (LLM 한테 보내는 instructions — 의도된 유지)

Tests: 216 통과.

## v0.1.34 — 2026-05-18 (i18n Phase 2 — dynamic 영역 적용)

v0.1.33 의 static 영역 (환경설정 패널 / 탭 UI / fork 버튼) 에 이어 dynamic content 들에 i18n 적용. 매 호출마다 보이는 라우팅 배지·영수증·argue 카드·Usage 패널 다 한·영 둘 다.

### 추가된 i18n 영역
- **Account & Usage 패널**: 카드 헤더, 요청 카운트, 절약 추정 라인, cache 컬럼 헤더, footer note · cache legend (영문 단가 설명)
- **argue 카드 / 판정 보드**: 보드 제목 ("argue 판정 (Claude Haiku) · 0~10점" ↔ "argue verdict (Claude Haiku) · 0~10 score"), "채점중..." ↔ "scoring...", 모델 헤더, 라운드 토큰 표시 (R{round} {model}), totals 카드의 "가장 길게 답함" · "총 N 라운드" · cache 요약 (Claude prompt / cache 생성 / Gemini cached)
- **judge verdict**: `<b>판정:</b>` ↔ `<b>verdict:</b>`
- **라우팅 배지**: `↪ codex에 22msg · ~3,077tok` ↔ `↪ to codex · 22 msgs · ~3,077 tok`
- **컨텍스트 번들 배지**: `⊟ balanced · bug_fix · ActiveSymbol` (mode/intent/level 그대로, ContextLevel 이름만 i18n)
- **Gemini cache 배지**: HIT/NEW + tooltip "cached X tok (재전송 X) + dynamic Y tok 만 전송" ↔ 영문
- **argue 요약 hint**: "⊟ R3 gemini 요약 중..." ↔ "⊟ R3 gemini summarizing..."
- **token receipt short** (backend `formatReceiptShort`): "OrchestrAI Balanced: 84% saved (18,400 → 3,200 tok)" 의 "saved" 부분 영문 그대로지만 dict 통한 포맷

### 추가된 strings.ts 키
~30 개 — usage_* (12), argue_* (10), context_* / receipt_* / gemini_cache_* / routing_to_model (8). 점점 누적 중.

### 남은 곳 (Phase 3 후보)
- extension 측 `vscode.window.show*Message` 들 (Telegram 연결, 인덱싱 진행, 복원 모달 등 — 가끔 보임)
- 일부 dynamic toast / 에러 메시지 (자주 안 보임)

Tests: 216 통과.

## v0.1.33 — 2026-05-18 (i18n — 한국어/영어 다국어 지원)

사용자 요청: "UI, 호버, 여기저기에 한글들 죄다 i18n 으로 다국어 가능 확장으로". 영어로도 쓸 수 있게.

### i18n 인프라
- **`src/i18n/strings.ts`** — `{ ko, en }` 한 곳에 모든 UI 키. 의존성 X
- **`src/i18n/index.ts`** — `t(key, replacements?)` + `getLocale()` 자동 감지 (`vscode.env.language` 한국어 → ko, 그 외 → en)
- **`orchestrai.language` setting** — `auto / ko / en`. default `auto`
- extension `_getHtml()` 가 active locale dict 를 `window.I18N` 으로 inject → webview 가 그걸 보고 일괄 sweep
- webview 의 `applyI18n()` 헬퍼: `data-i18n="key"`, `data-i18n-title="key"`, `data-i18n-placeholder="key"` 속성 박힌 모든 element 페이지 로드 시 active locale 로 자동 교체
- webview JS 안 dynamic content 는 `T('key', { name, n })` 함수로

### 적용 범위 (Phase 1 — 가장 자주 보이는 영역)
- **환경설정 패널 전체**: 모든 section title + 토글 라벨 + tooltip + hint + 버튼 (`prefs_*` 키 ~50개)
- **🌐 Language 섹션** 추가 (auto / 한국어 / English 토글)
- **탭 (multi-chat) UI**: 탭 닫기 / 새 탭 / 우클릭 메뉴 (이름 변경 / 복제 / 닫기) / fork tooltip / 포크 메시지
- **fork 버튼**: assistant 메시지의 `⑂ fork` 버튼 + tooltip
- **input placeholder**: "무엇을 만들까요..." / "What shall we build..."
- **Full Context 경고 모달**: 한국어/영어 둘 다
- **주요 toast**: API key 저장 / MCP 저장·삭제 / steering / 포크 / fork target 못 찾음 등

### Phase 2 (다음 patch)
- 라우팅 배지 / argue 카드 / 토큰 영수증 / Account & Usage 패널 dynamic content
- extension.ts 의 `vscode.window.show*Message` 들

### 동작
- 처음 켤 때 — VSCode 가 한국어면 한국어 UI, 영어면 영어 UI 자동
- ⚙ → 🌐 Language 섹션에서 `auto / ko / en` 토글 — 변경 즉시 webview reload → 새 locale 적용
- system prompt (LLM 한테 보내는 instructions) 는 **한국어 그대로 유지** (LLM 한국어 능숙 + token budget 영향 X)

## v0.1.32 — 2026-05-18 (Multi-chat 탭 + 포크 (분기) + Codex MCP / SSE cache 토큰 + 라우터 fix)

사용자 요청: "탭 기능은 언제 만들거냐 ㅋㅋ 포크하는것도 있음 좋을거같은데". v0.1.31 추가 hotfix 4건 (라우터·캐시·prefs 패널) 묶음.

### Multi-chat 탭 (v0.1.32 핵심)
- **헤더 아래 새 탭 줄** — 가로 스크롤, active highlight, `+` 새 탭
- **storage v2 마이그레이션**: 옛 단일 `{messages, compaction}` 발견 시 자동 "메인" 탭 1개로 변환. 데이터 손실 0
- **워크스페이스당 무제한 탭** — 각각 독립된 messages·compaction. 활성 탭 전환은 instant
- **provider `_messages` 41군데 그대로** — getter/setter 가 active chat 으로 redirect (deep refactor 안 했음)
- **새 메시지 핸들러**: `switchChat` / `newChat` / `forkChat` / `closeChat` / `renameChat` / `requestTabs`

### 포크 (분기) — 다른 방향 탐색
- assistant 메시지 우상단에 `⑂ fork` 버튼 (`copy` 옆)
- 클릭 → 그 메시지까지의 history 전체 복사 + 새 탭 자동 활성화
- 새 탭 title 자동: `⑂ <마지막 user msg 첫 20자>`
- `branchedFrom: { parentChatId, atMessageId }` 메타 보존 — 탭에 `⑂` 아이콘 표시. 추후 "원본 점프" 추가 가능

### 탭 UX 디테일
- 우클릭 컨텍스트 메뉴: 이름 변경 / 복제 (마지막 메시지에서 fork) / 닫기
- 마지막 탭은 닫기 X (휴지통으로 비우기만)
- 활성 탭이 닫히면 가장 최근 updatedAt 탭으로 자동 전환
- 탭 진행 중 다른 탭으로 switch → 현재 호출 abort (다른 탭에 응답 누락 방지)

### 라우터 (inferEffort) 거꾸로 사고 fix
사용자 발견: "안녕?" → effort=medium (full 모델), "100글자 시 써봐" → effort=low (mini 모델). 거꾸로!

- 짧은 인사 (`안녕|하이|헬로|ㅎㅇ|hi|hello`) → 우선순위 low (typo 보다 먼저)
- 창작 글쓰기 (`시·소설·에세이·편지·노래·대본·시나리오·동시·일기` 명사 + `써봐·써줘·작성·지어` 동사 한 prompt 안에) → high
- 영어 `\b(write|compose|draft|author)\b.{0,40}\b(poem|story|essay|...)\b` → high

### Cache 토큰 진단·표시 보강
- **Codex MCP (native)**: result 전체 + progress notifications 재귀 탐색 (deepFindUsage, 6 depth). `_meta` / `meta` / `structuredContent.usage` / OpenAI 형식 `prompt_tokens_details.cached_tokens` 등 모든 후보 키 자동 탐색. **codex.exe MCP server v0.131.0-alpha.9 는 토큰 노출 X 확정** (첫 호출 raw dump 로 검증). 노출 시작하면 자동 잡힘
- **Codex legacy (SSE)**: `response.usage.input_tokens_details.cached_tokens` 추출. gpt-5.4 류 자동 prompt cache hit 까지 정확 표시
- **Claude SDK**: `cache_read_input_tokens` / `cache_creation_input_tokens` 추적 (v0.1.30 fix 확장 — argueTurnTokens 까지 흐름)

### Account & Usage 패널 cache 줄
- ⚡ cache_read / ↑ cache_write / 📦 cached_in 3 컬럼 (있을 때만)
- input 라인: `in 6 + cache 36.7k = 36.7k` 처럼 처리량 vs 새 input 분리
- 절약 추정 $ 도 cache 단가 반영 (cache_read 10%, cache_write 1.25x, Gemini cached 25%)

### 환경설정 패널 헤더에 버전 표시
- `⚙ 환경설정 v0.1.32` 헤더에 큰 글씨로. 풋터에도 같이

### Tests
216 통과. patternRouter +12 (인사 low, 창작 high 회귀).

## v0.1.31 — 2026-05-13 (모든 설정을 환경설정 패널 안에서 — QuickPick 우회)

사용자 지적: "다 빠른엑세스에서 설정하지않고 설정창같이 별도창에서 설정하고 넣고 하며 좋겠는데" / "MCP같은경우 누르면 빠른엑세스로 넘어감 ㅡㅡ"

⚙ 톱니 클릭 → 중간 메뉴 (settings-overlay) → VSCode QuickPick 으로 빠져나가는 흐름이 vibe-coder 한테 거슬림. 한 곳에서 다 처리하게 통합.

### ⚙ 톱니 = 환경설정 패널 바로 열기
- 중간 settings-overlay 메뉴 우회 — 톱니 한 번 누르면 prefs-overlay 즉시 표시
- prefs-overlay 안에 모든 기능 통합

### 🔐 계정 섹션 (인라인)
- Claude / Codex / Gemini login·logout 버튼이 패널 안에서 직접 동작 (QuickPick X)
- 각 모델 옆에 connected/disconnected 상태 + 로그인/로그아웃 라벨 자동 토글
- Gemini API key 입력 textfield + 저장 버튼 — VSCode InputBox 안 띄움. 이미지 생성 + Context Cache 용
- authStatus 변경 즉시 라벨 갱신

### 🔌 MCP 서버 섹션 (인라인)
- 등록된 server 리스트 표시 (이름 + command/args 한 줄 미리보기)
- 각 항목 × 버튼 — **2-click 확인 패턴** (VSCode webview confirm() 차단 우회)
- "+ MCP 서버 추가" 클릭 → inline form 펴짐: 이름 / command / args (textarea 한 줄에 하나) / env (KEY=VAL 한 줄에 하나)
- 저장 시 `orchestrai.mcpServers` 설정 직접 업데이트, 즉시 prefs 다시 push → 리스트 갱신

### 🗄 기타 섹션
- Telegram / 아카이브 복원 / 아카이브 폴더 열기 / 로그 표시 / 세션 카운터 리셋
- 이 항목들은 OS 다이얼로그·OUTPUT 패널 같은 진짜 OS 액션이라 backend 호출 그대로 (QuickPick 아님)
- 추후 Telegram 도 인라인 폼으로 통합 예정

### Backend
- 새 메시지 핸들러: `accountAction` (login/logout) / `setGeminiApiKey` / `mcpUpsert` / `mcpDelete`
- `_pushPrefs()` 헬퍼 — prefs payload 한 곳에서 일관 push. mcpServers + geminiApiKey 존재 여부 포함
- setPref 가 captain/active/custom 변경 시 _pushPrefs 경유 (중복 제거)

## v0.1.30 — 2026-05-13 (Cache token 정직성 + Codex MCP 실토큰 시도 + Prefs 패널 토글)

v0.1.29 의 영수증이 "구라" 아니냐는 사용자 지적에 대응. 산수는 맞았지만 provider 마다 보고 방식이 다른 게 라벨링에서 안 드러남.

### Claude SDK 자동 prompt cache 토큰 표시
- claudeProvider 가 `cache_read_input_tokens` / `cache_creation_input_tokens` 도 반환. UsageTracker.record 가 extras 인자로 같이 누적
- argue 라운드 줄에 `(+cache_read 4,150)` 표시 — Claude 의 `in=3` 이 misleading 이었던 이유 명시
- argue 종료 카드: `⚡ Claude prompt cache: 4,150 tok 재사용 (청구 X 처리됨)` 한 줄 추가
- 로그: `done: in=3 (new) + 4150 (cache_read) + 0 (cache_create) = 4153 processed, out=46`

### Gemini Context Cache 토큰도 같은 경로 통합
- `_tryGeminiCachedCall` 결과의 `cachedInputTokens` 가 UsageTracker → ArgueTotals → UI 까지 흐름
- argue 줄: `(cached 2,170 ~25%)` 표시

### Codex MCP 실토큰 시도
- codexMcpClient 가 result 의 `_meta` / `meta` / `structuredContent.usage` / `usage` 등 표준 후보 위치 모두 탐색
- 발견하면 실측 사용, 못 찾으면 **한국어 인지 휴리스틱** fallback (한글 1tok/char, 그 외 4char/tok) — 영어 일변도였던 v0.1.29 의 4-char-per-token 보다 한국어에서 정확
- 로그: `usage from MCP: in=X, out=Y` 또는 `usage estimated (no MCP meta): in=X, out=Y`

### 환경설정 패널에 토글 추가 (settings.json 직접 안 만져도 됨)
- 새 섹션 **🔢 토큰 절약**:
  - `Token-aware context projection` 체크박스 (default on)
  - `Gemini Context Cache (API key 필요)` 체크박스 (default off)
- 컨텍스트 윈도우 segmented 에 `full` 추가 — `⚠ Full: 전 워크스페이스. 매 요청 확인 모달. OAuth/API 쿼터 폭주 위험.` tooltip

### Tests
202 → 204 (+2). usage(cache 누적 read/creation/cachedInput).

## v0.1.29 — 2026-05-13 (Token-aware context + Argue 폭주 fix + Gemini Context Cache + 누적 hotfix)

큰 묶음. v0.1.28 publish 이후 누적된 hotfix 4건 + directive 기반 Phase 1 (token budgeting) + Argue 토큰 폭주 패치 + Phase 3 (Gemini Context Cache) 까지.

### Token-Aware Multi-Model Orchestration (directive Phase 1)
멀티모델 = 토큰 N배 곱셈 → 모델별 최소 컨텍스트 라우팅으로 전환.

- **TokenMode**: `orchestrai.contextWindow` 가 이제 토큰 예산 모드 = narrow→Eco / default→Balanced / wide→Deep / **full→Full Context (매 요청 명시 확인)**
- **ContextLevel ladder**: SelectionOnly → ActiveSymbol → ActiveFileFocused → RelatedFiles → ProjectSummaryPlusDiff → FullContextExplicit. intent 와 mode 가 함께 결정
- **Intent classifier** (heuristic): explain / bug_fix / implement / refactor / write_tests / review_diff / architecture / debug_runtime_error / dependency_issue / security_review / performance_review / documentation / general_chat 14종
- **ContextBundle**: 활성 파일 통째 X — selection / focused snippet (정규식 enclosing function 추출) / file head summary / git diff 만 선별
- **Model-specific projection**: Claude/Codex (expensive expert) 는 좁게 (fileSummary 제외), Gemini 는 넓게 (long-context)
- **Secret scanner**: `.env`, `*.pem`, `id_rsa`, API key prefix 자동 차단 + 경고
- **TokenReceipt** 영수증: 매 요청 후 한 줄 — `OrchestrAI Balanced: 84% saved (18,400 → 3,200 tok)`. 클릭 시 detail (어떤 섹션 / 어떤 파일) 클립보드 복사
- **baseline 계산 정확성**: userQuestion 은 baseline 에서 제외 (message 로 가지 context block 아님). 활성 파일 없으면 영수증 자체 skip — false savings 0
- **새 setting**: `orchestrai.tokenBudget.enabled` (default true). false 면 v0.1.28 이전 동작

### Argue Mode 토큰 폭주 fix
Gemini 가 라운드당 3,000-4,000 tok 출력 + raw history 누적 → argue 6라운드 input 20k+ 사고.

- **Output cap (system prompt 명시)**: Eco 400 / Balanced 700 / Deep 1,200 / Full 2,000 한국어 char. Gemini 면 추가 압박 (`[Gemini-specific] You tend to be verbose. ONE focused paragraph only.`)
- **Compact summary chain**: 각 라운드 응답을 Haiku captain 으로 ~150자 압축 → 다음 라운드 history 는 `[userMsg, ...summaries]` (raw 응답 누적 0)
- **Judge 도 summary 만**: judge 한테도 raw 응답 X, summary 만 보냄 → judge token 도 차단
- **Per-round token tracking**: `R3 gemini: in 1,200 / out 850 tok` 한 줄 라이브
- **Argue 종료 카드**: 총 라운드/input/output/total + 가장 길게 답한 모델 (주황 강조) + 모델별 row
- **TokenReceipt / judge text 는 절대 다음 라운드 context 로 forward X** — projection / receipt 는 webview 전용, 모델에 안 전달

### Gemini API Context Cache (directive Phase 3)
큰 static (system prompt) 을 Gemini API 에 한 번 올리고 매 요청은 dynamic 만 전송. 캐시된 input ~25% 단가.

- `geminiCacheManager.ts`: `ensureGeminiCache` (sha1 hash key, TTL 10분, LRU 8 entries) + `callGeminiCached` (REST `:streamGenerateContent?alt=sse`, `cachedContent` 참조)
- Min token gate: Flash 1024, Pro 4096 (Gemini API 거절 방지)
- `_runGeminiAgent` 시작 부분에서 cache path 시도 → 실패 시 OAuth + ai-sdk 로 자연 fallback
- 새 setting: `orchestrai.geminiContextCache.enabled` (default **false** — opt-in. apiKey 등록 필요)
- UI badge: `⚡ Gemini cache ✓ HIT · gemini-2.5-flash` + tooltip 에 `cached 8,243 tok 재전송 X + dynamic 350 tok 만 전송`

### 누적 Hotfix
- **@gemma4 응답 저장 안 됨 fix**: `UsageTracker.record('custom:gemma4')` 가 `session['custom:gemma4']` undefined → `.requests++` throw → `_persistMessages()` 도달 못 함 → 메모리만에만 남고 디스크 저장 X 였음. Built-in 외 silent skip + 회귀 test
- **Steering 다중 모드 fix**: Codex/Gemini/argue/team/custom 에서 📤 누르면 메시지 분실됐음 (toast 만 띄움). 이제 `steerRequeue` 로 webview 가 messageQueue 맨 앞 unshift → 현재 턴 끝나면 우선 dispatch
- **Custom provider UI 노출 fix**: 상단 model-filter-bar 와 override-bar dropdown 에 정적 4개만 박혀 있어서 custom 안 보였음. `renderCustomProviderControls()` 동적 추가/갱신 (data-custom 마커)
- **활성 LLM 필터 누락 fix**: team mode 의 `runCodexAgent`/`runGeminiAgent` runner 가 active 무시했음. team consult tool 자체를 active 아니면 등록 안 함 → Claude 호출 시도조차 못 함. loop mode mainModel + boomerang sub-task 도 active 필터 추가

### Tests
152 → 202 (총 +50). usage(custom: regression) / context(intent / secret / budget / projection / receipt 32) / argueDebate(history + totals + cap 6) / geminiCache(hash + size gate 11).

## v0.1.28 — 2026-05-11 (v0.1.27 team mode hang hotfix)

v0.1.27 의 steering 변경 (`ControllableUserStream` 항상 사용) 가 team mode 에서 hang 유발:
- streaming input mode 에서 Claude SDK iterator 는 input stream 이 끝날 때까지 yield 계속함
- `ControllableUserStream` 은 push 또는 close 가 와야 닫힘
- callClaude 의 `finally` 에서 close 호출하지만, for-await 가 안 끝나니 finally 도 안 옴 → deadlock
- 사용자 화면: team mode 가 consult_gemini 완료 후 멈춤

### Fix
- claudeProvider for-await 안에서 `msg.type === 'result'` 감지 시 즉시 `steeringStream.close()` 호출
- 이러면 iterator 가 끝나면서 for-await 정상 종료 → finally 도 정상 실행

## v0.1.27 — 2026-05-11 (Custom provider 1급 시민화 + Steering)

### Custom Provider (Ollama / LM Studio / OpenRouter) 본격 통합
- **환경설정 패널에서 등록·편집·삭제** — settings.json 직접 편집 불필요
- **🔍 로컬 LLM 자동 감지** — Ollama (port 11434) / LM Studio (port 1234) 자동 probe → 설치된 모델 dropdown 으로 선택해서 1-click 등록
- **삭제 (×) 버튼 fix** — VSCode webview 의 `confirm()` 차단 우회 (2-click 확인 패턴)
- **활성 풀 체크박스** + **🎯 대장 모델 dropdown** 에 등록된 custom 자동 노출
- **@mention popup 에 custom 안 보이던 race fix** — webviewReady 시점에 재push
- **라우터 active swap** — 비활성/미로그인 built-in 골라도 active 안의 custom 으로 자동 swap
- **argue / team mode 참여** — active 안의 custom 도 라운드 로빈에 포함, team 은 `consult_<name>` tool 동적 등록

### Custom provider 라벨/정체성 fix
- 헤더가 `GEMINI` 로 표시되던 버그 (fallthrough) — 이제 custom 이름 그대로
- `.msg-ai.custom` 보라 그라데이션 (built-in 과 시각적 분리)
- **Gemma 가 자기를 "Gemini" 라고 답하던 사고** — `modelLabel()` fallthrough 가 system prompt 에 "You are Gemini" 박았던 문제 fix

### Steering — 진짜 mid-stream injection
- `ControllableUserStream` — push() 가능한 AsyncIterable
- Claude streaming input 모드 활용 — 사용자 mid-task 메시지를 abort 없이 LLM 한테 직접 전달
- LLM 이 자율 판단 (일시정지 / 마무리 후 정리 / 즉시 반영)
- 큐 첫 메시지: **📤 steer** (Claude push) / **⚡ 중단** (abort + start) / **✕ 제거**
- 키워드 분류 없음 — 사용자가 명시 선택

### UX
- 환경설정 풋터에 **현재 버전 표시** + GitHub Releases 링크
- 입력창 mention Tab 자동완성 — `mentionStartPos` backtrack 으로 보정 (이상하게 끼어들던 버그 fix)
- 진단 로그 보강: `[provider] call/done`, `[save] pushing`, `[persist] saved`

### CI/dev
- `npm run build` = typecheck + bundle (v0.1.26 부터)
- `npm run typecheck` 단독 가능

## v0.1.26 — 2026-05-11 (`npm run build` 에 type check 통합 — 푸시 전 자동 검증)

v0.1.24 같은 사고 (잘못된 import path 로 publish workflow 죽음) 방지.

`package.json` scripts 재편:
- `typecheck`: `tsc --noEmit` (전체 type 검사)
- `bundle`: esbuild 만 (기존 build 내용)
- `build`: `typecheck && bundle` — type 오류 있으면 bundle 안 함, push 도 못 함
- `watch` / `dev`: `bundle` 만 사용 (iteration 빠르게 유지)
- `package`: `build && vsce package` — vsix 만들기 전 type 검증

publish.yml 의 별도 `npx tsc --noEmit` step 도 그대로 (이중 안전망).

## v0.1.25 — 2026-05-11 (v0.1.24 publish workflow 실패 hotfix)

v0.1.24 에서 captain.ts 에 미구현 코덱스 분기 placeholder 로 `import { AuthStorage } from '../auth/authStorage'` 적었는데 실제 파일명은 `storage.ts`. type check 통과 못해서 publish workflow 실패.

미사용 placeholder import 제거 — codex captain 분기는 토큰 주입 패턴 필요해서 일단 `return null` (미지원). 추후 확장.

로컬 type check 통과 확인 후 푸시.

## v0.1.24 — 2026-05-11 (대장 모델 + 활성 풀 사용자 커스터마이즈)

기존엔 Claude 가 하드코딩된 "대장 모델"로 boomerang plan / argue judge / smart commit / synthesis 다 담당. ChatGPT/Claude 없는 사용자는 collab 모드 제대로 못 씀.

### 새 settings 2개
- **`orchestrai.captain`** — 대장 모델 선택. `auto` (기본, 활성 중 Claude > Codex > Gemini 우선) / `claude` / `codex` / `gemini` / `none` (collab 비활성)
- **`orchestrai.activeProviders`** — 라우터·argue·boomerang 참여 provider 배열. 기본 `["claude", "codex", "gemini"]`. 사용자가 toggle 해서 빼면 제외

### 새 헬퍼 `src/util/captain.ts`
- `getCaptain(authStatus)` — 사용자 선택 + auth 상태 검증 → 실제 사용할 대장 반환
- `getActiveProviders()` — 활성 provider 목록
- `callCaptain(captain, systemPrompt, userPrompt)` — 대장 모델한테 메타 작업 위임 (Claude/Codex/Gemini/custom OpenAI compatible)
- `captainAvailable()` — collab 모드 사용 가능 여부

### 적용 위치
- `boomerang.ts planBoomerang(input, history, captain)` — captain 인자 추가
- `judge.ts judgeTurn(...args, captain)` — argue judge 도 captain 사용
- `commitMessage.ts generateCommitMessage(cwd, fallback, captain)` — smart commit 도 captain
- argue 모드: active providers 안에서만 토론 참여 (이전엔 로그인된 거 다)
- fallback chain: active providers 안에서만 fallback
- team 모드: captain=none 이면 명확히 안내 + 1회성 모드 revert

### Preferences 패널 (사이드바 ⚙)
- 🎯 **대장 모델** dropdown (auto / claude / codex / gemini / 없음)
- 🔘 **Claude / Codex / Gemini 활성** 체크박스
- 전부 비활성 시 자동 default 복귀 (서비스 다 죽이는 사고 방지)
- captain=none 선택 시 team/boomerang 버튼 자동 disable + tooltip "대장 모델 필요"
- 변경 즉시 webview UI 반영 (setPref → prefsData 재push)

### Default 동작 유지
- 기존 사용자: captain=`auto`, activeProviders=`[claude,codex,gemini]` → 동작 변경 없음
- 신규 사용자: 동일 default 로 시작

## v0.1.23 — 2026-05-11 (argue 점수 보존 + 회귀 후에도 표시)

### 발견된 버그
argue 모드 끝나면 1회성 모드 → auto 자동 회귀 (v0.1.18). 그 과정에서:
1. 메시지 아래 verdict ("판정: 8/10 · ...") 가 DOM 에만 있고 ChatMessage 에 없음 → rehydrate 발생 시 사라짐
2. argueBoard (상단 스코어보드) 가 명시적으로 visible 유지 안 됨

### Fix
- `ChatMessage.verdict?: { score, reason }` 필드 추가
- argue 모드의 judgeTurn 후 `lastMsg.verdict = {...}` 저장 + `_persistMessages()` 즉시 flush
- webview rehydrate 시 `m.verdict` 있으면 `.judge-verdict` 블록 같이 렌더
- argueEnd 핸들러에서 argueBoard 명시적으로 `.classList.add('visible')` — auto 회귀해도 점수 계속 표시

## v0.1.22 — 2026-05-11 (사용자 말풍선 시각 개선)

- **색**: 회색 (`--surface2`) → 보라 그라데이션 (`#6d4cb822 → #6d4cb811`, 보더 `#a78bfa55`). Codex 의 회백색 카드와 분리감 확실.
- **Sticky**: `position: sticky; top: 0` — 스크롤 내려도 viewport 상단에 user 메시지 고정. 여러 user 메시지 있으면 각자 자기 차례에 stick, 다음 user 메시지가 오면 밀려남. Claude Code 패턴.

## v0.1.21 — 2026-05-11 (team mode 가짜 peer 대사 제거)

### 발견 (사용자 로그)
Team mode 에서 Codex 가 quota 429 실패하자 Claude orchestrator 가 자기 말풍선 안에 가짜 대사 채워넣음:
```
**Gemini**: 김치찌개 한 표! K-Soul 푸드...
**Codex**: 지금 사용량 한도 초과라 참여 못 함 (약 38분 후 리셋).
**Claude(나)**: 저는 삼겹살 한 표요...
```

기술적으론 Claude 가 peer tool 결과를 정확히 보고한 거지만, 시각적으론 한 말풍선 안에 셋의 카드형 prefix 가 박혀서 ventriloquism 같이 보임.

### Fix 1 — team 모드 system prompt 강화
- "ABSOLUTELY FORBIDDEN" 섹션에 `**Model**:` / `[Model] ...` 패턴 명시적 금지
- peer 실패 시에도 narrative 금지 ("Codex 한도 초과" 같은 보고)
- 투표 시엔 prefix 없이 직접 ("**Claude(나)**: 삼겹살" → "삼겹살.")

### Fix 2 — team 모드 한정 narrow strip
- `stripTeamImpersonation()` — 라인 시작 `**Model**:` / `[Model] ...` 패턴만 제거
- 일반 라우팅의 ventriloquism strip 은 본인 의견까지 지웠지만 team 은 의미 명확해서 안전
- false positive 거의 없음: "Codex 는 빠르다" 같은 일반 문장 안 잡음
- 적용 후 webview 도 finalizeContent 로 갱신

## v0.1.20 — 2026-05-11 (provider 호출 로그 강화 — 진단성 ↑)

v0.1.19 의 honest model label fix 검증 + 사용자가 "정말 X 모델이 답했나?" 추후 의심할 때 Output Channel 만 보면 즉시 답 나오게 로깅 보강.

각 provider 가 호출/완료 시 단일 라인 로그:
- **호출 시**: `[claude/codex/gemini] call: model=X, effort=Y, override=Z, msgCount=N`
- **완료 시**: `[claude/codex/gemini] done: usedModel=X, contentChars=N, in=NN, out=NN`

설정 → ⚙ → 로그 보기 → 해당 turn 시각으로 스크롤하면 어느 provider 가 실제 호출됐고 fallback 으로 어느 모델 썼는지 추적 가능.

## v0.1.19 — 2026-05-10 (모델 라벨 거짓말 fix — fallback 후 실제 사용 모델 표시)

### 발견된 버그
사용자가 ChatGPT Pro weekly quota (gpt-5.5 한도) 다 썼는데도 메시지 헤더에 `gpt-5.5` 박혀서 답변 도착. 실제로는 quota 터지자 `gpt-5.4-mini` 로 자동 fallback 됐는데 **UI 라벨은 원래 모델 그대로**.

기존: actualModelName(model, effort) 으로 호출 시점에 라벨 박고 끝 → fallback 정보 미반영.
사용자 인지: "쿼터 끝났는데 어떻게 5.5가 답했지?" 의심 발생 (실제론 5.4-mini가 답했는데).

### Fix
- `callClaude` / `callCodex` / `callGemini` 모두 `usedModel` 필드 return
  - Codex: 5.5 quota 터져 5.4-mini 로 fallback 시 usedModel = 'gpt-5.4-mini'
  - Gemini: pro → flash → 1.5-flash 다단 fallback 마다 usedModel 갱신
  - Claude: SDK가 내부 fallback 안 하므로 activeModel 그대로
- `_runCodexAgent` / `_runGeminiAgent` 도 usedModel 전파
- `_runTurn`: streamEnd 의 actualModel 을 result.usedModel 우선, 없으면 actualModelName fallback
- boomerang sub-task: assistantMsg.actualModel 도 result.usedModel 사용

이제 메시지 헤더 모델 라벨이 실제 호출된 모델과 일치.

## v0.1.18 — 2026-05-10 (부메랑 follow-up 컨텍스트 사고 fix)

### 발견된 버그
사용자가 boomerang 모드로 큰 작업 시킨 후 작업이 끝나고 follow-up 으로 "완성했어?" 같은 짧은 질문 보내면:
1. boomerang 모드가 sticky 라서 또 plan → 새 boomerang 작업으로 분해
2. planBoomerang 이 prior conversation 안 받아서 "Clarify user intent" 같은 쓸데없는 sub-task 생성
3. sub-task Claude 도 prior conversation 모르고 AskUserQuestion 띄움

### Fix 1 — 1회성 모드 종료 시 auto 자동 회귀
- argue/team/loop/boomerang 끝나면 `_revertOverrideAfterOneShot()` 호출 → `_override = 'auto'`
- claude/codex/gemini force 는 사용자 의도이므로 그대로 유지
- webview 의 dropdown UI 도 즉시 갱신 (`overrideChanged` 메시지)

### Fix 2 — planBoomerang 에 prior conversation 전달
- 최근 6턴 history 를 planner 에 같이 보냄
- planner 가 follow-up 으로 판단하면 `subTasks: []` 반환 → 일반 라우터로 fallback
- 이전 작업 재실행 사고 차단

### Fix 3 — boomerang sub-task 에 prior conversation 전달
- 각 sub-task prompt 앞에 `## Prior conversation (do NOT redo these)` 블록 prepend
- "이전에 만든 X 를 보강해" 같은 의존성 있는 sub-task 도 진짜 X 를 보고 작업 가능

## v0.1.17 — 2026-05-10 (e2e 테스트 5종 추가 — 105 → 152)

지금까지 단위 테스트가 순수 함수만 다뤄서 STOP 같은 런타임 버그를 못 잡았던 문제 해결.

### 신규 테스트 파일 5개 (+47 케이스)
- **test/aiWatch.test.ts** (11) — 매직 코멘트 정규식 (TS/JS/PY/SQL), cooldown, 컨텍스트 ±5줄
- **test/repoMap.test.ts** (13) — TS/Python/Go/Rust 언어별 symbol 추출, EXCLUDE_DIRS, CamelCase / snake_case 매칭, 한국어 query
- **test/testRunner.test.ts** (9) — npm/pytest/cargo/go 명령 감지, vitest/pytest/cargo/go 실패 출력 파싱
- **test/modelOverride.test.ts** (8) — auto/off/on/extra thinking budget 해소, 모델 한도 적용
- **test/claudeAbort.test.ts** (4) — **v0.1.16 fix 회귀 검증**: abort 발화 → q.interrupt() 호출, stream 더 이상 chunk 안 받음, pre-aborted signal

### Mock 인프라 보강
- test/mocks/vscode.ts: `createOutputChannel` / `createStatusBarItem` / `Uri.parse` / `ConfigurationTarget` / `ProgressLocation` / `env.language` 추가 (real vscode 모듈 의존 모듈 테스트 가능)
- test/mocks/claude-sdk.ts: 진짜 Query 인터페이스 흉내 — `interrupt()` 추적, abortSignal honor, custom message stream 주입

### Bug fix (테스트 작성하면서 발견)
- testRunner.extractFailureSummary: vitest 필터가 AssertionError 잡아서 pytest 필터 못 가던 버그
  - 모든 testrunner 패턴 (vitest/jest/pytest/cargo/go panic) 한 번에 OR 매칭으로 통합

3번 연속 실행 모두 152/152 통과 확인 — race condition / flakiness 없음.

## v0.1.16 — 2026-05-10 (STOP 버튼 실제로 작동하게 — Claude SDK interrupt)

v0.1.15 까지의 STOP 버튼 실패 원인:
- `abortSignal` 만 SDK 에 넘겨서는 spawned `claude` CLI subprocess 가 안 죽음
- Claude Agent SDK 의 `Query.interrupt()` 는 **streaming input mode** 에서만 동작 (타입 정의 주석에 명시)
- 텍스트 prompt = `string` 일 때는 SDK 가 input stream 즉시 닫음 → control request "interrupt" 못 보냄
- 그래서 사용자가 STOP 눌러도 진행 중인 tool 호출(Read/Edit/Bash) 다 끝날 때까지 계속 동작했음

수정:
- 텍스트 전용 prompt 도 `singleMessageStream()` AsyncIterable 로 wrap → SDK 가 streaming input mode 로 동작
- `q.interrupt()` abort listener 등록 — abortSignal 발화 시 즉시 SDK 에 control request 전송
- `for await` 루프 안에서도 매 메시지마다 `abortSignal.aborted` 체크 → SDK 가 늦게 stop 해도 우리가 일찍 break

이제 긴 리팩토링 도중 STOP 누르면 진짜로 멈춤.

## v0.1.15 — 2026-05-10 (끼어들기 버그 + 음성인식 locale + UI 정렬)

### 끼어들기 (interrupt) 안 듣던 버그 fix
- 큐의 ⏩ "끼어들기" 버튼 또는 STOP 버튼 클릭 시 backend 가 `generationStopped` 만 보내고 send 락 안 풀어서 큐가 drain 안 됨
- webview: `generationEnd` / `generationStopped` case 에서 `setSendLocked(false)` 호출 추가
- backend: `stopGeneration` 메시지 처리 시 `_isSending = false` 즉시 + `sendUnlocked` post 보강
- 효과: 응답 도중 새 메시지 입력 → ⏩ 끼어들기 클릭 → 즉시 새 prompt 시작

### 음성인식 (Web Speech API) 개선
- `recog.lang` 하드코딩 ko-KR → `navigator.language` 기반 자동 감지 (ko/en/ja/zh/es/de/fr/pt/ru)
- 권한 사전 체크 — `navigator.mediaDevices.getUserMedia({audio:true})` 로 mic 권한 미리 확인
- 에러별 친절 메시지: not-allowed / network / no-speech / audio-capture / service-not-allowed 한글 매핑
- VSCode webview 가 mic 막아놓은 경우 (가장 흔한 원인) 명확히 안내

### UI — override-bar 버튼 높이 정렬
- ⚡ argue 와 ✦ auto dropdown 버튼 높이 다른 거슬리는 거 fix
- `.override-bar` `align-items: center` + `.override-btn` `height: 22px` 강제
- `.override-pick` inline-block → inline-flex (caret span 영향 차단)

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
