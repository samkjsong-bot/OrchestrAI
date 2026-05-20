// src/util/updateChecker.ts
// v0.1.40+: marketplace 새 버전 자동 감지.
//   GitHub releases latest API 호출 → tag_name 의 v0.X.Y 와 package.json version 비교.
//   더 높으면 webview 에 update 배지 표시. 클릭 시 marketplace 페이지 열림.
//
// 폴링: activate 1회 + 24h interval. 결과는 globalState 캐시 (오프라인 시 직전 값 사용).
//
// 보안: 출/입 통신은 https://api.github.com 만. response body 는 단순 string 비교에만 사용.

import * as vscode from 'vscode'
import { log } from './log'

const RELEASES_URL = 'https://api.github.com/repos/samkjsong-bot/OrchestrAI/releases/latest'
const CACHE_KEY = 'orchestrai.update.v1'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24h

export interface UpdateInfo {
  /** 마지막 체크 시각 (ms epoch). */
  checkedAt: number
  /** marketplace 최신 버전 (예: "0.1.40"). 못 가져오면 null. */
  latestVersion: string | null
  /** release 페이지 URL — 클릭 시 marketplace 페이지로. */
  releaseUrl: string | null
}

/** "0.1.39" vs "0.1.40" → true (newer 가 더 높음). 동일 길이 X 가능 → semver.parse 안 쓰고 zero-pad. */
function isNewer(currentRaw: string, latestRaw: string): boolean {
  const norm = (v: string) => v.replace(/^v/, '').split('.').slice(0, 3).map(p => parseInt(p, 10) || 0)
  const c = norm(currentRaw)
  const l = norm(latestRaw)
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false
  }
  return false
}

export async function fetchLatestRelease(): Promise<{ version: string; htmlUrl: string } | null> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'OrchestrAI-VSCode-Extension',
      },
    })
    if (!res.ok) {
      log.info('update', `releases API ${res.status}`)
      return null
    }
    const data = await res.json() as { tag_name?: string; html_url?: string }
    const tag = data.tag_name?.replace(/^v/, '')
    if (!tag) return null
    return { version: tag, htmlUrl: data.html_url ?? '' }
  } catch (err) {
    log.warn('update', `fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** 현재 설치된 익스텐션 버전 — package.json 의 version. */
export function getInstalledVersion(context: vscode.ExtensionContext): string {
  // ExtensionContext.extension.packageJSON 이 가장 정확
  const pkg = context.extension?.packageJSON as { version?: string } | undefined
  return pkg?.version ?? '0.0.0'
}

/**
 * 업데이트 체크. force=true 면 캐시 무시하고 무조건 fetch.
 * 결과는 globalState 에 저장 + 반환. webview push 는 호출 측이 처리.
 */
export async function checkForUpdate(
  context: vscode.ExtensionContext,
  force = false,
): Promise<{ hasUpdate: boolean; current: string; latest: string | null; releaseUrl: string | null }> {
  const current = getInstalledVersion(context)
  const cached = context.globalState.get<UpdateInfo>(CACHE_KEY)
  const now = Date.now()
  const stale = !cached || (now - cached.checkedAt) > CHECK_INTERVAL_MS

  if (!force && !stale && cached) {
    return {
      hasUpdate: cached.latestVersion ? isNewer(current, cached.latestVersion) : false,
      current,
      latest: cached.latestVersion,
      releaseUrl: cached.releaseUrl,
    }
  }

  const fetched = await fetchLatestRelease()
  const next: UpdateInfo = {
    checkedAt: now,
    latestVersion: fetched?.version ?? cached?.latestVersion ?? null,  // 실패 시 직전 값 유지
    releaseUrl: fetched?.htmlUrl ?? cached?.releaseUrl ?? null,
  }
  await context.globalState.update(CACHE_KEY, next)
  return {
    hasUpdate: next.latestVersion ? isNewer(current, next.latestVersion) : false,
    current,
    latest: next.latestVersion,
    releaseUrl: next.releaseUrl,
  }
}

/** 24h 주기 polling 시작. 즉시 1회 + interval. dispose 시 timer clear. */
export function startUpdateChecker(
  context: vscode.ExtensionContext,
  onResult: (info: { hasUpdate: boolean; current: string; latest: string | null; releaseUrl: string | null }) => void,
): vscode.Disposable {
  let timer: ReturnType<typeof setInterval> | undefined
  const run = async () => {
    try {
      const info = await checkForUpdate(context, false)
      onResult(info)
    } catch (err) {
      log.warn('update', `check loop error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // activate 직후 1회 (약간 지연 — extension 초기화 안정 후)
  setTimeout(() => void run(), 5000)
  // 24h 주기
  timer = setInterval(() => void run(), CHECK_INTERVAL_MS)
  return new vscode.Disposable(() => {
    if (timer) clearInterval(timer)
  })
}

// test 용 export
export const _internal = { isNewer }
