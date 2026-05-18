// src/i18n/index.ts
// extension 측 i18n 진입점. webview 측은 _getHtml() 시점에 active locale dict 를 window.I18N 으로 inject.

import * as vscode from 'vscode'
import { STRINGS, type Locale, type StringsDict } from './strings'

let _cachedLocale: Locale | null = null

/** 현재 active locale 결정 — setting override 우선, 없으면 VSCode language 자동. */
export function getLocale(): Locale {
  if (_cachedLocale) return _cachedLocale
  const cfg = vscode.workspace.getConfiguration('orchestrai')
  const override = cfg.get<string>('language')  // 'auto' | 'ko' | 'en'
  if (override === 'ko' || override === 'en') {
    _cachedLocale = override
    return override
  }
  // auto — VSCode 의 UI 언어 사용
  const lang = (vscode.env.language || '').toLowerCase()
  const detected: Locale = lang.startsWith('ko') ? 'ko' : 'en'
  _cachedLocale = detected
  return detected
}

/** setting 변경 / language 변경 시 cache invalidate. caller 가 webview reload trigger. */
export function invalidateLocaleCache(): void {
  _cachedLocale = null
}

/** key 로 현재 locale 의 string 조회. 미정의 키면 ko fallback 후 key 자체. */
export function t<K extends keyof StringsDict>(key: K, replacements?: Record<string, string | number>): string {
  const loc = getLocale()
  let s = STRINGS[loc][key] ?? STRINGS.ko[key] ?? String(key)
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}

/** 현재 locale 의 dict 전체 — webview inject 용. */
export function getActiveDict(): StringsDict {
  return STRINGS[getLocale()]
}

export type { Locale, StringsDict }
