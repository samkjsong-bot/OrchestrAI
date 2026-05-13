# OrchestrAI Final Implementation Directive

## Token-Aware Multi-Model Orchestration Upgrade

This document is the final implementation directive for upgrading the existing **OrchestrAI VS Code extension** into a token-aware, context-budgeted, multi-model orchestration system.

The target reader is an implementation agent working directly inside the existing OrchestrAI repository.

---

## 0. Executive Summary

OrchestrAI already has the right product direction: a VS Code extension that coordinates multiple AI models such as Claude, Codex/GPT, Gemini, local models, team mode, argue mode, RAG, Telegram bridge, and code review flows.

However, the current architecture is at risk of becoming a **token-consuming monster** because multi-model orchestration can easily multiply the same context across several providers.

The goal of this upgrade is not to rebuild OrchestrAI from scratch.

The goal is to add a **token-aware context budgeting layer** on top of the existing system.

The final product promise should be:

> OrchestrAI does not blindly send your entire workspace to every AI.  
> It routes the smallest useful context to each model and shows the user what was sent.

Short positioning:

> **Token-aware multi-model orchestration.**  
> Claude, Codex/GPT, Gemini, and local models — routed with the smallest useful context.

Korean positioning:

> **여러 AI를 쓰되, 토큰은 아껴 씁니다.**

---

## 1. Non-Negotiable Implementation Principle

Do **not** perform a large architecture rewrite first.

The repository already has working structure and features. Patch around the existing architecture, then gradually extract/refactor only where necessary.

### Do not start by creating an entirely new orchestration system.

Avoid this as the first step:

```txt
src/orchestration/Orchestrator.ts
src/orchestration/ModelRouter.ts
src/orchestration/EverythingNew.ts
```

Instead, integrate with the current system:

```txt
src/extension.ts
src/router/orchestrator.ts
src/providers/*
src/util/history.ts
src/util/compaction.ts
src/util/usage.ts
webview/chat.html
package.json
```

The first milestone must be **minimal-disruption token budgeting**, not a full rewrite.

---

## 2. Current Repository Assumptions

The existing repository already contains or appears to contain the following major areas:

```txt
src/
  auth/
  providers/
  router/
  team/
  telegram/
  util/
  extension.ts
webview/
  chat.html
```

Important existing responsibilities:

```txt
src/extension.ts
  Main VS Code extension backend / command provider / webview bridge / model call flow.

webview/chat.html
  Main UI and chat surface.

src/router/orchestrator.ts
  Existing mention / pattern / LLM routing logic.

src/providers/*
  Existing Claude / Codex or GPT / Gemini / custom provider calls.

src/util/history.ts
  Existing model-specific conversation trimming and context management.

src/util/compaction.ts
  Existing conversation compaction / summary logic.

src/util/usage.ts
  Existing usage tracking and token/session metrics.

package.json
  Existing settings including orchestrai.contextWindow = narrow / default / wide.
```

The upgrade must preserve existing functionality:

```txt
- auto routing
- direct Claude mode
- direct Codex/GPT mode
- direct Gemini mode
- argue mode
- team mode
- loop mode
- boomerang mode
- RAG / repo map
- multi-model code review
- Telegram bridge
- custom providers
- usage display
- chat persistence
```

No existing user-facing workflow should be broken.

---

## 3. Core Problem

The current risk is context multiplication.

A bad multi-model flow looks like this:

```txt
User asks one question
  -> attach recent chat history
  -> attach current file
  -> attach RAG snippets
  -> attach repo map
  -> attach git diff
  -> attach summaries
  -> send the same large bundle to Claude
  -> send the same large bundle to Codex/GPT
  -> send the same large bundle to Gemini
  -> send all raw model answers to a synthesizer
```

This can easily turn a useful 2,000-token request into a 30,000-token multi-model request.

The upgrade must prevent that.

---

## 4. Desired Architecture

The desired architecture is:

```txt
User request
  -> intent detection
  -> context budget selection
  -> candidate context collection
  -> secret filtering
  -> token estimation
  -> model-specific context projection
  -> provider execution
  -> compressed synthesis
  -> token receipt UI
```

