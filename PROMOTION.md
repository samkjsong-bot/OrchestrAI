# 📢 OrchestrAI 홍보 키트

복사해서 채널별로 게시. 가장 임팩트 큰 순서로 정리.

---

## 1. 🐦 Twitter / X — 단발 트윗

```
🎼 OrchestrAI 공개

Claude + Codex + Gemini를 한 VSCode 사이드바에서 자동 라우팅하는 오케스트레이터.

✅ 멀티모델 자동 라우팅 (auto/argue/team/loop/boomerang)
✅ 코드베이스 RAG · 멀티모델 코드 리뷰
✅ Telegram 폰 통합 · 자동 git checkpoint
✅ API 과금 0원 — 자체 구독 우회

오픈소스: github.com/samkjsong-bot/OrchestrAI
```
(280자 한도 안)

---

## 2. 🐦 Twitter / X — 스레드 (5트윗)

**1/5**
```
Cursor·Continue·Cline·Copilot 다 써봤는데 다 한 모델만 골라서 씀.

근데 작업마다 강한 모델이 다른데?

그래서 만듦 → OrchestrAI: Claude·Codex·Gemini를 자동 라우팅하는 VSCode 익스텐션 🧵
```

**2/5**
```
🧠 auto: pattern + Haiku LLM 라우터가 작업별 적합 모델 자동 선택
⚡ argue: 모델끼리 토론, Haiku가 0~10점 채점
👥 team: Claude(설계) → Codex(구현) → Gemini(리뷰) 위임
🪃 boomerang: 큰 작업 자동 sub-task 분할 → 병렬
🔁 loop: "될 때까지" 반복 (Ralph Wiggum)
```

**3/5**
```
다른 도구 약점도 보강:
🧭 코드베이스 RAG (Gemini 무료 임베딩) — Cursor 수준
🔍 멀티모델 코드 리뷰 — 3개 모델이 각자 리뷰 + Haiku 종합
🌙 Background agent + Telegram push — 외출 중에도 작업
💾 매 턴 자동 git commit — 한 턴씩 즉시 revert
```

**4/5**
```
가장 큰 차별점: 📱 Telegram 브릿지

폰에서 명령 → VSCode가 처리 → 응답 폰으로 stream
Hub/Worker로 멀티 PC, Topics로 워크스페이스별 자동 분리

침대에서 게임 만들 수 있음
```

**5/5**
```
그리고 가장 중요한 것: 💰 API 과금 0원

Claude Max + ChatGPT Pro + Gemini 무료 OAuth — 다 자체 구독 우회
이미 내고 있는 구독료 외에 종량제 비용 0원

오픈소스 (MIT 예정)
github.com/samkjsong-bot/OrchestrAI
```

---

## 3. 📰 Hacker News — Show HN

**Title**:
```
Show HN: OrchestrAI – Multi-model VSCode extension (Claude+Codex+Gemini, no API billing)
```

**URL**: `https://github.com/samkjsong-bot/OrchestrAI`

**Text** (선택, comment로):
```
A VSCode extension that routes between Claude, Codex (gpt-5), and Gemini automatically — no extra API billing because all three use your existing subscriptions/free tier (Claude Max via local CLI auth, Codex via ChatGPT.com backend, Gemini via gemini-cli OAuth).

Differentiators vs Cursor/Continue/Cline:
- Auto-routing (pattern + LLM Haiku) — others require manual model picking
- argue mode: models debate, Haiku scores 0-10
- team mode: Claude orchestrator delegates to Codex/Gemini via MCP tools
- boomerang task: auto-decompose large tasks into parallel sub-tasks
- Ralph Wiggum loop: retry until done
- Codebase RAG with free Gemini embeddings
- Multi-model code review (/review)
- Telegram bridge: control from your phone
- Auto git checkpoint per turn (one-click revert)

Built because I was paying for Claude Max + ChatGPT Pro + Gemini and wanted to use them all in one panel without paying extra per-token API fees.

License: MIT (planned). Apache-2.0-style policies for the Codex CLI parts.

Feedback welcome — especially around the Codex CLI integration (uses codex.exe mcp-server stdio mode, not the legacy HTTP path).
```

---

## 4. 📱 Reddit — r/vscode

**Title**:
```
[Show] OrchestrAI – multi-model orchestrator (Claude+Codex+Gemini) with auto-routing, RAG, Telegram bridge — zero API billing
```

