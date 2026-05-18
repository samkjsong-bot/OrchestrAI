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
  usage_plan_claude_max: 'Claude Max',
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
  usage_plan_claude_max: 'Claude Max',
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

  loading: 'Loading...',
  error_prefix: '⚠ Error',
  required: 'required',
}

export const STRINGS: Record<Locale, StringsDict> = { ko, en }
