// src/i18n/strings.ts
// 모든 UI 문자열 — ko / en 한 곳에. 점진 추가 — 키 없으면 fallback ko.
// extension + webview 양쪽이 같은 dict 사용. webview 는 _getHtml() 시점에 active locale inject.
//
// 키 네이밍 컨벤션: section.subsection.label (snake)

export type Locale = 'ko' | 'en'

export type StringsDict = {
  // 환경설정 패널 (Prefs Panel)
  prefs_title: string
  prefs_close: string
  prefs_section_captain: string
  prefs_label_captain: string
  prefs_captain_auto: string
  prefs_captain_claude: string
  prefs_captain_codex: string
  prefs_captain_gemini: string
  prefs_captain_none: string
  prefs_captain_hint: string
  prefs_active_claude: string
  prefs_active_codex: string
  prefs_active_gemini: string
  prefs_active_hint: string

  prefs_section_custom: string
  prefs_section_models: string
  prefs_label_claude: string
  prefs_label_codex: string
  prefs_label_gemini: string
  prefs_label_thinking: string
  prefs_model_auto: string

  prefs_section_token_budget: string
  prefs_tokenBudget_enabled: string
  prefs_tokenBudget_tooltip: string
  prefs_geminiCache_enabled: string
  prefs_geminiCache_tooltip: string
  prefs_contextWindow_hint: string

  prefs_section_router: string
  prefs_label_contextWindow: string
  prefs_label_codexEngine: string
  prefs_label_confidence: string
  prefs_confidence_hint: string

  prefs_section_automation: string
  prefs_autoGitCommit: string
  prefs_autoPreview: string
  prefs_autoOpenDiff: string
  prefs_aiMagicComments: string
  prefs_inlineCompletion: string

  prefs_section_rag: string
  prefs_rag_enabled: string
  prefs_rag_autoIndex: string

  prefs_section_accounts: string
  prefs_account_login: string
  prefs_account_logout: string
  prefs_account_connected: string
  prefs_account_disconnected: string
  prefs_geminiApiKey: string
  prefs_geminiApiKey_placeholder: string
  prefs_geminiApiKey_saved_placeholder: string
  prefs_geminiApiKey_save: string
  prefs_account_hint: string

  prefs_section_mcp: string
  prefs_mcp_add: string
  prefs_mcp_empty: string
  prefs_mcp_name: string
  prefs_mcp_command: string
  prefs_mcp_args: string
  prefs_mcp_env: string
  prefs_mcp_save: string
  prefs_mcp_cancel: string
  prefs_mcp_delete: string
  prefs_mcp_delete_confirm: string
  prefs_mcp_hint: string

  prefs_section_misc: string
  prefs_misc_telegram: string
  prefs_misc_restoreArchive: string
  prefs_misc_openArchives: string
  prefs_misc_showLogs: string
  prefs_misc_resetUsage: string

  prefs_section_language: string
  prefs_language_auto: string
  prefs_language_ko: string
  prefs_language_en: string

  // 채팅 탭 (multi-chat tabs)
  tab_new: string
  tab_new_title: string
  tab_close: string
  tab_close_tooltip: string
  tab_rename: string
  tab_rename_prompt: string
  tab_duplicate: string
  tab_fork_tooltip: string
  tab_fork_toast: string
  tab_fork_no_target: string
  tab_last_cant_close: string

  // override-bar (모드 강제)
  mode_label: string
  mode_auto: string
  mode_claude: string
  mode_codex: string
  mode_gemini: string
  mode_argue: string
  mode_team: string
  mode_loop: string
  mode_boomerang: string
  mode_auto_tooltip: string
  mode_argue_tooltip: string
  mode_team_tooltip: string
  mode_loop_tooltip: string
  mode_boomerang_tooltip: string

  // 입력창 / 메시지
  input_placeholder: string
  input_attach: string
  send: string
  copy: string
  rollback: string
  fork: string
  fork_tooltip: string

  // 토스트 / 알림
  toast_steer_pushed: string
  toast_steer_queued: string
  toast_steer_cancelled: string
  toast_steer_not_found: string
  toast_cleared: string
  toast_full_context_cancel: string
  toast_apikey_saved: string
  toast_apikey_removed: string
  toast_mcp_saved: string
  toast_mcp_deleted: string
  toast_min_active_required: string

  // 토큰 영수증 (token receipt)
  receipt_saved_pct: string  // "{pct}% saved"
  receipt_tok: string         // "{n} tok"
  receipt_copied: string

  // Argue 카드
  argue_summary_title: string
  argue_total_rounds: string
  argue_max_output: string
  argue_cache_summary: string
  argue_summarizing: string
  argue_cap: string

  // 컨텍스트
  ctx_memory: string
  ctx_reset: string
  ctx_reset_confirm: string
  ctx_file_on: string
  ctx_file_off: string
  ctx_no_file: string

  // 라우팅 배지
  routing_force: string
  routing_mention: string
  routing_override: string
  routing_argue_open: string
  routing_argue_reply: string

  // Full Context 모달
  full_context_warning: string
  full_context_continue: string
  full_context_balanced: string

  // Account & Usage 패널
  usage_title: string
  usage_session_elapsed: string         // "세션 시작 이후 {time}"
  usage_saved_estimate: string           // "💰 절약 추정"
  usage_zero_billing: string             // "(구독 우회로 실제 청구 0)"
  usage_requests: string                 // "요청"
  usage_reset_btn: string
  usage_plan_claude_max: string          // PLAN_INFO.claude.label
  usage_plan_chatgpt_pro: string
  usage_plan_gemini_free: string
  usage_limit_claude_hint: string
  usage_limit_codex_hint: string
  usage_limit_gemini_hint: string
  usage_footer_note: string
  usage_cache_legend: string             // "⚡ cache_read = ... · ↑ cache_write = ... · 📦 cached_in = ..."

  // argue 판정 보드
  argue_board_title: string              // "argue 판정 (Claude Haiku) · 0~10점"
  argue_judging: string                  // "채점중..."
  argue_models_header: string
  argue_input_header: string
  argue_output_header: string
  argue_rounds_header: string
  argue_cache_header: string
  argue_verdict_label: string            // "판정:"
  argue_cache_claude_summary: string     // "Claude prompt cache: {n} tok 재사용 (청구 X 처리됨)"
  argue_cache_claude_creation: string    // "Claude cache 생성: {n} tok (1회성)"
  argue_cache_gemini_summary: string     // "Gemini Context Cache: {n} tok cached (~25% 단가)"
  argue_round_tokens: string             // "R{round} {model}: in {input} / out {output} tok"
  argue_max_output_model: string         // "가장 길게 답함: {model} ({n} tok)"
  argue_total_summary: string            // "총 {rounds} 라운드 · input {in} · output {out} · total {total} tok"

  // 토큰 영수증 / 컨텍스트 배지
  receipt_short: string                  // "OrchestrAI {mode}: {pct}% saved ({raw} → {final} tok)"
  receipt_short_no_savings: string       // "OrchestrAI {mode}: {n} tok"
  context_bundle_badge: string           // "⊟ {mode} · {intent} · {level}"
  context_levels_selection: string
  context_levels_active_symbol: string
  context_levels_active_file: string
  context_levels_related_files: string
  context_levels_project_summary: string
  context_levels_full_context: string
  gemini_cache_hit: string               // "Gemini cache ✓ HIT · {model}"
  gemini_cache_new: string               // "Gemini cache ↑ NEW · {model}"
  gemini_cache_detail: string            // "cached {cached} tok (재전송 X) + dynamic {dynamic} tok 만 전송"

  // routing 배지
  routing_to_model: string               // "↪ {model}에 {n}msg · ~{tok}tok"

  // hint chips (input footer)
  hint_refactor: string
  hint_refactor_prompt: string
  hint_git: string
  hint_git_prompt: string
  hint_explain: string
  hint_explain_prompt: string

  // attach 버튼 + image input
  attach_tooltip: string

  // custom provider 섹션 — 추가 버튼들
  custom_probe_local: string
  custom_add_manual: string
  custom_form_url: string
  custom_form_model: string
  custom_form_apikey: string
  custom_probe_none_found: string
  custom_active_label: string            // "{name} 활성"

  // 자주 보는 tooltip / 버튼 (Phase 2 후속)
  settings_btn_tooltip: string
  ctx_gauge_tooltip: string
  ctx_btn_tooltip: string
  voice_btn_tooltip: string
  progress_stop: string
  route_auto_tooltip: string
  mode_btn_tooltip: string                  // "Mode · Effort (Shift+Tab)"

  // contextWindow segment tooltips
  contextWindow_narrow_tooltip: string
  contextWindow_default_tooltip: string
  contextWindow_wide_tooltip: string
  contextWindow_full_tooltip: string

  // codexEngine segment tooltips
  codexEngine_native_tooltip: string
  codexEngine_legacy_tooltip: string

  // changed-files panel
  change_panel_toggle: string               // "펼치기/접기"
  change_file_open: string                  // "파일 열기"
  change_file_diff: string                  // "diff 보기"
  change_file_revert: string                // "이 파일만 되돌리기 (git checkout)"
  change_bulk_revert_turn: string           // 텍스트 + 툴팁
  change_bulk_revert_tooltip: string
  change_bulk_open_all: string
  change_bulk_open_all_tooltip: string

  // commit chip
  commit_revert_btn: string                 // "↶ 이 턴 되돌리기"
  commit_revert_tooltip: string             // "이 턴 변경을 되돌림 (parent commit으로 reset)"
  commit_revert_confirm: string             // confirm dialog
  bg_task_cancel: string                    // "작업 취소"
  fork_icon_tooltip: string

  // /style 분석 카드
  style_card_title: string
  style_card_subtitle: string            // "{n} assistant 응답 · {scope}"
  style_scope_active: string
  style_scope_all: string
  style_no_data: string
  style_col_model: string
  style_col_count: string
  style_col_avg_chars: string
  style_col_avg_lines: string
  style_col_code_pct: string
  style_col_emoji: string
  style_col_headers: string
  style_col_lists: string
  style_col_politeness: string
  style_col_lang: string
  style_col_start: string
  style_emoji_per1k: string              // "/1k chars"
  style_legend: string

  // 일반
  loading: string
  error_prefix: string
  required: string
}

