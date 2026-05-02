// src/providers/inlineCompletion.ts
// Cursor/Copilot 스타일 ghost text 인라인 자동완성.
// Gemini 2.5 Flash 사용 (빠른 latency, 무료 티어). debounce + cache.

import * as vscode from 'vscode'
import { log } from '../util/log'

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL = 'gemini-2.5-flash'
const DEBOUNCE_MS = 350
const MAX_CONTEXT_LINES = 60
const MAX_CACHE = 50

// 간단 cache: 같은 prefix면 재사용
const cache = new Map<string, string>()

function cacheKey(prefix: string): string {
  // 마지막 200자 + 첫 200자만 사용
  return prefix.slice(0, 200) + '|||' + prefix.slice(-200)
}

async function fetchCompletion(apiKey: string, prefix: string, suffix: string, language: string, abortSignal: AbortSignal): Promise<string> {
  const cached = cache.get(cacheKey(prefix))
  if (cached !== undefined) return cached

  const prompt = `Complete the following ${language} code. Output ONLY the missing code (no markdown, no explanation, no fences). The completion should fit naturally between the prefix and suffix.

PREFIX:
\`\`\`
${prefix}
\`\`\`

SUFFIX:
\`\`\`
${suffix}
\`\`\`

Continue from the cursor position. 1-5 lines max.`

  const url = `${ENDPOINT_BASE}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 200,
          stopSequences: ['```', '\n\n\n'],
        },
      }),
      signal: abortSignal,
    })
    if (!res.ok) return ''
    const data = await res.json() as any
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    // 마크다운/fence 제거
    text = text.replace(/^```[\w]*\n?/, '').replace(/```\s*$/, '').trimEnd()
    if (cache.size >= MAX_CACHE) {
      const first = cache.keys().next().value
      if (first) cache.delete(first)
    }
    cache.set(cacheKey(prefix), text)
    return text
  } catch (err) {
    if ((err as any)?.name === 'AbortError') return ''
    log.warn('inline', 'completion failed:', err)
    return ''
  }
}

export class OrchestrAICompletionProvider implements vscode.InlineCompletionItemProvider {
  private debouncer?: NodeJS.Timeout
  private currentAbort?: AbortController

  constructor(private getApiKey: () => Promise<string | null>, private isEnabled: () => boolean) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _ctx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.isEnabled()) return
    const apiKey = await this.getApiKey()
    if (!apiKey) return

    // 컨텍스트 추출 — 위 60줄, 아래 30줄
    const startLine = Math.max(0, position.line - MAX_CONTEXT_LINES)
    const endLine = Math.min(document.lineCount - 1, position.line + 30)
    const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character))
    const suffix = document.getText(new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length))

    // 빈 prefix면 skip
    if (prefix.trim().length < 5) return

    // debounce — 이전 호출 abort
    if (this.debouncer) clearTimeout(this.debouncer)
    if (this.currentAbort) try { this.currentAbort.abort() } catch {}

    return new Promise<vscode.InlineCompletionItem[] | undefined>(resolve => {
      this.debouncer = setTimeout(async () => {
        if (token.isCancellationRequested) return resolve(undefined)
        const ctrl = new AbortController()
        this.currentAbort = ctrl
        token.onCancellationRequested(() => ctrl.abort())
        try {
          const completion = await fetchCompletion(apiKey, prefix, suffix, document.languageId, ctrl.signal)
          if (!completion || token.isCancellationRequested) return resolve(undefined)
          resolve([new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))])
        } catch {
          resolve(undefined)
        }
      }, DEBOUNCE_MS)
    })
  }
}
