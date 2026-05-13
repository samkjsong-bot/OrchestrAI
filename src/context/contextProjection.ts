// src/context/contextProjection.ts
// directive 12절 — 각 모델 강점에 맞게 ContextBundle 잘라서 텍스트로.
//
// Claude/Codex (expensive expert): selectedText + 활성 심볼 + 좁은 snippets. 풀 파일 X.
// Gemini (long context): 더 넓게 — projectSummary + fileSummary + diff. Phase 1 은 균등.
// Synthesizer: compressed claims (Phase 1 미사용 — boomerang synth 가 별도).

import type { ContextBundle, ModelContextProjection, ModelProvider } from './types'
import { estimateTokens } from '../util/tokenReceipt'

export interface ProjectOptions {
  bundle: ContextBundle
  modelProvider: ModelProvider
}

/** Bundle → 한 모델용 prompt 텍스트. 기존 buildContextBlock 자리에 박힘. */
export function projectForModel(opts: ProjectOptions): ModelContextProjection {
  const { bundle, modelProvider } = opts
  const sections: Array<{ name: string; text: string; tokens: number }> = []
  const included: string[] = []
  const excluded: string[] = []

  // ── activeFile ──
  if (bundle.activeFile) {
    const af = bundle.activeFile
    const parts: string[] = []
    parts.push(`<file path="${escapePath(af.path)}"${af.language ? ` lang="${af.language}"` : ''}>`)
    if (af.activeSymbolName) parts.push(`<symbol name="${af.activeSymbolName}"/>`)
    if (af.selectedText) {
      parts.push('<selection>')
      parts.push(af.selectedText)
      parts.push('</selection>')
    }
    if (af.focusedSnippet) {
      const fs = af.focusedSnippet
      const range = fs.startLine != null && fs.endLine != null ? ` lines="${fs.startLine}-${fs.endLine}"` : ''
      parts.push(`<focused${range} reason="${escapeAttr(fs.reason)}">`)
      parts.push(fs.code)
      parts.push('</focused>')
    }
    // Claude/Codex 는 fileSummary 생략 (focused snippet 으로 충분). Gemini 는 포함.
    const allowSummary = modelProvider === 'gemini' || modelProvider === 'synthesizer'
    if (allowSummary && af.fileSummary) {
      parts.push('<summary reason="file head — top imports/exports/types">')
      parts.push(af.fileSummary)
      parts.push('</summary>')
    } else if (af.fileSummary) {
      excluded.push('activeFile.summary (expensive model — omitted)')
    }
    parts.push('</file>')
    const text = parts.join('\n')
    sections.push({ name: 'activeFile', text, tokens: estimateTokens(text) })
    included.push('activeFile')
  }

  // ── git diff ──
  if (bundle.gitDiff) {
    const text = `<git_diff>\n${bundle.gitDiff}\n</git_diff>`
    sections.push({ name: 'gitDiff', text, tokens: estimateTokens(text) })
    included.push('gitDiff')
  }

  // ── related snippets / summaries (Phase 1 미수집 — Phase 2 Gemma 로) ──
  if (bundle.relatedSnippets.length > 0) {
    const text = bundle.relatedSnippets.map(s => {
      const range = s.startLine != null && s.endLine != null ? ` lines="${s.startLine}-${s.endLine}"` : ''
      return `<related path="${escapePath(s.path)}"${range} reason="${escapeAttr(s.reason)}">\n${s.code}\n</related>`
    }).join('\n')
    sections.push({ name: 'relatedSnippets', text, tokens: estimateTokens(text) })
    included.push('relatedSnippets')
  }

  // ── projectSummary (Gemini / synthesizer 만, Phase 1 미수집) ──
  if (bundle.projectSummary && (modelProvider === 'gemini' || modelProvider === 'synthesizer')) {
    const text = `<project_summary>\n${bundle.projectSummary}\n</project_summary>`
    sections.push({ name: 'projectSummary', text, tokens: estimateTokens(text) })
    included.push('projectSummary')
  } else if (bundle.projectSummary) {
    excluded.push('projectSummary (expensive model — omitted)')
  }

  // ── safety warnings (사용자 의도 보존 — secret 차단 안내) ──
  if (bundle.safety.warnings.length > 0) {
    const text = `<context_safety>\n${bundle.safety.warnings.join('\n')}\n</context_safety>`
    sections.push({ name: 'safety', text, tokens: estimateTokens(text) })
    included.push('safety')
  }

  const prompt = sections.length > 0
    ? sections.map(s => s.text).join('\n\n')
    : ''
  const totalTokens = sections.reduce((s, x) => s + x.tokens, 0)
  const reason = describeProjection(bundle, modelProvider, included)

  return {
    modelProvider, prompt, includedSections: included, excludedSections: excluded,
    tokenEstimate: totalTokens, reason,
  }
}

function describeProjection(bundle: ContextBundle, model: ModelProvider, included: string[]): string {
  if (included.length === 0) return `${model}: empty projection (no editor context)`
  return `${model}: ${bundle.mode} mode, level=${bundle.contextLevel}, intent=${bundle.intent} → ${included.join('+')}`
}

function escapePath(p: string): string {
  return p.replace(/"/g, '&quot;').replace(/&/g, '&amp;')
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** 빠른 mapping: 우리 Model 문자열 ('claude'|'codex'|'gemini'|'custom:...') → ModelProvider. */
export function providerFromModel(model: string): ModelProvider {
  if (model === 'claude') return 'claude'
  if (model === 'codex') return 'codex'
  if (model === 'gemini') return 'gemini'
  if (model.startsWith('custom:')) return 'custom'
  return 'local'
}
