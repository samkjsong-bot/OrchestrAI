// src/providers/browserTool.ts
// Playwright + 시스템 Chrome/Edge 활용 — JS 실행 후 페이지 텍스트/screenshot 추출
// playwright-core (~5MB) + 사용자 시스템 Chrome 활용 (Chromium 다운로드 X)

import { log } from '../util/log'

let _playwright: any = null

async function loadPlaywright() {
  if (_playwright) return _playwright
  // playwright-core 는 CJS — 일반 require 가능
  _playwright = require('playwright-core')
  return _playwright
}

export interface BrowserFetchResult {
  url: string
  title: string
  text: string         // body innerText
  screenshotBase64?: string  // png base64
  error?: string
}

// 시스템에 설치된 Chrome / Edge 자동 감지
function detectSystemChannel(): 'chrome' | 'msedge' {
  // Playwright 의 channel 옵션 — 'chrome', 'msedge' 둘 다 시스템 설치본 사용
  // 우선순위: Chrome (더 널리 호환). 없으면 Edge.
  // launch 시도 실패하면 자동 fallback 하니 여기선 chrome 으로 default.
  return 'chrome'
}

// URL 페이지 열고 텍스트 + (선택) screenshot 추출
export async function fetchPageWithBrowser(
  url: string,
  options: { takeScreenshot?: boolean; timeoutMs?: number } = {},
): Promise<BrowserFetchResult> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const { chromium } = await loadPlaywright()
  let browser: any = null
  try {
    // 시스템 Chrome 사용 (Chromium 다운로드 안 받기 위함)
    try {
      browser = await chromium.launch({ channel: detectSystemChannel(), headless: true })
    } catch {
      // Chrome 없으면 msedge 시도
      browser = await chromium.launch({ channel: 'msedge', headless: true })
    }
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; OrchestrAI/1.0)',
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })
    const title = await page.title()
    // page.evaluate 안의 함수는 브라우저 컨텍스트에서 실행됨 — 여기 document 는 page 의 것.
    // TS lib 'dom' 추가 안 했으므로 string 으로 함수 전달 (Playwright API 지원).
    const text: string = await page.evaluate(`(() => {
      const b = document.body
      return b ? b.innerText : ''
    })()`)
    let screenshotBase64: string | undefined
    if (options.takeScreenshot) {
      const png = await page.screenshot({ fullPage: false, type: 'png' })
      screenshotBase64 = Buffer.from(png).toString('base64')
    }
    log.info('browser', `fetched ${url} (${text.length} chars)`)
    return { url, title, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('browser', `fetch ${url} failed: ${msg}`)
    return { url, title: '', text: '', error: msg }
  } finally {
    try { await browser?.close() } catch {}
  }
}