The key architectural concept is **model-specific context projection**.

Do not send the same context to every model.

Each model should receive only what it needs.

---

## 5. Model Roles

### 5.1 Local Gemma / Local Model

Role:

```txt
- context extraction
- intent classification
- related-file detection
- code slicing
- summarization
- missing-context warning
- token budget preparation
```

Important:

Gemma or any local model is not the final authority. It is a local context worker.

It can read larger local content because it does not consume remote API or OAuth quota.

Gemma implementation is **not Phase 1** unless the local provider abstraction is already ready.

### 5.2 Gemini API

Role:

```txt
- long-context project memory
- architecture-level understanding
- workspace summary
- cached context reuse
- large multi-file reasoning when needed
```

Preferred input:

```txt
cached project context reference
+ user question
+ changed-file summaries
+ relevant git diff
+ selected raw code only when needed
```

Do not repeatedly send the entire project raw.

Gemini context caching is **Phase 3**, not Phase 1.

### 5.3 Claude / Codex-GPT OAuth

Role:

```txt
- expensive expert reasoning
- implementation review
- patch planning
- refactor critique
- edge-case detection
- final high-quality code reasoning
```

Preferred input:

```txt
user question
+ selected text if present
+ current symbol or active snippet
+ relevant related snippets
+ short summaries
+ git diff if relevant
+ explicit output format
```

Avoid by default:

```txt
- full project dump
- entire chat history
- duplicated Gemini context
- large lock files
- full package-lock / yarn.lock unless dependency issue
- large generated files
- full test logs unless needed
- binary or base64 content
- secrets
```

### 5.4 Final Synthesizer

Role:

```txt
- merge model outputs
- surface disagreements
- produce final patch plan
- avoid hiding uncertainty
```

Do not send full raw answers when a structured summary is enough.

Preferred candidate format:

```json
{
  "model": "claude",
  "claims": ["..."],
  "proposedChanges": ["..."],
  "risks": ["..."],
  "confidence": 0.82
}
```

---

## 6. Context Budget Modes

Reuse and extend the existing `orchestrai.contextWindow` setting.

Existing values:

```txt
narrow
default
wide
```

Map them to token budget modes:

```txt
narrow  -> Eco
default -> Balanced
wide    -> Deep
```

Add a fourth mode:

```txt
full -> Full Context
```

### 6.1 Eco Mode

Purpose:

```txt
Minimum token usage.
```

Context:

```txt
- selected text if present
- otherwise current function / class / symbol
- small surrounding window
- minimal history
- no automatic multi-model fanout unless explicitly requested
```

Model strategy:

```txt
- one primary model
- no argue/team multi-model expansion by default
- local preprocessing if available
```

### 6.2 Balanced Mode

Purpose:

```txt
Default mode for normal coding assistance.
```

Context:

```txt
- selected text or active symbol
- active file summary
- relevant imports / exports
- small number of related snippets
- recent git diff when relevant
- compact recent history
```

Model strategy:

```txt
- model-specific projection
- optional Gemini summary/memory if cheap and available
- Claude or Codex/GPT only when useful
- no unnecessary duplicate context
```

### 6.3 Deep Mode

Purpose:

```txt
Complex bugs, refactors, architecture questions, multi-file reasoning.
```

Context:

```txt
- active file
- related files
- symbol graph
- RAG snippets
- git diff
- project summary
- diagnostics / terminal output if relevant
```

Model strategy:

```txt
- Gemini may receive broader context
- Claude/Codex receive focused expert projection
- synthesis receives compressed model summaries
```

### 6.4 Full Context Mode

Purpose:

```txt
Explicit user-requested broad workspace analysis.
```

Rules:

```txt
- Never enable automatically.
- Require explicit confirmation.
- Warn about OAuth/API quota usage.
- Still exclude secrets unless explicitly approved.
```

UX warning text:

```txt
Full Context Mode may significantly increase Claude/GPT/Gemini quota usage. Continue?
```

---

## 7. Context Level Ladder

Do not implement a fixed rule such as “always send 30 lines.”

Implement a dynamic ladder:

