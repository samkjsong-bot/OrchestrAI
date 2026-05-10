<div align="center">

# 🎼 OrchestrAI

### **Claude · Codex · Gemini** — auto-routing, debate, and collaboration in one VSCode sidebar

`auto-route` · `argue ⚡` · `team 👥` · `loop 🔁` · `boomerang 🪃` · `RAG 🧭` · `Telegram 📱` · `zero billing 💰`

**Zero extra API billing** — uses your existing subscriptions and free tiers

[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![VSCode](https://img.shields.io/badge/VSCode-1.98%2B-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=samkj.orchestrai)
[![Marketplace](https://img.shields.io/badge/Marketplace-OrchestrAI-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=samkj.orchestrai)

**[🛒 Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=samkj.orchestrai)** · [📦 Releases](https://github.com/samkjsong-bot/OrchestrAI/releases) · [📖 CODEMAP](./CODEMAP.md) · [🐛 Issues](https://github.com/samkjsong-bot/OrchestrAI/issues)

```
ext install samkj.orchestrai
```

**English** · [한국어](./README.ko.md)

</div>

---

## ✨ At a glance

| | OrchestrAI | Cursor | Continue | Cline/Roo | Copilot |
|---|---|---|---|---|---|
| Multi-model auto routing | ✅ pattern + LLM | ❌ manual | ❌ manual | ❌ manual | ❌ manual |
| **Model debate** (argue) | ✅ scored 0–10 | ❌ | ❌ | ❌ | ❌ |
| **Team mode** Claude → Codex/Gemini delegation | ✅ | ❌ | ❌ | Roo only | ❌ |
| **Boomerang task** auto-split + parallel | ✅ | ❌ | ❌ | Roo only | ❌ |
| **Ralph Wiggum loop** until-it-works | ✅ | ❌ | ❌ | ❌ | ❌ |
| Codebase RAG | ✅ | ✅ | ✅ | ❌ | △ |
| **Multi-model code review** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Telegram phone bridge** Hub/Worker | ✅ | ❌ | ❌ | ❌ | ❌ |
| Background agent + push notification | ✅ + Telegram | ✅ | ❌ | ❌ | ❌ |
| Multi-IDE sync (OneDrive/Dropbox) | ✅ | △ | ❌ | ❌ | △ |
| **Agent marketplace** (Gist-based) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Inline ghost text completion | ✅ | ✅ | ✅ | ❌ | ✅ |
| Auto git commit checkpoints | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auto IDE diff (engine-agnostic) | ✅ | ✅ | △ | ❌ | △ |
| Auto preview HTML → Browser | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto quota fallback (cross-model) | ✅ | N/A | N/A | N/A | N/A |
| **Rich @ commands** | ✅ 9 | △ | ✅ | ✅ | △ |
| `/pr` automation (gh + AI title/body) | ✅ | ❌ | ❌ | ❌ | △ |
| **Custom provider** (Ollama/LM Studio/OpenRouter) | ✅ | ❌ | ✅ | △ | ❌ |
| **Plan → Act flow split** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Composer multi-file review** (collapse + revert) | ✅ | ✅ | △ | △ | ❌ |
| **Voice input** (multilingual, Korean default) | ✅ | △ | ❌ | ❌ | ❌ |
| **Browser tool** (Playwright + system Chrome) | ✅ | ❌ | △ | ✅ | ❌ |
| **Locale-aware responses** (auto-detect VSCode lang) | ✅ 9 langs | ❌ | ❌ | ❌ | ❌ |
| **ORCHESTRAI.md** project rules | ✅ | △ | ✅ | ✅ | ❌ |
| Estimated savings display | ✅ | ❌ | ❌ | ❌ | ❌ |
| Built-in performance metrics (`/perf`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Zero API billing** (subscription bypass) | ✅ | ❌ | ❌ | ❌ | △ subscription |

---

## 🎛 Routing modes (6 + 1)

| | Behavior |
|---|---|
| `auto` | Pattern → LLM (Haiku) auto routing |
| `claude` / `codex` / `gemini` | Force specific model |
| `argue` ⚡ | Round-robin debate, Haiku scores 0–10 |
| `team` 👥 | Claude orchestrator → Codex/Gemini consult tool |
| `loop` 🔁 | Repeat until done (Ralph Wiggum pattern, max 5) |
| `boomerang` 🪃 | Auto-split big task → parallel delegation → synthesis |

## 🧰 Permission modes (4)

`ask` / `auto-edit` / `plan` / `smart-auto` — mapped to Claude SDK `permissionMode`.
**Plan mode**: when a turn ends, a purple "▶ Run in Act mode" button appears → clicking it auto-switches to auto-edit and executes the plan (Cline-style flow).

## 💬 @ commands (type `@` in input for autocomplete)

| Command | Action |
|---|---|
| `@claude` / `@codex` / `@gemini` | Force model |
| `@<custom>` | Any OpenAI-compatible provider registered in `customProviders` (Ollama / LM Studio / OpenRouter) |
| `@file` | File picker → multi-select attachments |
| `@codebase` | Explicit RAG call → keyword input → top-K chunks attached |
| `@terminal` | Attach selection from active terminal |
| `@git` | Attach `git status` / `diff` / `log -10` |
| `@web` | URL fetch (static HTML) |
| `@browser` | Playwright + system Chrome (JS-rendered SPAs) |
| `@problem` | Attach VS Code Problems panel diagnostics |

## ⚙ Slash commands

```
/clear            Reset conversation
/plan             Enter plan mode
/auto             Switch to auto-edit
/team             Team mode
/argue            Argue (debate) mode
/loop             Loop mode
/effort high      Force high-effort reasoning
/review           Multi-model code review (3 models + Haiku synthesis)
/index            Index codebase
/pr [title]       gh CLI + AI auto-generates PR title/body
/bg <task>        Start background agent
/agent ...        Agent marketplace (import / list / use / remove)
/perf             Show performance metrics
/perfreset        Reset performance metrics
```

## 🎤 Voice input
🎤 button in input → multilingual (Korean default). Red pulse while recording. Click again to stop. Auto-detects user locale from VSCode language.

## 🔌 Custom Provider (LM Studio / Ollama / OpenRouter / vLLM / OpenAI compatible)

Add to VSCode Settings → invoke via `@<name>` mention:

```json
"orchestrai.customProviders": [
  { "name": "ollama", "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5-coder:32b" },
  { "name": "lm",     "baseUrl": "http://localhost:1234/v1",  "model": "llama-3.3-70b" },
  { "name": "or",     "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-or-...",
                       "model": "anthropic/claude-3.5-sonnet" }
]
```

## 📎 Attachments (Claude Code parity)

Drag & drop / paste / file picker — auto-routed by format:

| Format | Claude | Codex | Gemini | Handling |
|---|---|---|---|---|
| Text/code (md/json/ts/py/sh/sql, 40+) | ✅ | ✅ | ✅ | Inline code block |
| Images (png/jpg/gif/webp/svg) | ✅ | ✅ | ✅ | base64 multimodal |
| PDF | ✅ | ❌ | ✅ | base64 multimodal (text fallback for Codex) |
| Excel (xlsx/xls/xlsm/ods) | ✅ | ✅ | ✅ | SheetJS → CSV |
| Word (.docx) | ✅ | ✅ | ✅ | mammoth → markdown |
| Jupyter (.ipynb) | ✅ | ✅ | ✅ | Cell separation |
| PowerPoint (.pptx) | ✅ | ✅ | ✅ | jszip slide+notes text |
| Email (.eml/.msg) | ✅ | ✅ | ✅ | mailparser |
| RTF / ODT | ✅ | ✅ | ✅ | Inline text |
| Audio (mp3/wav/m4a/flac/ogg) | ❌ | ❌ | ✅ | Gemini multimodal |
| Video (mp4/mov/webm) | ❌ | ❌ | ✅ | Gemini multimodal |

When multimodal attachments are present in `auto` mode, the router prefers Gemini. Audio/video are Gemini-only.

## 📋 ORCHESTRAI.md (project rules)

Create `ORCHESTRAI.md` in your workspace root → auto-loaded → prepended to every model's system prompt. Conventions, taboos, stack info, domain knowledge — injected once for all models.

## 🌐 Locale-aware responses

OrchestrAI auto-detects your VSCode language and tells the AI to respond in that language by default. Supported: ko / en / ja / zh / es / de / fr / pt / ru. Code blocks and technical terms stay in English.

## 🚀 Highlights

### Auto indexing + RAG
Asks come with auto-attached relevant chunks from your codebase. Cursor/Continue parity.
```
/index   ← first-time index
afterwards: automatic
```

### Multi-model code review
Three models review independently → Haiku synthesizes a final score.
```
/review            (last commit)
/review staged     (staged changes)
```

### Background agent + Telegram push
Hand off a long task and walk away. Get notified on your phone when done.
```
/bg build a full zombie survival game
```

### Agent marketplace
Share system prompts via GitHub Gist. Anyone can publish, anyone can import.
```
/agent import https://gist.github.com/USER/HASH
/agent list
/agent use vibe-game-builder
/agent off
```

### Telegram bridge (phone integration)
Settings → connect Telegram → DM/Topics mode.
- Topics mode: separate threads per workspace inside one group
- Send a command from your phone → VSCode processes → response streams back to phone
- Auto-splits messages over 4096 chars

### Auto git commit (checkpoints)
Every turn ends with an auto-commit. Mess something up → revert one turn instantly.

### Auto preview
HTML produced → Simple Browser opens automatically  
package.json dev script → ▶ Run button  
Python / Node files → ▶ run

### Built-in performance metrics
`/perf` shows timing breakdown of router/history/IO operations. `/perfreset` clears the counters. Useful for tuning RAG window size, custom providers, or local model latency.

---

## 📦 Installation

### Quick install (recommended)
1. Download `orchestrai.vsix` from [Releases](https://github.com/samkjsong-bot/OrchestrAI/releases)
2. VSCode → Extensions panel → `…` → "Install from VSIX"

Or via terminal:
```bash
code --install-extension orchestrai.vsix
```

### Build from source
```bash
git clone https://github.com/samkjsong-bot/OrchestrAI.git
cd OrchestrAI
npm install
npm run package
code --install-extension orchestrai.vsix
```

## 🔐 Prerequisites

OrchestrAI itself requires zero API keys. Authentication is per model:

| Model | Requirement | Free? |
|---|---|---|
| Claude | Local `claude` CLI login | Requires Max subscription |
| Codex | ChatGPT OAuth (inside OrchestrAI) | Requires ChatGPT Pro |
| Gemini | Local `gemini` CLI login | ✅ Google free tier |
| Image generation (optional) | Gemini API key | △ |

After install: sidebar → ⚙ Settings → connect accounts.

## 💡 Usage tips

- **Quick question** → just type, auto routes
- **Build an app/game** → `🪃 boom` mode (auto-split + parallel)
- **Compare model opinions** → `⚡ argue` mode (debate + score)
- **Until-it-works** → `🔁 loop` mode
- **Long off-screen task** → `/bg <task>` + Telegram on phone
- **PR review** → `/review`

## 🏗 Stack

- TypeScript + esbuild
- `@anthropic-ai/claude-agent-sdk` (Claude tool loop)
- `ai` + `ai-sdk-provider-gemini-cli` (Gemini ESM)
- `codex.exe mcp-server` (Codex CLI native MCP)
- Self-rolled Telegram polling, custom fetch SSE

Architecture details: [CODEMAP.md](./CODEMAP.md)

## 🤝 License

[MIT](./LICENSE)

## 🙏 Inspiration

- Claude Code for VSCode — partial UI/UX reference
- Codex CLI — fingerprint bypass path
- Roo Code — boomerang task pattern
- Cursor — RAG / checkpoint ideas
- Geoffrey Huntley — Ralph Wiggum loop naming

---

<div align="center">
<sub>made for vibe coders · zero billing · open source</sub>
</div>
