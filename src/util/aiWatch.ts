// src/util/aiWatch.ts
// Aider 풍의 매직 코멘트 watcher.
//   // AI! refactor this to async
//   # AI? what does this do
// 위 패턴을 파일 저장 시 감지 → 자동으로 채팅창에 prompt 주입.
//
// AI!  = 명령 (수정 요청)
// AI?  = 질문 (코드 그대로 두고 답만)

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export interface AiMagicHit {
  filePath: string         // workspace-relative
  absPath: string
  line: number             // 1-based
  kind: 'cmd' | 'q'        // AI! vs AI?
  instruction: string      // 매직 토큰 뒤 텍스트
  contextLines: string[]   // 주변 ±5 줄
}

// 라인 주석 패턴 — 언어 구분 없이 광범위하게 잡음.
// 안에 AI! 또는 AI? 가 있고 그 뒤로 instruction.
// 매칭 토큰 자체는 파일에 그대로 둬도 OK — 사용자가 지운 후 저장하면 자연 해제.
const MAGIC_RE = /(?:\/\/|#|--|<!--|\/\*+|;)\s*AI([!?])\s+(.+?)(?:\s*-->|\s*\*\/)?$/m

// 저장 시점에 한 번씩만 처리 (디바운스 + 같은 위치 중복 트리거 방지)
const _seenHits = new Map<string, number>()  // key=`${path}:${line}:${text}`, value=timestamp
const REPEAT_COOLDOWN_MS = 30_000

export function findAiMagic(absPath: string): AiMagicHit | null {
  let content: string
  try {
    content = fs.readFileSync(absPath, 'utf8')
  } catch {
    return null
  }

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MAGIC_RE)
    if (!m) continue

    const kind: 'cmd' | 'q' = m[1] === '!' ? 'cmd' : 'q'
    const instruction = m[2].trim().replace(/[*\-/]+$/, '').trim()
    if (!instruction) continue

    const cooldownKey = `${absPath}:${i}:${instruction}`
    const last = _seenHits.get(cooldownKey)
    if (last && Date.now() - last < REPEAT_COOLDOWN_MS) continue
    _seenHits.set(cooldownKey, Date.now())

    const start = Math.max(0, i - 5)
    const end = Math.min(lines.length, i + 6)
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
    const filePath = root && absPath.startsWith(root)
      ? path.relative(root, absPath).replace(/\\/g, '/')
      : absPath

    return {
      filePath,
      absPath,
      line: i + 1,
      kind,
      instruction,
      contextLines: lines.slice(start, end),
    }
  }
  return null
}

export interface AiWatchOptions {
  onHit: (hit: AiMagicHit) => void
  isEnabled: () => boolean
}

// 단일 인스턴스 watcher. 종료는 dispose() 로.
export function startAiWatcher(opts: AiWatchOptions): vscode.Disposable {
  // 흔한 코드 확장자만 — 바이너리/패키지 lock/로그 등 제외
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{ts,tsx,js,jsx,mjs,cjs,py,rb,go,rs,java,kt,swift,c,cc,cpp,h,hpp,cs,html,css,scss,vue,svelte,php,lua,sql,sh,ps1,bash,zsh,yaml,yml,toml,md}',
  )

  const onSave = (uri: vscode.Uri) => {
    if (!opts.isEnabled()) return
    const hit = findAiMagic(uri.fsPath)
    if (hit) opts.onHit(hit)
  }

  watcher.onDidChange(onSave)
  watcher.onDidCreate(onSave)

  return watcher
}

// AI 가 응답을 끝낸 후, 매직 코멘트 라인을 파일에서 제거. 실패 silent.
export async function removeAiMagicLine(absPath: string, line: number): Promise<boolean> {
  try {
    const content = fs.readFileSync(absPath, 'utf8')
    const lines = content.split('\n')
    if (line < 1 || line > lines.length) return false
    if (!MAGIC_RE.test(lines[line - 1])) return false  // 다른 코드면 건드리지 않음
    lines.splice(line - 1, 1)
    fs.writeFileSync(absPath, lines.join('\n'), 'utf8')
    return true
  } catch {
    return false
  }
}