```ts
enum ContextLevel {
  SelectionOnly = 0,
  ActiveSymbol = 1,
  ActiveFileFocused = 2,
  RelatedFiles = 3,
  ProjectSummaryPlusDiff = 4,
  FullContextExplicit = 5
}
```

### Level 0 — SelectionOnly

Use when:

```txt
- user selected code
- question is local
- no cross-file dependency is required
```

Include:

```txt
- selected text
- file path
- language
- optional 10-30 surrounding lines
```

### Level 1 — ActiveSymbol

Use when:

```txt
- no selection
- cursor is inside a function / class / component
- issue appears local
```

Include:

```txt
- current symbol
- signature
- nearby type definitions if cheap
- directly used imports
```

### Level 2 — ActiveFileFocused

Use when:

```txt
- task concerns the active file
- component/module behavior matters
```

Include:

```txt
- active file summary
- relevant imports / exports
- selected or active symbol
- sibling helper functions
- local interfaces / types
```

### Level 3 — RelatedFiles

Use when:

```txt
- call graph crosses files
- imported function/type is central
- tests reference implementation
- runtime error points to multiple files
- schema/config/store/API route is involved
```

Include:

```txt
- relevant file summaries
- focused snippets only
- import/export chain
- matching test snippets
- relevant config snippets
```

### Level 4 — ProjectSummaryPlusDiff

Use when:

```txt
- architecture question
- refactor question
- review diff request
- multi-file change
- previous task state matters
```

Include:

```txt
- project summary
- repo map summary
- recent git diff
- ADR/session summary if available
- related snippets
```

### Level 5 — FullContextExplicit

Use only after explicit user approval.

---

## 8. Intent Classification

Before assembling context, classify the user request.

Implement or adapt an intent classifier using both deterministic heuristics and any existing router signal.

```ts
type IntentCategory =
  | "explain_code"
  | "bug_fix"
  | "implement_feature"
  | "refactor"
  | "write_tests"
  | "review_diff"
  | "architecture"
  | "debug_runtime_error"
  | "dependency_issue"
  | "security_review"
  | "performance_review"
  | "documentation"
  | "general_chat"
  | "unknown";
```

Default context level mapping:

```ts
const DEFAULT_CONTEXT_LEVEL_BY_INTENT: Record<IntentCategory, ContextLevel> = {
  explain_code: ContextLevel.ActiveSymbol,
  bug_fix: ContextLevel.RelatedFiles,
  implement_feature: ContextLevel.ProjectSummaryPlusDiff,
  refactor: ContextLevel.RelatedFiles,
  write_tests: ContextLevel.RelatedFiles,
  review_diff: ContextLevel.ProjectSummaryPlusDiff,
  architecture: ContextLevel.ProjectSummaryPlusDiff,
  debug_runtime_error: ContextLevel.RelatedFiles,
  dependency_issue: ContextLevel.RelatedFiles,
  security_review: ContextLevel.RelatedFiles,
  performance_review: ContextLevel.RelatedFiles,
  documentation: ContextLevel.ActiveFileFocused,
  general_chat: ContextLevel.SelectionOnly,
  unknown: ContextLevel.ActiveSymbol
};
```

Heuristic examples:

```txt
selected text exists
  -> prefer lower context level

stack trace detected
  -> include files from trace

mentions diff / review / changes
  -> include git diff

mentions architecture / design / 전체 구조 / 설계
  -> include project summary

mentions refactor this file
  -> active file focused

mentions entire project / whole workspace
  -> require Full Context confirmation or Deep mode suggestion
```

---

## 9. New Files to Add in Phase 1

Add these files first:

```txt
src/context/contextBudget.ts
src/context/contextBundle.ts
src/context/contextProjection.ts
src/context/secretScanner.ts
src/util/tokenReceipt.ts
```

Optional later files:

```txt
src/context/gemmaExtractor.ts
src/context/geminiCacheManager.ts
src/context/workspaceIndexAdapter.ts
```

Do not create a large parallel architecture unless necessary.

---

## 10. Phase 1 Data Types

### 10.1 TokenMode

```ts
export type TokenMode = "eco" | "balanced" | "deep" | "full";
```

### 10.2 ContextLevel