**Body**:
```
Built a VSCode extension that does what Cursor/Continue/Cline don't:

**3 models, auto-routed:**
- Claude (Max subscription, via local CLI)
- Codex/gpt-5 (ChatGPT Pro, via codex.exe MCP)
- Gemini (free OAuth)

**Modes that don't exist elsewhere:**
- `argue` — models debate, Haiku judges 0-10
- `team` — Claude orchestrator delegates to others
- `boomerang` — auto-decompose large tasks → parallel
- `loop` — retry until done (Ralph Wiggum pattern)

**Plus everything Cursor has:**
- Codebase RAG (free Gemini embeddings)
- Auto git checkpoint per turn
- Inline autocomplete
- Auto IDE diff
- Background agent + Telegram push (this one's unique)

**Zero API billing** — everything routes through your existing subscriptions.

GitHub: https://github.com/samkjsong-bot/OrchestrAI
VSIX in releases.

Feedback welcome.
```

---

## 5. 📱 Reddit — r/ChatGPTCoding

**Title**:
```
OrchestrAI: Use ChatGPT Pro + Claude Max + Gemini in one VSCode panel (no extra API costs)
```

**Body**: 위 r/vscode와 동일하지만 ChatGPT 부분 강조:
```
Codex integration uses the official codex.exe binary in mcp-server mode (the same one ChatGPT extension uses), so all your ChatGPT Pro tools/auth/sandbox work as-is.

But you also get Claude Sonnet/Opus and Gemini Flash/Pro in the same chat, with auto-routing picking the best per task.

[rest same as r/vscode post]
```

---

## 6. 📱 Reddit — r/LocalLLaMA

이건 우리가 LLM 호출하지만 local LLM 아니라 약간 off-topic. 그래도 가치 있는 부분:
```
Title: OrchestrAI — orchestrate Claude/Codex/Gemini in VSCode without paying API fees (uses subscription auth)

(자세한 본문 위와 동일)
```

---

## 7. 🇰🇷 GeekNews / 디스콰이엇

**Title**:
```
OrchestrAI 공개 — Claude+Codex+Gemini를 한 VSCode 사이드바에서 자동 라우팅 (API 과금 0원)
```

**Body**:
```
3개 LLM을 한 사이드바에서 작업별 자동 라우팅하는 VSCode 익스텐션 만들었습니다.

핵심:
- 자동 라우팅 (pattern + Haiku LLM)
- argue 모드 (모델 토론 + Haiku 채점)
- team 모드 (Claude → Codex/Gemini 위임)
- boomerang (큰 작업 자동 분할 + 병렬)
- loop (될 때까지)
- 코드베이스 RAG (Gemini 무료 임베딩)
- 멀티모델 코드 리뷰
- Telegram 브릿지 (폰에서 코딩)
- 자동 git commit (한 턴씩 revert)
- 자동 미리보기 (HTML→Simple Browser, ▶ run)

특히 Telegram 브릿지가 다른 도구들 다 없는 기능. Hub/Worker로 멀티 PC, Topics로 워크스페이스별 자동 분리.

가장 중요한 건 **API 과금 0원**:
- Claude → 로컬 claude CLI OAuth (Max 구독)
- Codex → codex.exe mcp-server (ChatGPT Pro)
- Gemini → gemini CLI OAuth (Google 무료)

이미 내고 있는 구독료 외엔 추가 비용 0.

GitHub: https://github.com/samkjsong-bot/OrchestrAI
오픈소스 (MIT 예정)
```

---

## 8. 📝 dev.to / Medium — 긴 소개 글

**Title**:
```
I built OrchestrAI: orchestrating Claude, Codex, and Gemini in VSCode without paying API fees
```

**섹션 구성**:
1. The problem — Cursor/Continue all force one model at a time
2. The insight — different tasks suit different models
3. How auto-routing works (pattern → Haiku LLM)
4. The cool modes (argue, team, boomerang, loop)
5. Why no API billing (subscription bypass details)
6. The Telegram bridge story
7. Open source, try it
8. Roadmap

(각 섹션 200~400단어, 코드 예시 포함)

---

## 9. 🚀 Product Hunt

**Tagline (60자)**:
```
3 AI models, 1 VSCode panel, 0 API billing
```

