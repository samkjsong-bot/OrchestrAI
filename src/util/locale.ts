// src/util/locale.ts
// VSCode locale 감지 + system prompt 조건부 다국어 (한국어 default).

import * as vscode from 'vscode'

export type SupportedLocale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'de' | 'fr' | 'pt' | 'ru'

// VSCode language → 우리가 지원하는 locale 매핑
export function getUserLocale(): SupportedLocale {
  const lang = vscode.env.language?.toLowerCase() ?? 'en'
  if (lang.startsWith('ko')) return 'ko'
  if (lang.startsWith('en')) return 'en'
  if (lang.startsWith('ja')) return 'ja'
  if (lang.startsWith('zh')) return 'zh'  // zh-cn / zh-tw 둘 다
  if (lang.startsWith('es')) return 'es'
  if (lang.startsWith('de')) return 'de'
  if (lang.startsWith('fr')) return 'fr'
  if (lang.startsWith('pt')) return 'pt'
  if (lang.startsWith('ru')) return 'ru'
  return 'en'  // unknown → 영어
}

const LANG_NAMES: Record<SupportedLocale, string> = {
  ko: 'Korean (한국어)',
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Chinese (中文)',
  es: 'Spanish (Español)',
  de: 'German (Deutsch)',
  fr: 'French (Français)',
  pt: 'Portuguese (Português)',
  ru: 'Russian (Русский)',
}

// system prompt 에 inject — 모델한테 사용자 locale 을 명확히 알려서 응답 언어 조절
export function localeBlock(locale: SupportedLocale = getUserLocale()): string {
  return `\n\nUSER LOCALE: ${LANG_NAMES[locale]} (${locale})
- Respond in the user's language by default. Code blocks and technical terms can stay English.
- Only switch to English if the user explicitly writes in English in this turn.`
}