```ts
export enum ContextLevel {
  SelectionOnly = 0,
  ActiveSymbol = 1,
  ActiveFileFocused = 2,
  RelatedFiles = 3,
  ProjectSummaryPlusDiff = 4,
  FullContextExplicit = 5
}
```

### 10.3 CodeSnippet

```ts
export interface CodeSnippet {
  path: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  code: string;
  reason: string;
  relevanceScore?: number;
  tokenEstimate?: number;
}
```

### 10.4 ContextBundle

```ts
export interface ContextBundle {
  requestId: string;
  mode: TokenMode;
  intent: IntentCategory;
  contextLevel: ContextLevel;
  userQuestion: string;

  activeFile?: {
    path: string;
    language?: string;
    selectedText?: string;
    activeSymbolName?: string;
    focusedSnippet?: CodeSnippet;
    fileSummary?: string;
  };

  relatedSnippets: CodeSnippet[];
  relatedFileSummaries: Array<{
    path: string;
    summary: string;
    reason: string;
    tokenEstimate?: number;
  }>;

  gitDiff?: string;
  terminalOutput?: string;
  diagnostics?: unknown[];
  projectSummary?: string;
  sessionSummary?: string;

  safety: ContextSafetyReport;
  tokenEstimate: TokenEstimate;
}
```

### 10.5 TokenEstimate

```ts
export interface TokenEstimate {
  rawCandidateTokens: number;
  finalInputTokens: number;
  estimatedSavedTokens: number;
  compressionRatio: number;
  bySection: Record<string, number>;
}
```

### 10.6 ContextSafetyReport

```ts
export interface ContextSafetyReport {
  containsPotentialSecrets: boolean;
  blockedFiles: string[];
  warnings: string[];
  requiresUserApproval: boolean;
}
```

### 10.7 ModelContextProjection

```ts
export interface ModelContextProjection {
  modelProvider: "gemini" | "claude" | "codex" | "gpt" | "local" | "custom" | "synthesizer";
  prompt: string;
  messages?: unknown[];
  includedSections: string[];
  excludedSections: string[];
  tokenEstimate: number;
  reason: string;
}
```

### 10.8 TokenReceipt

```ts
export interface TokenReceipt {
  requestId: string;
  timestamp: number;
  mode: TokenMode;
  models: string[];
  rawCandidateTokens: number;
  finalSentTokens: number;
  estimatedSavedTokens: number;
  compressionRatio: number;
  sections: Record<string, number>;
  filesSent: Array<{
    path: string;
    lines?: [number, number];
    tokens: number;
    reason: string;
  }>;
  perModel?: Array<{
    model: string;
    tokens: number;
    includedSections: string[];
  }>;
}
```

---

## 11. Token Estimation

Implement a simple token estimator first:

```ts
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
```

Later, provider-specific tokenizers can be added.

Phase 1 must track:

```txt
- raw candidate context tokens
- final sent tokens
- estimated saved tokens
- compression ratio
- tokens by section
- tokens by model
- files/snippets sent
```

Compression formula:

```ts
const estimatedSavedTokens = Math.max(0, rawCandidateTokens - finalSentTokens);
const compressionRatio = rawCandidateTokens > 0
  ? finalSentTokens / rawCandidateTokens
  : 1;
```

UI saving percentage:

```ts
const savedPercent = rawCandidateTokens > 0
  ? Math.round((1 - finalSentTokens / rawCandidateTokens) * 100)
  : 0;
```

---

## 12. Context Projection Rules

### 12.1 Claude / Codex-GPT Projection

Claude and Codex/GPT are expensive expert models.

Include:

```txt
- user task
- selected text if present
- active symbol / focused snippet
- small relevant snippets
- short file summaries
- git diff if relevant
- explicit output format
```

Avoid:

```txt
- complete workspace
- full RAG dump
- full repo map
- full chat history
- Gemini full answer
- unnecessary logs
```

Prompt style:

```txt
You are receiving token-minimized context.
Do not assume unseen files.
If the context is insufficient, state exactly what additional file, symbol, or log is needed.
```

### 12.2 Gemini Projection

Gemini may receive broader context than Claude/Codex, especially when API mode and caching are available.

