// src/context/contextBundle.ts
// directive 10.4 — 후보 컨텍스트를 ContextBundle 로 모으는 builder.
//
// 흐름:
//   userQuestion + 현재 editor state (선택 / 활성 심볼 / 활성 파일)
//   → intent 분류 → budget 결정 → 각 섹션 후보 수집 → secret scan → token estimate

import * as vscode from 'vscode'
import * as path from 'path'
import { spawnSync } from 'child_process'
import {
  type ContextBundle, type CodeSnippet, type TokenMode, ContextLevel,
  type IntentCategory,
} from './types'
import { classifyIntent } from './intentClassifier'
import { resolveBudget, type ResolvedBudget } from './contextBudget'
import { scanCandidates, isSecretPath } from './secretScanner'
import { estimateTokens } from '../util/tokenReceipt'

export interface BuildBundleOptions {
  userQuestion: string
  mode: TokenMode
  /** activeFile 자동 수집 비활성 시 false (사용자가 ctx-btn 끔). */
  includeActiveFile?: boolean
  /** workspace root — git diff 수집에 필요. 없으면 diff skip. */
  workspaceRoot?: string
  /** override — argue round 2+ 같이 좁혀야 할 때. */
  forceLevel?: ContextLevel
  /** 요청 식별자 — receipt 에 연결됨. */
  requestId?: string
}

/** 한 줄짜리 진입점 — userQuestion + 모드만 받으면 bundle 반환. */
export function buildContextBundle(opts: BuildBundleOptions): ContextBundle {
  const { userQuestion, mode, includeActiveFile = true, workspaceRoot, forceLevel, requestId } = opts
  const intent: IntentCategory = classifyIntent(userQuestion)

  const editor = vscode.window.activeTextEditor
  const hasSelection = !!(editor && !editor.selection.isEmpty)

  const budget = resolveBudget({ mode, intent, hasSelection, forceLevel })

  const bundle: ContextBundle = {
    requestId: requestId ?? `ctx-${Date.now()}`,
    mode, intent, contextLevel: budget.contextLevel, userQuestion,
    relatedSnippets: [],
    relatedFileSummaries: [],
    safety: { containsPotentialSecrets: false, blockedFiles: [], warnings: [], requiresUserApproval: false },
    tokenEstimate: { rawCandidateTokens: 0, finalInputTokens: 0, estimatedSavedTokens: 0, compressionRatio: 1, bySection: {} },
  }

  // activeFile 섹션 — selection / focused snippet / file summary (level 따라).
  if (includeActiveFile && editor) {
    const af = collectActiveFile(editor, budget)
    if (af) {
      bundle.activeFile = af
      if (af.path && isSecretPath(af.path)) {
        bundle.safety.blockedFiles.push(af.path)
        bundle.safety.warnings.push(`Excluded ${path.basename(af.path)} — potential secret`)
        bundle.safety.requiresUserApproval = true
        delete bundle.activeFile  // 차단
      }
    }
  }

  // git diff — level ≥ ProjectSummaryPlusDiff 또는 review/architecture intent.
  const wantsDiff = budget.contextLevel >= ContextLevel.ProjectSummaryPlusDiff
    || intent === 'review_diff' || intent === 'architecture' || intent === 'refactor'
  if (wantsDiff && workspaceRoot && budget.sections.gitDiff > 0) {
    const diff = collectGitDiff(workspaceRoot, budget.sections.gitDiff)
    if (diff) bundle.gitDiff = diff
  }

  // Phase 1 은 relatedSnippets / projectSummary 미구현 (Phase 2/3 Gemma/Gemini cache).
  // 그 자리는 Phase 1 에서 비워두지만 receipt 에선 0 tok 으로 잡힘.

  // secret scan 최종 — inline 텍스트 한 번 더.
  const inline = [
    bundle.activeFile?.selectedText, bundle.activeFile?.focusedSnippet?.code,
    bundle.activeFile?.fileSummary, bundle.gitDiff,
  ].filter(Boolean).join('\n')
  const scan = scanCandidates({ filePaths: bundle.activeFile?.path ? [bundle.activeFile.path] : [], inlineText: inline })
  bundle.safety.warnings.push(...scan.warnings)
  bundle.safety.containsPotentialSecrets = scan.hasSecretContent || scan.blockedFiles.length > 0
  bundle.safety.blockedFiles.push(...scan.blockedFiles.filter(p => !bundle.safety.blockedFiles.includes(p)))
  bundle.safety.requiresUserApproval = bundle.safety.requiresUserApproval || bundle.safety.containsPotentialSecrets

  // token estimate
  const sections: Record<string, number> = {}
  let finalSent = 0
  if (bundle.activeFile) {
    let af = 0
    if (bundle.activeFile.selectedText) af += estimateTokens(bundle.activeFile.selectedText)
    if (bundle.activeFile.focusedSnippet) af += estimateTokens(bundle.activeFile.focusedSnippet.code)
    if (bundle.activeFile.fileSummary) af += estimateTokens(bundle.activeFile.fileSummary)
    if (af > 0) { sections.activeFile = af; finalSent += af }
  }
  if (bundle.gitDiff) { sections.gitDiff = estimateTokens(bundle.gitDiff); finalSent += sections.gitDiff }

  // rawCandidateTokens = legacy 모드 (Phase 1 적용 전) 에서 system prompt 의 context block 에 박혔을 양.
  // 그건 _useFileContext=true 일 때 buildContextBlock(ctx) 결과 = 활성 파일 전체 내용.
  // userQuestion 은 baseline 에 포함 X — message 로 가지 system prompt context 가 아니므로 "절약" 대상 아님.
  // includeActiveFile=false (사용자가 ctx-btn 끔) 면 baseline 도 0.
  let rawBaseline = 0
  if (editor && includeActiveFile) {
    const fullDoc = editor.document.getText()
    rawBaseline = estimateTokens(fullDoc)
    sections._rawActiveFileFull = rawBaseline
  }
  bundle.tokenEstimate = {
    rawCandidateTokens: Math.max(rawBaseline, finalSent),
    finalInputTokens: finalSent,
    estimatedSavedTokens: Math.max(0, rawBaseline - finalSent),
    compressionRatio: rawBaseline > 0 ? finalSent / rawBaseline : 1,
    bySection: sections,
  }
  return bundle
}