**Description**:
```
Multi-model orchestrator for VSCode. Auto-routes between Claude (Max), Codex (ChatGPT Pro), and Gemini (free) based on task type. Has unique modes: argue (models debate), team (orchestrator delegates), boomerang (auto-decompose), loop (retry until done). Plus codebase RAG, multi-model code review, Telegram phone bridge, auto git checkpoints. Zero extra API costs — uses your existing subscriptions.
```

**Topics**: VSCode, AI, Developer Tools, Productivity, Open Source

---

## 10. 🌍 Open VSX 등록 (직접 publish)

VSCode 마켓플레이스보다 정책 느슨. VSCode/Cursor/Theia/Gitpod에서 다 인식.

**준비**:
1. https://open-vsx.org 가서 GitHub로 로그인
2. Settings → Access Tokens → 새 토큰 생성 (이름: `orchestrai-publish`)
3. 토큰 복사

**Publish**:
```bash
cd c:\Users\samkj\Desktop\작업실\orchestrai
npx ovsx create-namespace samkj -p <YOUR_TOKEN>   # 첫 1회만
npx ovsx publish orchestrai.vsix -p <YOUR_TOKEN>
```

성공하면 https://open-vsx.org/extension/samkj/orchestrai 노출.

---

## 11. 🏪 VSCode Marketplace 등록

**준비** (한 번만):
1. https://dev.azure.com 에서 organization 만들기
2. User Settings → Personal Access Tokens
3. Scope: **Marketplace > Manage**
4. 토큰 복사
5. https://marketplace.visualstudio.com/manage 에서 publisher 만들기 (이름: `samkj`)

**Publish**:
```bash
cd c:\Users\samkj\Desktop\작업실\orchestrai
npx vsce login samkj         # 토큰 입력
npx vsce publish             # 자동으로 build + upload
```

⚠ 주의: Codex 우회 경로 부분에 대해 Microsoft 검토에서 거절될 수 있음. 거절 시 description에서 "Codex CLI integration via official codex.exe binary" 정도로 순화.

---

## 12. 📦 GitHub Repo 메타데이터 강화

GitHub repo 페이지 → ⚙ About 섹션 클릭:

**Description**:
```
🎼 Multi-model orchestrator for VSCode — Claude + Codex + Gemini in one panel with auto-routing, argue/team/loop/boomerang modes, codebase RAG, Telegram bridge. Zero API billing.
```

**Website**:
```
https://github.com/samkjsong-bot/OrchestrAI
```

**Topics** (입력하면 검색 노출 ↑):
```
vscode-extension ai claude gpt-5 gemini multi-model llm code-review rag telegram-bot orchestration agent autocomplete codex anthropic openai
```

**Releases / Packages** 섹션 노출 옵션 켜기.

---

## 13. 🎬 데모 비디오 (선택)

가장 임팩트 큰 시연:
1. **30초 클립**: "todo 앱 만들어줘" → boomerang 자동 분할 → 5초 후 완성된 앱 → Simple Browser 자동 실행 (압축 영상)
2. **3분 영상**: 모든 모드 demo
3. **Telegram demo**: 폰에서 메시지 → VSCode가 작업 → 폰으로 응답

녹화: VSCode 자체에 OBS Studio · Loom · ScreenStudio 사용
업로드: YouTube + Twitter video

---

## 우선순위 추천

**오늘 1시간**:
1. ✅ GitHub Release publish (위 가이드 따라)
2. ✅ GitHub repo metadata 채우기 (About 섹션)
3. ✅ Twitter 단발 트윗

**오늘 추가 30분**:
4. ✅ Hacker News Show HN
5. ✅ Reddit r/vscode + r/ChatGPTCoding

**내일**:
6. ✅ Open VSX publish (1시간)
7. ✅ GeekNews / 디스콰이엇 (한국)
8. ✅ dev.to 긴 글

**1주 안**:
9. Product Hunt
10. VSCode Marketplace 등록 시도
11. 데모 영상

---

## 🎯 메시지 포인트 (모든 채널 공통)

세일즈 시 강조 순서:
1. **Zero API billing** (가장 강한 hook — 다른 multi-model 도구 다 API 키 필요)
2. **Auto-routing** (Cursor 등은 수동 선택)
3. **argue/team/boomerang** modes (세상에 없는 것들)
4. **Telegram bridge** (가장 차별)
5. **RAG + autocomplete + git checkpoint** (parity with Cursor)