Include:

```txt
- project summary
- repo map summary
- session summary
- relevant snippets
- changed-file summaries
- git diff
```

Avoid:

```txt
- repeatedly sending unchanged full files
- duplicating summaries
- entire workspace raw unless Full Context approved
```

### 12.3 Synthesizer Projection

The synthesizer receives compressed candidate outputs, not all raw context again.

Include:

```txt
- user question
- compact context summary
- model claims
- proposed changes
- risks
- confidence
```

Avoid:

```txt
- raw full answers when not necessary
- raw code snippets already analyzed by expert models
- repeating full conversation history
```

---

## 13. Secret and Ignore Safety

Phase 1 must add `secretScanner.ts`.

Block or require approval for:

```txt
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
secrets.json
credentials.json
service-account*.json
private keys
API keys
tokens
certificates
production database dumps
```

Respect:

```txt
.gitignore
.orchestraiignore
```

Default exclusions:

```txt
node_modules
dist
build
coverage
.next
out
*.lock
*.min.js
large generated files
binary files
```

If a file is excluded, record it in the token receipt or safety report:

```txt
Excluded .env because it may contain secrets.
```

Full Context Mode must still exclude secrets unless explicitly approved.

---

## 14. Integration Points

### 14.1 package.json

Extend `orchestrai.contextWindow` enum.

Current:

```txt
narrow
default
wide
```

Add:

```txt
full
```

Update description to explain token budget mapping.

Example:

```txt
Controls context budget: narrow=Eco, default=Balanced, wide=Deep, full=Full Context with confirmation.
```

### 14.2 src/util/history.ts

Integrate token modes with existing history trimming.

Rules:

```txt
Eco:
  minimal recent turns only

Balanced:
  compact recent turns + summary

Deep:
  more history + session summary

Full:
  broader history after confirmation
```

Do not send the same long history to every model in multi-model mode.

### 14.3 src/util/compaction.ts

Use compaction output as reusable summaries.

Do not append both full history and full summary unless necessary.

### 14.4 src/util/usage.ts

Keep existing UsageTracker.

Add or integrate TokenReceipt without breaking existing usage display.

### 14.5 src/router/orchestrator.ts

Use existing routing signals to help choose:

```txt
- intent
- context level
- model plan
- whether to fan out to multiple models
```

Do not remove existing routing behavior.

### 14.6 src/extension.ts

This is likely the main integration surface.

Add a pre-provider phase:

```txt
collect editor state
-> determine token mode
-> classify intent
-> assemble context bundle
-> scan secrets
-> project context per model
-> estimate token usage
-> execute providers
-> create token receipt
-> update UI
```

Do not scatter token estimation directly inside every provider if avoidable.

### 14.7 webview/chat.html

Add UI for:

```txt
- token savings short display
- context mode indicator
- optional token receipt detail panel
- Full Context confirmation warning
```

Keep UI simple in Phase 1.

Example display:

```txt
OrchestrAI compressed context: 18,400 -> 3,200 tokens. Estimated saving: 82%.
```

---

## 15. Multi-Model Mode Rules

### 15.1 Argue Mode

Argue mode can become extremely expensive.

Rule:

```txt
Round 1 may receive broader context.
Round 2+ must receive compressed claims and disagreement summaries, not full source context again.
```

### 15.2 Team Mode

Team mode must use role-specific projections.

Example:

```txt
Reviewer:
  diff + focused snippets + risk checklist

Architect:
  project summary + relevant module summaries

Implementer:
  selected code + active symbol + related snippets

Tester:
  implementation snippet + test files + failure output
```

Do not send the same full bundle to every team member.

### 15.3 Loop Mode

Loop mode must avoid repeated raw context.

Rule:

```txt
Initial iteration: context bundle
Subsequent iterations: previous result summary + unresolved issues + minimal changed context
```

### 15.4 Boomerang Mode

Boomerang should also use the token receipt system.

Any handoff should include:

```txt
- what context was used
- what was omitted
- what needs re-checking
```

---

## 16. RAG Rules

RAG can save tokens or waste tokens.

Good RAG behavior:

