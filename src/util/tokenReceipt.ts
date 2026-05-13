// src/util/tokenReceipt.ts
// directive 10.8 / 17절 — 매 요청마다 만들어지는 "토큰 영수증". UI/로그에 노출.

import type { TokenMode, ContextBundle } from '../context/types'

export interface TokenReceipt {
  requestId: string
  timestamp: number
  mode: TokenMode
  models: string[]
  rawCandidateTokens: number
  finalSentTokens: number
  estimatedSavedTokens: number
  compressionRatio: number
  sections: Record<string, number>
  filesSent: Array<{
    path: string
    lines?: [number, number]
    tokens: number
    reason: string
  }>
  perModel?: Array<{
    model: string
    tokens: number
    includedSections: string[]
  }>
  excluded?: Array<{ path: string; reason: string }>
}

export function createTokenReceipt(args: {
  bundle: ContextBundle
  models: string[]
  finalSentTokens: number
  perModel?: TokenReceipt['perModel']
}): TokenReceipt {
  const { bundle, models, finalSentTokens, perModel } = args
  const raw = bundle.tokenEstimate.rawCandidateTokens
  const saved = Math.max(0, raw - finalSentTokens)
  const ratio = raw > 0 ? finalSentTokens / raw : 1

  const filesSent: TokenReceipt['filesSent'] = []
  if (bundle.activeFile) {
    const af = bundle.activeFile
    const tokens = (af.selectedText ? estimateTokens(af.selectedText) : 0)
      + (af.focusedSnippet ? estimateTokens(af.focusedSnippet.code) : 0)
      + (af.fileSummary ? estimateTokens(af.fileSummary) : 0)
    if (tokens > 0) {
      filesSent.push({
        path: af.path, tokens, reason: af.selectedText ? 'selection' : af.focusedSnippet ? 'focused snippet' : 'summary',
      })
    }
  }
  for (const s of bundle.relatedSnippets) {
    filesSent.push({
      path: s.path, lines: s.startLine != null && s.endLine != null ? [s.startLine, s.endLine] : undefined,
      tokens: s.tokenEstimate ?? estimateTokens(s.code), reason: s.reason,
    })
  }
  for (const f of bundle.relatedFileSummaries) {
    filesSent.push({ path: f.path, tokens: f.tokenEstimate ?? estimateTokens(f.summary), reason: f.reason })
  }

  return {
    requestId: bundle.requestId,
    timestamp: Date.now(),
    mode: bundle.mode,
    models,
    rawCandidateTokens: raw,
    finalSentTokens,
    estimatedSavedTokens: saved,
    compressionRatio: ratio,
    sections: bundle.tokenEstimate.bySection,
    filesSent,
    perModel,
    excluded: bundle.safety.blockedFiles.map(p => ({ path: p, reason: 'potential secret' })),
  }
}

/** 한국 토큰 추정 — 한글 1자≈1tok, 그 외 4자≈1tok. util/history 와 동일 휴리스틱. */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0
  const korean = (text.match(/[가-힣]/g) ?? []).length
  const other = text.length - korean
  return Math.ceil(korean + other / 4)
}

/** UI status line 한 줄 — "OrchestrAI Balanced: 84% saved (18,400 → 3,200 tok)" */
export function formatReceiptShort(r: TokenReceipt): string {
  const pct = r.rawCandidateTokens > 0
    ? Math.round((1 - r.finalSentTokens / r.rawCandidateTokens) * 100)
    : 0
  const modeLabel = r.mode.charAt(0).toUpperCase() + r.mode.slice(1)
  if (r.rawCandidateTokens <= r.finalSentTokens) {
    return `OrchestrAI ${modeLabel}: ${r.finalSentTokens.toLocaleString()} tok`
  }
  return `OrchestrAI ${modeLabel}: ${pct}% saved (${r.rawCandidateTokens.toLocaleString()} → ${r.finalSentTokens.toLocaleString()} tok)`
}

/** 상세 영수증 — Output 채널 / 로그용. 사용자가 펼쳐 보고 싶을 때. */
export function formatReceiptDetail(r: TokenReceipt): string {
  const lines: string[] = []
  lines.push(`Request: ${r.requestId}`)
  lines.push(`Mode: ${r.mode}`)
  lines.push(`Models: ${r.models.join(', ') || '(none)'}`)
  lines.push('')
  lines.push(`Raw candidate: ${r.rawCandidateTokens.toLocaleString()} tok`)
  lines.push(`Final sent:    ${r.finalSentTokens.toLocaleString()} tok`)
  lines.push(`Saved:         ${r.estimatedSavedTokens.toLocaleString()} tok (${r.rawCandidateTokens > 0 ? Math.round((1 - r.finalSentTokens / r.rawCandidateTokens) * 100) : 0}%)`)
  lines.push('')
  if (Object.keys(r.sections).length > 0) {
    lines.push('Sections:')
    for (const [k, v] of Object.entries(r.sections)) {
      lines.push(`  ${k}: ${v.toLocaleString()} tok`)
    }
    lines.push('')
  }
  if (r.filesSent.length > 0) {
    lines.push('Files sent:')
    for (const f of r.filesSent) {
      const range = f.lines ? `:${f.lines[0]}-${f.lines[1]}` : ''
      lines.push(`  ${f.path}${range} — ${f.tokens.toLocaleString()} tok (${f.reason})`)
    }
    lines.push('')
  }
  if (r.excluded && r.excluded.length > 0) {
    lines.push('Excluded:')
    for (const e of r.excluded) {
      lines.push(`  ${e.path} — ${e.reason}`)
    }
  }
  return lines.join('\n')
}
