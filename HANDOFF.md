# OrchestrAI — 마켓플레이스 거절 대응 핸드오프 노트

> 이 파일은 작업 인계용 메모입니다. 로컬 VSCode의 Claude가 이걸 먼저 읽고 이어서 작업하세요.
> 작업 브랜치: **`claude/vscode-extension-rejection-34tap5`** (push 완료). 먼저 `git pull` 하세요.
> 최종 업데이트: 2026-06-13

---

## 0. 한 줄 배경

VSCode 마켓플레이스(publisher `samkj`, 확장 `samkj.orchestrai`)에 등록됐다가 **거절 + 계정 차단** 당함.
원인 분석 → 위반 코드/문구 제거까지 완료한 상태. 아래 "남은 일" 참고.

---

## 1. 거절 원인 분석 (확정)

심각도 순:

1. **🔴 (결정적) Codex가 3rd-party ToS 위반** — 구독 백엔드를 공식 CLI인 척 위장 호출.
   - `src/providers/codexProvider.ts`: `https://chatgpt.com/backend-api/codex/responses` (비공개 내부 API)에
     `User-Agent: codex_cli_rs/...`, `originator`, `ChatGPT-Account-ID` 지문 위조 fetch.
   - `src/auth/codexAuth.ts`: 리버스 엔지니어링한 client_id(`app_EMoamEEZ...`)로 자체 PKCE OAuth.
2. **🟠 우회 광고 문구** — README/package.json의 "Zero API billing / subscription bypass / 자체 구독 우회".
3. **🟠 키워드 스팸** — keywords에 경쟁사명(copilot/cursor/cline/continue) + SEO성(gpt-5/zero-billing/subscription).
4. **🟠 경쟁사 비교표** — README의 Cursor/Continue/Cline/Copilot ❌ disparagement 표.
5. **🟡 카테고리 오용** — Programming Languages/Notebooks/Visualization (실기능 무관).
6. **🟡 (남은 회색지대) Gemini** — 무료 OAuth 티어 재사용. 위장은 없지만 ToS 회색.

**Claude는 문제 없음** — 공식 `@anthropic-ai/claude-agent-sdk` `query()` 사용 (정식 임베딩 경로).

---

## 2. 이미 완료한 작업 (커밋 2개, push됨)

### 커밋 `23a96d6` — Codex native-only 전환
- **삭제**: `src/providers/codexProvider.ts`, `src/auth/codexAuth.ts`
- `_runCodexAgent` (extension.ts): native 전용 재작성. 레거시 tool 루프 + `codexEngine` 분기 제거.
  native 불가 시 throw (`공식 Codex(ChatGPT) VSCode 확장 설치/로그인` 안내).
- 모든 codex 로그인 게이팅을 `getCodexMcpClient().isAvailable()` 로 교체.
- login/logout → `_connectCodex()` (자체 OAuth 없이 공식 확장 설치/로그인 안내).
- 코드리뷰·채팅참여·팀모드 경로를 `callCodexNative` 로 통일.
- package.json: `codexEngine` 설정 제거, `loginCodex` 커맨드 리네이밍.
- i18n/webview: `codexEngine` 토글 UI·문구 제거.

### 커밋 `21a1470` — 마켓플레이스 정책 표현 정리
- package.json description: "No extra API keys — works with the AI CLI tools you already have installed".
- keywords: copilot/cursor/cline/continue/gpt-5/zero-billing/subscription 제거.
- categories: AI/Chat/Other 만 남김.
- README.md / README.ko.md: 경쟁사 비교표 → OrchestrAI 단독 기능표로 전환,
  "subscription bypass / 자체 구독 우회" 행 삭제, zero-billing 태그/푸터 중립화,
  "Cursor/Continue parity"·"Cline-style" 등 중립화, 인증표 Codex 행을 공식 확장 로그인으로 갱신.
- credits의 영감 출처("Cursor — RAG 아이디어")는 nominative라 유지.

**검증 완료**: `npm run typecheck` 통과 / `npm test` 236개 통과 / 위장 흔적 grep clean / package.json JSON 유효.

---

## 3. Codex가 지금 작동하는 방식 (중요 — API 키 아님!)

사용자가 원했던 대로 **공식 Codex(ChatGPT) VSCode 확장의 로그인을 그대로 활용**함.
- `src/providers/codexMcpClient.ts`가 `~/.vscode/extensions/openai.chatgpt-*` 의 번들 `codex` 바이너리를 찾아
  MCP stdio 서버로 spawn → `codex` 툴 호출. 인증·네트워크는 공식 바이너리가 처리.
- Claude의 공식 SDK 방식과 동일 구조. **전제조건: 사용자가 공식 Codex 확장 설치 + ChatGPT 로그인 필요.**

---

## 4. 남은 일 / 미결정 사항

### A. (정책) 계정 복구 vs 새 계정 — 사용자 결정 대기
- 받은 통지가 **"확장 거절"** 인지 **"퍼블리셔 계정 정지"** 인지 원문 확인 필요.
- **새 계정 + 같은 이름 재업로드는 권장 안 함**:
  - 계정 정지 우회(ban evasion)는 ToS 위반 → 새 계정도 차단 위험 (이메일/IP/GitHub/확장 지문 상호 연계).
  - 삭제된 확장의 `name`(=`orchestrai`)은 영구 예약되어 재사용 불가일 수 있음.
- **권장 루트**: 위반 수정 완료를 근거로 **Microsoft 퍼블리셔 support에 reinstatement(복구) 요청**.
  그 사이 **Open VSX** 로 배포(이미 `publish.yml`에 OVSX 경로 있음, Cursor/Windsurf/VSCodium 대상).
- TODO(원하면): reinstatement 요청용 영문 메시지 초안 작성 (수정 내역 근거 포함).

### B. (선택) Gemini 회색지대 정리
- 현재 `geminiProvider.ts`가 `authType: 'oauth-personal'` (gemini-cli 무료 OAuth 재사용).
- 더 안전하게: `generativelanguage.googleapis.com` API 키 방식을 권장 옵션으로. (Codex/Claude처럼
  "공식 CLI 로그인 재사용" 논리로 방어는 가능 — 필수는 아님. 사용자 판단.)

### C. (선택) 잔여 정리
- `PROMOTION.md` 등 비-마켓페이싱 문서에도 "zero billing" 류 표현 남아있을 수 있음 (마켓 심사 무관하나 일관성 차원).
- `version` 0.1.47 → 재배포 시 0.1.48 등으로 bump (CHANGELOG에 v0.1.48 항목은 이미 추가됨).
- 상표 표기(displayName/커맨드 "Codex (ChatGPT)" 등)는 nominative 사용이라 유지 중. 더 보수적으로 갈지 사용자 판단.

---

## 5. 작업 규칙
- 개발/푸시 브랜치: `claude/vscode-extension-rejection-34tap5` (다른 브랜치 푸시 금지).
- 변경 후 항상 `npm run typecheck` + `npm test` 통과 확인.
- 위장/우회 흔적 재확인 grep:
  `grep -rniE "chatgpt.com/backend-api|app_EMoamEEZ|codex_cli_rs|bypass|구독 우회|zero billing" src/ README*.md package.json`
  → 결과 없어야 정상.