const ko: StringsDict = {
  prefs_title: '환경설정',
  prefs_close: '닫기',
  prefs_section_captain: '🎯 대장 모델 + 활성 풀',
  prefs_label_captain: '대장 모델',
  prefs_captain_auto: 'auto (활성 중 우선순위)',
  prefs_captain_claude: 'Claude 강제',
  prefs_captain_codex: 'Codex 강제',
  prefs_captain_gemini: 'Gemini 강제',
  prefs_captain_none: '없음 (단순 라우터)',
  prefs_captain_hint: '↓ boomerang plan / argue judge / smart commit / synthesis 담당',
  prefs_active_claude: 'Claude 활성',
  prefs_active_codex: 'Codex 활성',
  prefs_active_gemini: 'Gemini 활성',
  prefs_active_hint: '비활성 시 라우팅·argue·boomerang 에서 제외됨.',

  prefs_section_custom: '🔧 Custom Provider (Ollama / LM Studio / OpenRouter)',
  prefs_section_models: '🧬 모델 변종 강제',
  prefs_label_claude: 'Claude',
  prefs_label_codex: 'Codex',
  prefs_label_gemini: 'Gemini',
  prefs_label_thinking: 'Thinking 모드',
  prefs_model_auto: 'auto (effort 따라)',

  prefs_section_token_budget: '🔢 토큰 절약 (v0.1.29+)',
  prefs_tokenBudget_enabled: 'Token-aware context projection',
  prefs_tokenBudget_tooltip: '활성 파일 통째로 보내지 말고 selection / 활성 심볼 / 요약으로 좁힘. 모델별로 다른 컨텍스트 (Claude 좁게, Gemini 넓게).',
  prefs_geminiCache_enabled: 'Gemini Context Cache (API key 필요)',
  prefs_geminiCache_tooltip: '큰 system prompt 를 Gemini API 캐시에 한 번 올리고 매 요청은 dynamic 만 전송. 캐시된 input ~25% 단가. Gemini API key 필요.',
  prefs_contextWindow_hint: '↓ 컨텍스트 모드 = narrow→Eco / default→Balanced / wide→Deep / full→Full(매 요청 확인)',

  prefs_section_router: '⚡ 라우터·엔진',
  prefs_label_contextWindow: '컨텍스트 윈도우',
  prefs_label_codexEngine: 'Codex 엔진',
  prefs_label_confidence: '라우터 신뢰도',
  prefs_confidence_hint: '↓ 낮을수록 LLM 라우터(Haiku) 더 자주 호출 → 정확도 ↑ 비용 ↑',

  prefs_section_automation: '🤖 자동화',
  prefs_autoGitCommit: '자동 git commit (체크포인트)',
  prefs_autoPreview: '자동 미리보기 (HTML→Browser, dev script ▶)',
  prefs_autoOpenDiff: '자동 IDE diff 열기',
  prefs_aiMagicComments: 'AI! / AI? 매직 코멘트 watch',
  prefs_inlineCompletion: 'Inline ghost text (Cursor 풍 자동완성)',

  prefs_section_rag: '🧭 코드베이스 RAG',
  prefs_rag_enabled: 'RAG 활성 (관련 chunk 자동 첨부)',
  prefs_rag_autoIndex: '파일 저장 시 자동 re-index',

  prefs_section_accounts: '🔐 계정',
  prefs_account_login: '로그인',
  prefs_account_logout: '로그아웃',
  prefs_account_connected: 'connected',
  prefs_account_disconnected: 'disconnected',
  prefs_geminiApiKey: 'Gemini API key',
  prefs_geminiApiKey_placeholder: '(이미지 생성·Context Cache 용 — 비워두면 OAuth)',
  prefs_geminiApiKey_saved_placeholder: '(저장됨 — 새 값 입력 시 덮어쓰기)',
  prefs_geminiApiKey_save: '저장',
  prefs_account_hint: '로그인은 OAuth 브라우저 창이 열려요. 모든 텍스트 호출은 구독·무료 티어로 우회 (API 과금 0원).',

  prefs_section_mcp: '🔌 MCP 서버',
  prefs_mcp_add: '+ MCP 서버 추가',
  prefs_mcp_empty: '등록된 MCP 서버 없음.',
  prefs_mcp_name: '이름',
  prefs_mcp_command: 'command',
  prefs_mcp_args: 'args (한 줄에 하나)',
  prefs_mcp_env: 'env (KEY=VAL, 한 줄에 하나, 선택)',
  prefs_mcp_save: '저장',
  prefs_mcp_cancel: '취소',
  prefs_mcp_delete: '삭제',
  prefs_mcp_delete_confirm: '한 번 더 클릭하면 삭제',
  prefs_mcp_hint: '서버는 사이드바 다시 열 때마다 자동 spawn 됨.',

  prefs_section_misc: '🗄 기타',
  prefs_misc_telegram: '✈ Telegram (원격 채팅)',
  prefs_misc_restoreArchive: '↺ 아카이브에서 대화 복원',
  prefs_misc_openArchives: '📂 아카이브 폴더 열기',
  prefs_misc_showLogs: '📜 로그 표시 (OUTPUT 채널)',
  prefs_misc_resetUsage: '🔄 세션 토큰 카운터 리셋',

  prefs_section_language: '🌐 언어 / Language',
  prefs_language_auto: 'auto (VSCode 설정)',
  prefs_language_ko: '한국어',
  prefs_language_en: 'English',

  tab_new: '+',
  tab_new_title: '새 탭',
  tab_close: '×',
  tab_close_tooltip: '탭 닫기',
  tab_rename: '✎ 이름 변경',
  tab_rename_prompt: '새 탭 이름:',
  tab_duplicate: '⎘ 복제 (모든 메시지 복사)',
  tab_fork_tooltip: '이 메시지까지의 history 복사해서 새 탭으로 — 다른 방향 탐색용',
  tab_fork_toast: '⑂ "{name}" 포크 — {n}msg 복사',
  tab_fork_no_target: '⚠ 포크 대상 메시지 못 찾음',
  tab_last_cant_close: '마지막 탭은 닫을 수 없어요. 비우려면 휴지통 사용.',

  mode_label: 'mode:',
  mode_auto: '✦ auto',
  mode_claude: '● claude',
  mode_codex: '○ codex',
  mode_gemini: '◆ gemini',
  mode_argue: '⚡ argue',
  mode_team: '👥 team',
  mode_loop: '🔁 loop',
  mode_boomerang: '🪃 boom',
  mode_auto_tooltip: 'auto: 라우터가 알아서 / claude·codex·gemini: 강제 (또는 @멘션)',
  mode_argue_tooltip: '셋이 토론 — 각자 자기 카드에 답하고 Haiku가 0~10점 채점 (최대 6턴)',
  mode_team_tooltip: '코드 위임 — Claude(설계) → Codex(구현) → Gemini(리뷰). 토론 X, 코드 작업 O',
  mode_loop_tooltip: '될 때까지 반복 (Ralph Wiggum) — 모델이 결과 검증 후 부족하면 자동 다음 iteration. max 5회',
  mode_boomerang_tooltip: '큰 작업 자동 분할 → 여러 모델 병렬 위임 → 결과 종합',

  input_placeholder: '무엇을 만들까요... (@ 치면 모델/명령 선택)',
  input_attach: '첨부',
  send: '전송',
  copy: 'copy',
  rollback: 'rollback',
  fork: '⑂ fork',
  fork_tooltip: '이 메시지까지 복사해서 새 탭으로',

  toast_steer_pushed: '📤 steering 전달됨 — AI 가 판단해서 처리',
  toast_steer_queued: '📤 다음 턴 시작 시 우선 전달됨',
  toast_steer_cancelled: 'Full Context 취소됨 — Balanced 로 진행',
  toast_steer_not_found: '⚠ 포크 대상 메시지 못 찾음',
  toast_cleared: '대화 초기화됐어요',
  toast_full_context_cancel: 'Full Context 취소됨',
  toast_apikey_saved: '✓ Gemini API key 저장',
  toast_apikey_removed: '✓ Gemini API key 제거',
  toast_mcp_saved: '✓ MCP "{name}" 저장. 다음 사이드바 열 때 자동 spawn.',
  toast_mcp_deleted: '✓ MCP "{name}" 삭제됨.',
  toast_min_active_required: '최소 1개는 활성 상태여야 합니다 — 기본값으로 복귀',

  receipt_saved_pct: '{pct}% saved',
  receipt_tok: '{n} tok',
  receipt_copied: 'Receipt 복사됨',

  argue_summary_title: '⚖ Argue 토큰 요약',
  argue_total_rounds: '총 {n} 라운드',
  argue_max_output: '가장 길게 답함',
  argue_cache_summary: 'cache 재사용',
  argue_summarizing: '⊟ R{round} {model} 요약 중... (다음 라운드 input 절약)',
  argue_cap: 'cap {n}자',

  ctx_memory: '🧠 memory',
  ctx_reset: 'reset',
  ctx_reset_confirm: '클릭하면 대화 리셋 (컨텍스트 초기화)',
  ctx_file_on: '파일 컨텍스트 켜짐',
  ctx_file_off: '파일 컨텍스트 꺼짐',
  ctx_no_file: 'no file',

  routing_force: 'force',
  routing_mention: '@ mention',
  routing_override: 'override',
  routing_argue_open: 'argue · 선공',
  routing_argue_reply: 'argue · 반박',

  full_context_warning: 'Full Context Mode: 활성 파일 전체 + 관련 파일 + 프로젝트 요약을 모든 모델에 보냅니다.\n\nClaude/GPT/Gemini 쿼터 사용량이 크게 늘 수 있습니다. 진행하시겠어요?',
  full_context_continue: '진행',
  full_context_balanced: 'Balanced 로 진행',

  usage_title: '📊 Account & Usage',
  usage_session_elapsed: '세션 시작 이후 {time}',
  usage_saved_estimate: '💰 절약 추정',
  usage_zero_billing: '(구독 우회로 실제 청구 0)',
  usage_requests: '요청',
  usage_reset_btn: '세션 카운터 리셋',
  usage_plan_claude_max: 'Claude Pro/Max',
  usage_plan_chatgpt_pro: 'ChatGPT Pro',
  usage_plan_gemini_free: 'Google 무료 티어',
  usage_limit_claude_hint: '5시간 단위 롤링 한도 (`claude /status`로 정확히 확인)',
  usage_limit_codex_hint: 'gpt-5.5/5.4 사용량 주간 한도',
  usage_limit_gemini_hint: '60 req/min · 1000 req/day',
  usage_footer_note: '대화 게이지는 세션 누적치 기반 추정치예요. 정확한 잔여량은:',
  usage_cache_legend: '⚡ cache_read = SDK 자동 prompt cache 재사용 (10% 단가) · ↑ cache_write = 1회성 캐시 생성 (1.25배) · 📦 cached_in = Gemini Context Cache (25% 단가)',

  argue_board_title: 'argue 판정 (Claude Haiku) · 0~10점',
  argue_judging: '채점중...',
  argue_models_header: 'model',
  argue_input_header: '↓ input',
  argue_output_header: '↑ output',
  argue_rounds_header: 'rounds',
  argue_cache_header: '⚡ cache',
  argue_verdict_label: '판정:',
  argue_cache_claude_summary: 'Claude prompt cache: {n} tok 재사용 (청구 X 처리됨)',
  argue_cache_claude_creation: 'Claude cache 생성: {n} tok (1회성)',
  argue_cache_gemini_summary: 'Gemini Context Cache: {n} tok cached (~25% 단가)',
  argue_round_tokens: 'R{round} {model}: in {input} / out {output} tok',
  argue_max_output_model: '가장 길게 답함: {model} ({n} tok)',
  argue_total_summary: '총 {rounds} 라운드 · input {in} · output {out} · total {total} tok',

  receipt_short: 'OrchestrAI {mode}: {pct}% saved ({raw} → {final} tok)',
  receipt_short_no_savings: 'OrchestrAI {mode}: {n} tok',
  context_bundle_badge: '⊟ {mode} · {intent} · {level}',
  context_levels_selection: 'Selection',
  context_levels_active_symbol: 'ActiveSymbol',
  context_levels_active_file: 'ActiveFile',
  context_levels_related_files: 'RelatedFiles',
  context_levels_project_summary: 'ProjectSummary+Diff',
  context_levels_full_context: 'FullContext',
  gemini_cache_hit: 'Gemini cache ✓ HIT · {model}',
  gemini_cache_new: 'Gemini cache ↑ NEW · {model}',
  gemini_cache_detail: 'cached {cached} tok (재전송 X) + dynamic {dynamic} tok 만 전송',

  routing_to_model: '↪ {model}에 {n}msg · ~{tok}tok',

  hint_refactor: '리팩토링',
  hint_refactor_prompt: '전체 구조 리팩토링해줘',
  hint_git: 'git',
  hint_git_prompt: 'git commit 메시지 써줘',
  hint_explain: '설명',
  hint_explain_prompt: '이 코드 어떻게 동작해?',

  attach_tooltip: '파일 첨부 (이미지/PDF/텍스트/코드 — Claude Code 수준)',

  custom_probe_local: '🔍 로컬 LLM 자동 감지 (Ollama / LM Studio)',
  custom_add_manual: '+ 수동 추가 (OpenRouter 등)',
  custom_form_url: 'URL',
  custom_form_model: '모델 ID',
  custom_form_apikey: 'API Key',
  custom_probe_none_found: '로컬 LLM 서버 발견 안 됨 — Ollama (port 11434) 또는 LM Studio (port 1234) 실행 중인지 확인',
  custom_active_label: '{name} 활성',

  settings_btn_tooltip: '환경설정',
  ctx_gauge_tooltip: '클릭하면 대화 리셋 (컨텍스트 초기화)',
  ctx_btn_tooltip: '현재 파일 컨텍스트 자동 주입',
  voice_btn_tooltip: '음성 입력',
  progress_stop: '중단',
  route_auto_tooltip: '라우터가 작업 보고 모델 자동 선택',
  mode_btn_tooltip: 'Mode · Effort (Shift+Tab)',

  contextWindow_narrow_tooltip: 'Eco: selection·활성 심볼만, 자동 멀티모델 X. 토큰 최저.',
  contextWindow_default_tooltip: 'Balanced: selection·활성 심볼·관련 snippets·diff. 권장.',
  contextWindow_wide_tooltip: 'Deep: 활성 파일+관련 파일+심볼 그래프+RAG+diff. 복잡한 작업.',
  contextWindow_full_tooltip: '⚠ Full: 전 워크스페이스. 매 요청 확인 모달. OAuth/API 쿼터 폭주 위험.',

  codexEngine_native_tooltip: 'OpenAI 공식 codex.exe MCP (권장)',
  codexEngine_legacy_tooltip: '자체 fetch chatgpt.com 백엔드',

  change_panel_toggle: '펼치기/접기',
  change_file_open: '파일 열기',
  change_file_diff: 'diff 보기',
  change_file_revert: '이 파일만 되돌리기 (git checkout)',
  change_bulk_revert_turn: '↶ 이 turn 다 되돌리기',
  change_bulk_revert_tooltip: '이 turn 의 모든 변경 되돌리기',
  change_bulk_open_all: '↗ 전부 열기',
  change_bulk_open_all_tooltip: '변경 파일 전부 에디터 탭에 열기',

  commit_revert_btn: '↶ 이 턴 되돌리기',
  commit_revert_tooltip: '이 턴 변경을 되돌림 (parent commit으로 reset)',
  commit_revert_confirm: '이 턴 작업을 되돌리고 이전 상태로 reset 하시겠어요? (git reset --hard {hash}^)',
  bg_task_cancel: '작업 취소',
  fork_icon_tooltip: '포크',

  style_card_title: '📊 모델 스타일 분석',
  style_card_subtitle: '{n} assistant 응답 · {scope}',
  style_scope_active: '현재 탭',
  style_scope_all: '모든 탭',
  style_no_data: '분석할 assistant 응답이 없어요. 모델 호출 몇 번 한 뒤 다시 시도해보세요.',
  style_col_model: '모델',
  style_col_count: '응답수',
  style_col_avg_chars: '평균 길이',
  style_col_avg_lines: '평균 줄수',
  style_col_code_pct: '코드 포함',
  style_col_emoji: '이모지',
  style_col_headers: '헤더',
  style_col_lists: '리스트',
  style_col_politeness: '정중함',
  style_col_lang: '한·영 비율',
  style_col_start: '자주 쓰는 시작',
  style_emoji_per1k: '/1k자',
  style_legend: '⚡ 코드 포함 = 코드 블록(```) 있는 메시지 비율 · 이모지/헤더/리스트 = 1000자당 빈도 · 정중함 = "요/습니다/감사/please/sorry" 등 신호 빈도 (0~1) · 한·영 비율 = 코드 제외 본문',

  loading: '로딩 중...',
  error_prefix: '⚠ 에러',
  required: '필수',
}