```txt
- top 3 to 5 snippets by relevance
- line ranges, not entire files
- include reason for each snippet
- deduplicate overlapping snippets
- cap total RAG token budget by mode
```

Bad RAG behavior:

```txt
- attach 10+ large chunks
- attach entire files
- attach repo map + snippets + full file all together
- send same RAG dump to every model
```

Suggested RAG budgets:

```txt
Eco:      0-1 snippets, max about 800 tokens
Balanced: 2-4 snippets, max about 2,500 tokens
Deep:     5-8 snippets, max about 6,000 tokens
Full:     user-approved broader context
```

---

## 17. Token Receipt UX

The user must be able to see that OrchestrAI is protecting quota.

Short status:

```txt
OrchestrAI Eco: 84% saved
OrchestrAI Balanced: 3,200 / 18,400 tokens
OrchestrAI Deep: 3 models, 62% saved
```

Detailed receipt:

```txt
Request ID: orch-2026-xx
Mode: Balanced
Models: Claude, Gemini

Raw candidate context: 18,400 tokens
Final sent context: 3,200 tokens
Estimated saved: 15,200 tokens
Estimated saving: 82%

Claude:
- selectedText: 820 tokens
- relatedSnippets: 1,480 tokens
- gitDiff: 620 tokens

Gemini:
- projectSummary: 1,200 tokens
- gitDiff: 620 tokens
- relatedSummaries: 900 tokens

Excluded:
- .env: potential secret
- package-lock.json: not relevant to this request
```

Do not overcomplicate the UI in Phase 1. A status line plus an output-channel receipt is enough.

---

## 18. Implementation Phases

## Phase 1 — Minimum Viable Token Budgeting

This is the immediate target.

Implement:

```txt
1. TokenMode mapping from existing contextWindow
2. full mode added with confirmation
3. ContextLevel enum
4. ContextBundle type
5. ContextBudget resolver
6. ContextProjection per model
7. SecretScanner basic implementation
8. TokenEstimator
9. TokenReceipt
10. Integration into existing provider call flow
11. Basic UI display of token savings
```

Modify:

```txt
package.json
src/extension.ts
src/router/orchestrator.ts
src/util/history.ts
src/util/compaction.ts
src/util/usage.ts
webview/chat.html
```

Add:

```txt
src/context/contextBudget.ts
src/context/contextBundle.ts
src/context/contextProjection.ts
src/context/secretScanner.ts
src/util/tokenReceipt.ts
```

Phase 1 success criteria:

```txt
- npm run build passes
- existing modes still work
- token receipt is generated
- Claude/Codex/GPT do not receive full raw context by default
- Gemini can receive broader summary context
- Full Context requires confirmation
- obvious secret files are blocked
```

---

## Phase 2 — Local Gemma Context Extraction

Implement after Phase 1 is stable.

Add:

```txt
- local endpoint detection
- Ollama / llama.cpp / LM Studio support if compatible
- Gemma extraction prompt
- strict JSON parser
- fallback if local model unavailable
- confidence score
- missing context warnings
```

Gemma prompt purpose:

```txt
Do not solve the task.
Identify the minimum sufficient context for expensive remote models.
```

Gemma output:

```json
{
  "intent": "bug_fix",
  "recommendedContextLevel": 3,
  "relevantFiles": [
    {
      "path": "src/example.ts",
      "reason": "Contains the function called by the active symbol.",
      "priority": 0.91
    }
  ],
  "lineRanges": [
    {
      "path": "src/example.ts",
      "startLine": 40,
      "endLine": 95,
      "reason": "Relevant implementation range."
    }
  ],
  "compressedContextSummary": "...",
  "missingContextWarnings": [],
  "shouldEscalate": false,
  "confidence": 0.84
}
```

---

## Phase 3 — Gemini Cached Project Memory

Implement after Phase 1 and Phase 2 are stable.

Add:

```txt
- file hash tracking
- changed-file summary refresh
- project summary cache
- Gemini context cache manager
- cache invalidation
- cached context ID injection
```

Goal:

```txt
Gemini should act as the long-context project memory without repeatedly uploading unchanged raw source.
```

---

## Phase 4 — Refactor Large Files

