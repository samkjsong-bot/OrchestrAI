# Security Policy

## 지원 버전

| Version | 보안 패치 |
|---------|----------|
| 0.1.x   | ✅ 활성 |
| < 0.1.0 | ❌ |

## 취약점 보고

OrchestrAI 에서 보안 문제를 발견하셨다면:

**🔒 비공개 보고 (권장)**
- GitHub Security Advisories: <https://github.com/samkjsong-bot/OrchestrAI/security/advisories/new>
- 또는 메일: sam.kj.song@gmail.com (제목에 `[OrchestrAI security]` 표기)

**보고에 포함하면 도움 되는 정보**:
- 영향 범위 (특정 모드 / 모든 사용자 / 특정 OS)
- 재현 단계
- 가능하면 PoC 또는 패치 제안

**❌ 공개 issue 로 보고하지 마세요** — 패치 전 노출되면 다른 사용자에게 위험.

## 응답 정책

- 24시간 안에 ack
- 7일 안에 영향 분석 + 패치 ETA 회신
- 패치 후 **사용자 알림** + CHANGELOG 명시 + (보고자 동의 시) 보고자 credit

## 신뢰 경계 (Threat Model)

OrchestrAI 가 다루는 sensitive 데이터:

### 1. OAuth 토큰 / API 키
- **저장 위치**: VS Code `SecretStorage` (OS 키체인 — Windows DPAPI / macOS Keychain / Linux libsecret)
- **노출 채널**: 없음. AI 모델 호출 시 Authorization 헤더로만 전송
- **위협**: extension host process 메모리 dump → 토큰 노출 가능 (모든 VSCode 익스텐션 공통 risk)

### 2. 사용자 채팅 / 코드
- **저장 위치**: `globalStorage/chats/{sha1}.json` (로컬, plain text)
- **외부 전송**: 사용자가 모델에 보낼 때만 (Anthropic / OpenAI / Google 의 표준 endpoint)
- **위협**: 다중 사용자 머신에서 OS user 격리만 의존. 디스크 암호화 권장

### 3. AI 가 실행하는 명령
- 모델이 `Bash` / `Edit` / `Write` 도구로 워크스페이스 수정 가능
- **권한 모드** 4종으로 제어:
  - `ask`: 매 변경 전 사용자 확인
  - `auto-edit`: 자동 (default)
  - `plan`: 파일 수정 X, plan.md 만 작성
  - `smart-auto`: 작업 성격 따라 자동 판단
- **자동 git checkpoint**: 매 turn 끝나면 자동 commit → 망쳐도 한 클릭 revert

### 4. 외부 명령 (gh / git / playwright)
- 모두 spawn `args` 배열 (shell injection 차단)
- timeout 안전망 (15~60초)
- 환경변수 `GIT_TERMINAL_PROMPT=0` 으로 인증 prompt hang 방지

## 알려진 한계

- **Telegram bot token**: 사용자가 직접 입력. SecretStorage 에 저장. 텔레그램 그룹/채널 멤버 모두에게 채팅 노출 (사용자 본인 책임)
- **Custom provider API key**: settings.json 에 저장 (workspace) — git 에 commit 하지 않도록 .gitignore 권장
- **Playwright (`@browser`)**: 시스템 Chrome / Edge 사용. 기존 브라우저 세션과 격리됨 (separate context)

## 책임 있는 보안 모범사례

- VS Code 자체 + 익스텐션 minor 업데이트 자동 받기
- `npm audit` 정기 확인 (Dependabot 활성화돼있음)
- API key / OAuth 토큰 절대 채팅이나 PR 본문에 붙여넣지 마세요 (모델이 학습/로그 가능)