const en: StringsDict = {
  prefs_title: 'Preferences',
  prefs_close: 'Close',
  prefs_section_captain: '🎯 Captain Model + Active Pool',
  prefs_label_captain: 'Captain',
  prefs_captain_auto: 'auto (priority within active)',
  prefs_captain_claude: 'Force Claude',
  prefs_captain_codex: 'Force Codex',
  prefs_captain_gemini: 'Force Gemini',
  prefs_captain_none: 'None (simple router)',
  prefs_captain_hint: '↓ Handles boomerang plan / argue judge / smart commit / synthesis',
  prefs_active_claude: 'Claude active',
  prefs_active_codex: 'Codex active',
  prefs_active_gemini: 'Gemini active',
  prefs_active_hint: 'Inactive providers are excluded from routing · argue · boomerang.',

  prefs_section_custom: '🔧 Custom Provider (Ollama / LM Studio / OpenRouter)',
  prefs_section_models: '🧬 Force Model Variant',
  prefs_label_claude: 'Claude',
  prefs_label_codex: 'Codex',
  prefs_label_gemini: 'Gemini',
  prefs_label_thinking: 'Thinking mode',
  prefs_model_auto: 'auto (by effort)',

  prefs_section_token_budget: '🔢 Token Budget (v0.1.29+)',
  prefs_tokenBudget_enabled: 'Token-aware context projection',
  prefs_tokenBudget_tooltip: 'Instead of sending the entire active file, narrow context to selection / active symbol / summary. Different context per model (Claude tight, Gemini wide).',
  prefs_geminiCache_enabled: 'Gemini Context Cache (API key required)',
  prefs_geminiCache_tooltip: 'Upload large system prompt to Gemini API cache once, send only dynamic per request. Cached input ~25% price. Requires Gemini API key.',
  prefs_contextWindow_hint: '↓ Context mode = narrow→Eco / default→Balanced / wide→Deep / full→Full (per-request confirmation)',

  prefs_section_router: '⚡ Router · Engine',
  prefs_label_contextWindow: 'Context window',
  prefs_label_codexEngine: 'Codex engine',
  prefs_label_confidence: 'Router confidence',
  prefs_confidence_hint: '↓ Lower → LLM router (Haiku) called more often → higher accuracy, higher cost',

  prefs_section_automation: '🤖 Automation',
  prefs_autoGitCommit: 'Auto git commit (checkpoint)',
  prefs_autoPreview: 'Auto preview (HTML→Browser, dev script ▶)',
  prefs_autoOpenDiff: 'Auto open IDE diff',
  prefs_aiMagicComments: 'AI! / AI? magic comment watch',
  prefs_inlineCompletion: 'Inline ghost text (Cursor-style completion)',

  prefs_section_rag: '🧭 Codebase RAG',
  prefs_rag_enabled: 'RAG enabled (auto-attach relevant chunks)',
  prefs_rag_autoIndex: 'Auto re-index on file save',

  prefs_section_accounts: '🔐 Accounts',
  prefs_account_login: 'Log in',
  prefs_account_logout: 'Log out',
  prefs_account_connected: 'connected',
  prefs_account_disconnected: 'disconnected',
  prefs_geminiApiKey: 'Gemini API key',
  prefs_geminiApiKey_placeholder: '(For image generation · Context Cache — leave empty for OAuth)',
  prefs_geminiApiKey_saved_placeholder: '(saved — enter new value to overwrite)',
  prefs_geminiApiKey_save: 'Save',
  prefs_account_hint: 'Login opens an OAuth browser window. All text calls go through subscription / free tiers (no API charges).',

  prefs_section_mcp: '🔌 MCP Servers',
  prefs_mcp_add: '+ Add MCP Server',
  prefs_mcp_empty: 'No MCP servers registered.',
  prefs_mcp_name: 'Name',
  prefs_mcp_command: 'command',
  prefs_mcp_args: 'args (one per line)',
  prefs_mcp_env: 'env (KEY=VAL, one per line, optional)',
  prefs_mcp_save: 'Save',
  prefs_mcp_cancel: 'Cancel',
  prefs_mcp_delete: 'Delete',
  prefs_mcp_delete_confirm: 'Click again to delete',
  prefs_mcp_hint: 'Servers auto-spawn when sidebar reopens.',

  prefs_section_misc: '🗄 Other',
  prefs_misc_telegram: '✈ Telegram (remote chat)',
  prefs_misc_restoreArchive: '↺ Restore conversation from archive',
  prefs_misc_openArchives: '📂 Open archive folder',
  prefs_misc_showLogs: '📜 Show logs (OUTPUT channel)',
  prefs_misc_resetUsage: '🔄 Reset session token counter',

  prefs_section_language: '🌐 Language',
  prefs_language_auto: 'auto (VSCode setting)',
  prefs_language_ko: '한국어',
  prefs_language_en: 'English',

  tab_new: '+',
  tab_new_title: 'New tab',
  tab_close: '×',
  tab_close_tooltip: 'Close tab',
  tab_rename: '✎ Rename',
  tab_rename_prompt: 'New tab name:',
  tab_duplicate: '⎘ Duplicate (copy all messages)',
  tab_fork_tooltip: 'Copy history up to this message into a new tab — explore another direction',
  tab_fork_toast: '⑂ "{name}" forked — {n} msgs copied',
  tab_fork_no_target: '⚠ Fork target message not found',
  tab_last_cant_close: 'Last tab cannot be closed. Use trash to clear.',

  mode_label: 'mode:',
  mode_auto: '✦ auto',
  mode_claude: '● claude',
  mode_codex: '○ codex',
  mode_gemini: '◆ gemini',
  mode_argue: '⚡ argue',
  mode_team: '👥 team',
  mode_loop: '🔁 loop',
  mode_boomerang: '🪃 boom',
  mode_auto_tooltip: 'auto: router decides / claude·codex·gemini: force (or @mention)',
  mode_argue_tooltip: 'Three-way debate — each answers in own card, Haiku scores 0~10 (max 6 turns)',
  mode_team_tooltip: 'Code delegation — Claude (design) → Codex (implement) → Gemini (review). No debate, code work.',
  mode_loop_tooltip: 'Repeat until done (Ralph Wiggum) — model verifies result, auto next iteration if lacking. Max 5.',
  mode_boomerang_tooltip: 'Auto-split big task → parallel multi-model delegation → synthesize results',

  input_placeholder: 'What shall we build... (@ to pick model/command)',
  input_attach: 'Attach',
  send: 'Send',
  copy: 'copy',
  rollback: 'rollback',
  fork: '⑂ fork',
  fork_tooltip: 'Copy up to this message into a new tab',

  toast_steer_pushed: '📤 Steering delivered — AI will decide how to handle',
  toast_steer_queued: '📤 Queued for next turn',
  toast_steer_cancelled: 'Full Context cancelled — proceeding with Balanced',
  toast_steer_not_found: '⚠ Fork target message not found',
  toast_cleared: 'Conversation cleared',
  toast_full_context_cancel: 'Full Context cancelled',
  toast_apikey_saved: '✓ Gemini API key saved',
  toast_apikey_removed: '✓ Gemini API key removed',
  toast_mcp_saved: '✓ MCP "{name}" saved. Will auto-spawn on next sidebar open.',
  toast_mcp_deleted: '✓ MCP "{name}" deleted.',
  toast_min_active_required: 'At least one must stay active — reverting to defaults',

  receipt_saved_pct: '{pct}% saved',
  receipt_tok: '{n} tok',
  receipt_copied: 'Receipt copied',

  argue_summary_title: '⚖ Argue Token Summary',
  argue_total_rounds: 'Total {n} rounds',
  argue_max_output: 'Longest output',
  argue_cache_summary: 'cache reused',
  argue_summarizing: '⊟ R{round} {model} summarizing... (saves next-round input)',
  argue_cap: 'cap {n} chars',

  ctx_memory: '🧠 memory',
  ctx_reset: 'reset',
  ctx_reset_confirm: 'Click to reset conversation (clear context)',
  ctx_file_on: 'File context ON',
  ctx_file_off: 'File context OFF',
  ctx_no_file: 'no file',

  routing_force: 'force',
  routing_mention: '@ mention',
  routing_override: 'override',
  routing_argue_open: 'argue · opening',
  routing_argue_reply: 'argue · reply',

  full_context_warning: 'Full Context Mode: sends entire active file + related files + project summary to ALL models.\n\nClaude/GPT/Gemini quota usage may increase significantly. Continue?',
  full_context_continue: 'Continue',
  full_context_balanced: 'Use Balanced',

  usage_title: '📊 Account & Usage',
  usage_session_elapsed: '{time} since session start',
  usage_saved_estimate: '💰 Estimated saved',
  usage_zero_billing: '(actual bill 0 via subscription bypass)',
  usage_requests: 'requests',
  usage_reset_btn: 'Reset session counter',
  usage_plan_claude_max: 'Claude Pro/Max',
  usage_plan_chatgpt_pro: 'ChatGPT Pro',
  usage_plan_gemini_free: 'Google Free Tier',
  usage_limit_claude_hint: '5-hour rolling quota (use `claude /status` for exact)',
  usage_limit_codex_hint: 'gpt-5.5/5.4 weekly usage limit',
  usage_limit_gemini_hint: '60 req/min · 1000 req/day',
  usage_footer_note: 'Gauges are session-cumulative estimates. For accurate remaining quota:',
  usage_cache_legend: '⚡ cache_read = SDK auto prompt cache reuse (10% price) · ↑ cache_write = one-time cache creation (1.25×) · 📦 cached_in = Gemini Context Cache (25% price)',

  argue_board_title: 'argue verdict (Claude Haiku) · 0~10 score',
  argue_judging: 'scoring...',
  argue_models_header: 'model',
  argue_input_header: '↓ input',
  argue_output_header: '↑ output',
  argue_rounds_header: 'rounds',
  argue_cache_header: '⚡ cache',
  argue_verdict_label: 'verdict:',
  argue_cache_claude_summary: 'Claude prompt cache: {n} tok reused (no charge)',
  argue_cache_claude_creation: 'Claude cache creation: {n} tok (one-time)',
  argue_cache_gemini_summary: 'Gemini Context Cache: {n} tok cached (~25% price)',
  argue_round_tokens: 'R{round} {model}: in {input} / out {output} tok',
  argue_max_output_model: 'Longest output: {model} ({n} tok)',
  argue_total_summary: 'Total {rounds} rounds · input {in} · output {out} · total {total} tok',

  receipt_short: 'OrchestrAI {mode}: {pct}% saved ({raw} → {final} tok)',
  receipt_short_no_savings: 'OrchestrAI {mode}: {n} tok',
  context_bundle_badge: '⊟ {mode} · {intent} · {level}',
  context_levels_selection: 'Selection',
  context_levels_active_symbol: 'ActiveSymbol',
  context_levels_active_file: 'ActiveFile',
  context_levels_related_files: 'RelatedFiles',
  context_levels_project_summary: 'ProjectSummary+Diff',
  context_levels_full_context: 'FullContext',
  gemini_cache_hit: 'Gemini cache ✓ HIT · {model}',
  gemini_cache_new: 'Gemini cache ↑ NEW · {model}',
  gemini_cache_detail: 'cached {cached} tok (not resent) + dynamic {dynamic} tok only',

  routing_to_model: '↪ to {model} · {n} msgs · ~{tok} tok',

  hint_refactor: 'Refactor',
  hint_refactor_prompt: 'Refactor the overall structure',
  hint_git: 'git',
  hint_git_prompt: 'Write a git commit message',
  hint_explain: 'Explain',
  hint_explain_prompt: 'How does this code work?',

  attach_tooltip: 'Attach file (image / PDF / text / code — Claude Code level)',

  custom_probe_local: '🔍 Auto-detect local LLM (Ollama / LM Studio)',
  custom_add_manual: '+ Add manually (OpenRouter etc.)',
  custom_form_url: 'URL',
  custom_form_model: 'Model ID',
  custom_form_apikey: 'API Key',
  custom_probe_none_found: 'No local LLM server found — check if Ollama (port 11434) or LM Studio (port 1234) is running',
  custom_active_label: '{name} active',

  settings_btn_tooltip: 'Preferences',
  ctx_gauge_tooltip: 'Click to reset conversation (clear context)',
  ctx_btn_tooltip: 'Auto-inject current file context',
  voice_btn_tooltip: 'Voice input',
  progress_stop: 'Stop',
  route_auto_tooltip: 'Router picks model based on task',
  mode_btn_tooltip: 'Mode · Effort (Shift+Tab)',

  contextWindow_narrow_tooltip: 'Eco: selection / active symbol only, no auto multi-model. Min tokens.',
  contextWindow_default_tooltip: 'Balanced: selection · active symbol · related snippets · diff. Recommended.',
  contextWindow_wide_tooltip: 'Deep: active file + related files + symbol graph + RAG + diff. Complex work.',
  contextWindow_full_tooltip: '⚠ Full: entire workspace. Per-request confirmation. OAuth/API quota risk.',

  codexEngine_native_tooltip: 'OpenAI official codex.exe MCP (recommended)',
  codexEngine_legacy_tooltip: 'Self-fetch chatgpt.com backend',

  change_panel_toggle: 'Expand/collapse',
  change_file_open: 'Open file',
  change_file_diff: 'View diff',
  change_file_revert: 'Revert this file only (git checkout)',
  change_bulk_revert_turn: '↶ Revert this turn',
  change_bulk_revert_tooltip: 'Revert all changes in this turn',
  change_bulk_open_all: '↗ Open all',
  change_bulk_open_all_tooltip: 'Open all changed files in editor tabs',

  commit_revert_btn: '↶ Revert this turn',
  commit_revert_tooltip: 'Revert this turn (git reset --hard to parent commit)',
  commit_revert_confirm: 'Revert this turn and reset to previous state? (git reset --hard {hash}^)',
  bg_task_cancel: 'Cancel task',
  fork_icon_tooltip: 'Fork',

  style_card_title: '📊 Model Style Analysis',
  style_card_subtitle: '{n} assistant responses · {scope}',
  style_scope_active: 'current tab',
  style_scope_all: 'all tabs',
  style_no_data: 'No assistant responses to analyze yet. Make a few model calls and try again.',
  style_col_model: 'model',
  style_col_count: 'count',
  style_col_avg_chars: 'avg chars',
  style_col_avg_lines: 'avg lines',
  style_col_code_pct: 'code %',
  style_col_emoji: 'emoji',
  style_col_headers: 'headers',
  style_col_lists: 'lists',
  style_col_politeness: 'politeness',
  style_col_lang: 'EN/KR ratio',
  style_col_start: 'common starts',
  style_emoji_per1k: '/1k chars',
  style_legend: '⚡ code % = messages with code blocks (```) · emoji/headers/lists = per 1000 chars · politeness = "please/sorry/요/습니다" signals (0~1) · EN/KR = excluding code',

  loading: 'Loading...',
  error_prefix: '⚠ Error',
  required: 'required',
}

export const STRINGS: Record<Locale, StringsDict> = { ko, en }