Only after token budgeting works.

Candidates:

```txt
src/extension.ts
webview/chat.html
```

Do not start here.

Refactor only after behavior is protected by build/tests/manual smoke checks.

---

## 19. Build and Validation Requirements

After implementation:

```txt
npm run build
```

If tests exist:

```txt
npm test
```

Manual smoke tests:

```txt
1. Ask simple selected-code question in Eco mode.
2. Ask normal bug question in Balanced mode.
3. Ask multi-file architecture question in Deep mode.
4. Trigger argue/team mode and verify repeated rounds do not resend full context.
5. Try to include .env and verify it is blocked.
6. Select Full Context and verify explicit confirmation appears.
7. Verify token receipt appears in UI or output channel.
8. Verify Telegram bridge still works if applicable.
9. Verify existing provider calls still work.
```

---

## 20. Prompt Text for Expert Models

Use this instruction in Claude/Codex/GPT projections:

```txt
You are receiving a token-minimized context bundle.
Do not assume unseen files.
If the context is insufficient, say exactly what additional file, symbol, or log is needed.
Prefer actionable, patch-ready output.
Do not produce unnecessary long explanations.
```

Use this instruction in synthesizer projections:

```txt
Merge candidate model outputs into one implementation recommendation.
Surface disagreements.
Do not invent files or APIs not present in the context.
If context is insufficient, request the smallest additional context needed.
```

Use this instruction in local extractor projections later:

```txt
Your job is not to solve the task.
Your job is to identify the minimum sufficient context for expensive remote models.
Return strict JSON only.
```

---

## 21. What Not To Do

Do not:

```txt
- blindly send the same full context to every model
- implement fixed 30-line context logic
- enable Full Context automatically
- send secrets by default
- remove existing routing modes
- break existing provider contracts
- start with a large rewrite of extension.ts
- start with a large rewrite of webview/chat.html
- build Gemma/Gemini caching before basic token receipts work
- hide uncertainty from the user
- claim exact token counts when using only heuristic estimates
```

Do:

```txt
- estimate tokens transparently
- show approximate savings
- project context differently per model
- preserve existing behavior
- add safety gates
- make the first implementation small but real
```

---

## 22. First Concrete Task List

Start with these exact tasks:

```txt
1. Add TokenMode and ContextLevel types.
2. Map existing orchestrai.contextWindow to TokenMode.
3. Add full to package.json setting with warning description.
4. Create estimateTokens utility if not already available.
5. Create TokenReceipt type and factory.
6. Add ContextBundle type.
7. Add basic ContextBudget resolver.
8. Add model-specific ContextProjection builder.
9. Add basic SecretScanner.
10. Integrate projection before provider calls.
11. Record rawCandidateTokens and finalSentTokens.
12. Display short savings line in UI/output.
13. Confirm Full Context before sending broad context.
14. Run npm run build.
15. Fix type errors without changing product behavior.
```

---

## 23. Acceptance Criteria

This upgrade is acceptable when:

```txt
- The extension still builds.
- Existing modes still function.
- Token mode is visible or inferable.
- Token receipt is produced per request.
- Claude/Codex/GPT receive smaller focused prompts by default.
- Gemini can receive broader summary/project context without duplicating raw files.
- Multi-model modes avoid repeated full-context transmission after the first round.
- Secret-like files are excluded or require confirmation.
- Full Context Mode cannot be entered silently.
- The implementation is incremental and does not destabilize the whole extension.
```

---

## 24. Final Instruction to the Implementer

Implement this as a **token-aware context layer on top of the existing OrchestrAI repository**.

Do not treat this as a greenfield rewrite.

The most valuable first deliverable is:

> Balanced Mode with selectedText/currentSymbol priority, related snippets, git diff when relevant, model-specific context projection, token estimation, token receipt, and Full Context confirmation.

After this works, proceed to:

```txt
Phase 2: Local Gemma context extraction
Phase 3: Gemini cached project memory
Phase 4: large-file refactor
```

The product must move from:

```txt
Multi-model = token multiplication
```

to:

```txt
Multi-model = role-based minimal context routing
```

That is the core upgrade.
