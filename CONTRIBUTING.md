# Contributing to OrchestrAI

기여 환영합니다. PR 열기 전에 한 번만 읽어주세요.

## 빠른 시작
```bash
git clone https://github.com/samkjsong-bot/OrchestrAI.git
cd OrchestrAI
npm install
npm run build      # esbuild → dist/extension.js
npm run package    # vsce package → orchestrai.vsix
```

VSCode에서 `F5`로 dev host 띄우면 source 변경 즉시 테스트 가능.

## 절대 건드리지 말 것 (CRITICAL)

### 한글 인코딩
chat.html / extension.ts 한글이 깨지면 **닫힘 태그(`</div>`)까지 같이 깨져서 webview 통째로 죽음**. 작업 후 검증:
```bash
python -c "import re; ..."  # mojibake 라인 0인지
```

### 구독 우회 경로
다음 절대 도입 금지:
- ❌ `ANTHROPIC_API_KEY` 환경변수 (Anthropic API 종량제 과금)
- ❌ `api.openai.com` 직접 호출 (OpenAI API 종량제)
- ❌ Gemini API 키로 텍스트 생성 (이미지 전용)

올바른 경로:
- ✅ Claude → 로컬 `claude` CLI OAuth 재사용
- ✅ Codex → `codex.exe mcp-server` (또는 chatgpt.com 백엔드, fingerprint 위장)
- ✅ Gemini → 로컬 `gemini` CLI OAuth

### Codex CLI fingerprint
`src/providers/codexProvider.ts` 의 `originator: codex_cli_rs` / `User-Agent: codex_cli_rs/...` 헤더는 임의 수정 금지. 401/403/429 발생.

### Gemini ESM dynamic import 트릭
`src/providers/geminiProvider.ts` 의 `new Function('return import(...)')` 트릭은 esbuild의 require() 변환 우회용. 정리 금지.

자세한 내용: [CODEMAP.md](./CODEMAP.md) 참조.

## 코드 스타일
- TypeScript strict
- 함수형 우선, 클래스는 stateful 모듈만
- 한글 주석 OK
- 절대 `// TODO: ...` 주석 남기지 말 것 (실제 작업 안 하는 todo)

## PR 가이드
1. 한 PR = 한 기능 / 한 fix
2. 빌드 통과 (`npm run build`) 확인
3. 변경 영향 받는 mode·provider 다 테스트 (Claude/Codex/Gemini × auto/argue/team/...)
4. CHANGELOG.md 에 한 줄 추가
5. PR description에:
   - 무엇을 / 왜
   - 깨질 가능성 있는 부분
   - 테스트 시나리오

## 신규 기능 제안
이슈 먼저 열어주세요. 큰 기능은 사전 합의 후 작업.

## 라이선스
기여 시 MIT 라이선스로 코드 공개에 동의함을 의미합니다.