// ── activeFile 수집 ───────────────────────────────────────────────────
function collectActiveFile(editor: vscode.TextEditor, budget: ResolvedBudget): NonNullable<ContextBundle['activeFile']> | null {
  const doc = editor.document
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return null
  const filePath = doc.uri.fsPath || doc.fileName
  const fullText = doc.getText()
  const selection = editor.selection
  const selectedText = selection.isEmpty ? undefined : doc.getText(selection)
  const language = doc.languageId
  const cursorLine = editor.selection.active.line // 0-based

  const af: NonNullable<ContextBundle['activeFile']> = {
    path: filePath, language, selectedText,
  }

  // ContextLevel.SelectionOnly: selection 만 (있으면). 없으면 nothing.
  if (budget.contextLevel === ContextLevel.SelectionOnly) {
    if (!selectedText) return null
    return af
  }

  // 활성 심볼 추출 — VSCode symbol API 는 async 라서 Phase 1 은 정규식 fallback.
  // (cursor 위치 기준으로 위로 거슬러 올라가 function/class 헤더 찾기.)
  const symbolBlock = extractEnclosingBlock(fullText, cursorLine, budget.sections.activeFile)
  if (symbolBlock) {
    af.activeSymbolName = symbolBlock.name
    af.focusedSnippet = {
      path: filePath, language,
      startLine: symbolBlock.startLine + 1, endLine: symbolBlock.endLine + 1,
      code: symbolBlock.code,
      reason: `enclosing ${symbolBlock.kind} at cursor`,
      tokenEstimate: estimateTokens(symbolBlock.code),
    }
  }

  // ContextLevel.ActiveSymbol: focused snippet 만.
  if (budget.contextLevel === ContextLevel.ActiveSymbol) {
    return af
  }

  // ContextLevel ≥ ActiveFileFocused — fileSummary 추가 (지금은 단순 첫 30줄 head + 토큰 cap).
  // Phase 2 에서 Gemma 가 진짜 요약 생성. 그 전까진 head 가 더 가치 있음 (import / top-level 정의).
  const headLineCount = 30
  const headLines = fullText.split('\n').slice(0, headLineCount).join('\n')
  const summaryBudget = Math.max(0, budget.sections.activeFile - estimateTokens(af.focusedSnippet?.code ?? '') - estimateTokens(selectedText ?? ''))
  if (summaryBudget > 200) {
    af.fileSummary = capTokens(headLines, summaryBudget)
  }
  return af
}

// 토큰 cap — 추정 토큰 한도까지 잘라서 반환 (보수적으로 4자/tok 가정).
function capTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n... [truncated to budget]'
}

// 정규식 fallback — cursor line 기준으로 위로 거슬러 함수/클래스 시작 찾고, 매칭되는 닫는 brace 까지.
// 정확하진 않지만 "이 함수 안 cursor 위치" 라는 의도는 잡힘.
interface BlockInfo { name: string; kind: string; startLine: number; endLine: number; code: string }
function extractEnclosingBlock(fullText: string, cursorLine: number, maxTokens: number): BlockInfo | null {
  const lines = fullText.split('\n')
  if (lines.length === 0) return null
  // 위로 거슬러 올라가며 함수/클래스 헤더 매칭
  const headerRe = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|def|public|private|protected|interface|type)\s+(\w+)/
  let startLine = -1
  let kind = ''
  let name = ''
  for (let i = Math.min(cursorLine, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(headerRe)
    if (m) {
      startLine = i
      name = m[1]
      kind = (lines[i].match(/function|class|const|let|var|def|interface|type/) ?? ['symbol'])[0]
      break
    }
  }
  if (startLine < 0) return null

  // 닫는 brace 찾기 — naive brace counter, "{" 가 있는 첫 줄 부터 시작.
  let depth = 0
  let endLine = startLine
  let inString = false
  let stringChar = ''
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      const c = line[j]
      if (inString) {
        if (c === stringChar && line[j-1] !== '\\') inString = false
        continue
      }
      if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth <= 0) { endLine = i; break }
      }
    }
    if (depth <= 0 && i > startLine) { endLine = i; break }
    // Python — indent 기반, brace 없는 def 면 다음 같은 indent 까지
    if (kind === 'def' && i > startLine && lines[i].trim() !== '' && !lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
      endLine = i - 1; break
    }
    if (i === lines.length - 1) endLine = i
  }
  let code = lines.slice(startLine, endLine + 1).join('\n')
  code = capTokens(code, maxTokens)
  return { name, kind, startLine, endLine, code }
}

// ── git diff ──────────────────────────────────────────────────────────
function collectGitDiff(workspaceRoot: string, maxTokens: number): string | null {
  try {
    const r = spawnSync('git', ['diff', '--no-color', 'HEAD', '--stat', '--patch'], {
      cwd: workspaceRoot, encoding: 'utf8', timeout: 2000, windowsHide: true,
    })
    if (r.status !== 0 || !r.stdout) return null
    return capTokens(r.stdout, maxTokens)
  } catch { return null }
}
