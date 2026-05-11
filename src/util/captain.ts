// src/util/captain.ts
// "대장 모델" — boomerang plan / argue judge / smart commit / synthesis 같은 메타 작업을
// 어느 모델한테 시킬지 사용자 선택.
//
// Default: 'auto' → 활성 provider 중 Claude > Codex > Gemini 우선.
// 'none' → 메타 작업 비활성 (team/boomerang 모드 disable, smart commit/judge fallback).
//
// 모델별 대장 호출은 가벼운 prompt (~1k token) 한 번 → 빠른 모델이면 충분.

import * as vscode from 'vscode'

export type CaptainChoice = 'auto' | 'claude' | 'codex' | 'gemini' | 'none' | string
// string 은 custom:<name>

export type ProviderName = 'claude' | 'codex' | 'gemini' | string  // custom:<name> 도 가능

export interface AuthStatus {
  claude: boolean
  codex: boolean
  gemini: boolean
}

// 사용자가 활성으로 표시한 provider 목록 (기본 = 3개 다).
// custom providers 는 별도 settings 의 customProviders 에서 자동으로 같이 활성.
export function getActiveProviders(): ProviderName[] {
  const cfg = vscode.workspace.getConfiguration('orchestrai')
  const raw = cfg.get<ProviderName[]>('activeProviders')
  if (!Array.isArray(raw) || raw.length === 0) {
    return ['claude', 'codex', 'gemini']
  }
  return raw
}

export function isProviderActive(name: ProviderName): boolean {
  return getActiveProviders().includes(name)
}

// 대장 모델 결정. auth 상태를 받아 'auto' 일 때 우선순위 따라 골라줌.
// 반환값:
//   - 'claude' / 'codex' / 'gemini' / 'custom:<name>' → 해당 모델로 메타 작업
//   - 'none' → 메타 작업 skip (호출 측이 처리)
export function getCaptain(auth: AuthStatus): CaptainChoice {
  const cfg = vscode.workspace.getConfiguration('orchestrai')
  const choice = (cfg.get<string>('captain') ?? 'auto') as CaptainChoice
  if (choice === 'none') return 'none'
  if (choice !== 'auto') {
    // 명시 선택 — 활성·로그인 상태 검증 후 그대로 반환 (없으면 fallback 으로 'none')
    if (choice.startsWith('custom:')) return choice  // custom 은 별도 검증 X
    if (choice === 'claude' && auth.claude) return 'claude'
    if (choice === 'codex' && auth.codex) return 'codex'
    if (choice === 'gemini' && auth.gemini) return 'gemini'
    return 'none'  // 명시 선택했지만 로그인 X → 메타 skip
  }
  // auto: 활성 + 로그인 된 것 중 Claude > Codex > Gemini 우선
  const active = getActiveProviders()
  if (active.includes('claude') && auth.claude) return 'claude'
  if (active.includes('codex') && auth.codex) return 'codex'
  if (active.includes('gemini') && auth.gemini) return 'gemini'
  return 'none'
}

// team / boomerang 등 captain 필수 모드 사용 가능 여부.
// captain === 'none' 이면 false.
export function captainAvailable(auth: AuthStatus): boolean {
  return getCaptain(auth) !== 'none'
}

// 대장 모델한테 메타 작업 한 번 호출 — system + user prompt, 짧은 응답 받기.
// 모델별 빠른 변종 사용 (Claude=Haiku, Codex=mini, Gemini=Flash).
// captain === 'none' 이면 null. custom provider 는 OpenAI compatible fetch.
// 호출 측이 응답 본문에서 JSON 등 추출.
export async function callCaptain(
  captain: CaptainChoice,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  if (captain === 'none') return null

  try {
    if (captain === 'claude') {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')
      const env: Record<string, string | undefined> = { ...process.env }
      delete env.ANTHROPIC_API_KEY
      const q = query({
        prompt: userPrompt,
        options: {
          model: 'claude-haiku-4-5',
          systemPrompt,
          tools: [],
          maxTurns: 1,
          persistSession: false,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
          env,
        },
      })
      let text = ''
      for await (const m of q) {
        if (m.type === 'assistant') {
          for (const b of m.message.content) {
            if (b.type === 'text') text += b.text
          }
        }
      }
      return text
    }

    if (captain === 'codex') {
      // Codex 를 captain 으로 쓰려면 access token 이 필요한데, callCaptain 은 stateless 헬퍼라
      // SecretStorage 직접 접근 불가. 현재는 미지원 — 호출자가 토큰 주입하는 패턴으로 추후 확장.
      // 사용자가 captain=codex 명시했으면 메타 작업은 skip (Gemini 로 fallback 도 안 함 — 명시 의도 존중).
      return null
    }

    if (captain === 'gemini') {
      const { callGemini } = await import('../providers/geminiProvider')
      const result = await callGemini(
        [{ role: 'user', content: userPrompt }],
        'low',
        () => {},
        systemPrompt,
      )
      return result.content
    }

    if (captain.startsWith('custom:')) {
      // custom OpenAI-compatible captain — provider 검색 후 fetch
      const cfg = vscode.workspace.getConfiguration('orchestrai')
      const customs = cfg.get<any[]>('customProviders') ?? []
      const name = captain.slice(7)
      const cp = customs.find(c => c.name === name)
      if (!cp) return null
      const res = await fetch(`${cp.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cp.apiKey ? { Authorization: `Bearer ${cp.apiKey}` } : {}),
          ...(cp.headers ?? {}),
        },
        body: JSON.stringify({
          model: cp.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          max_tokens: 2000,
        }),
      })
      if (!res.ok) return null
      const data: any = await res.json()
      return data?.choices?.[0]?.message?.content ?? null
    }

    return null
  } catch {
    return null
  }
}
