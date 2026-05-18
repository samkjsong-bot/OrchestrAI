// src/util/styleAnalytics.ts
// 모델별 (Claude/Codex/Gemini/custom:*) 응답 스타일 통계 분석.
// `/style` slash command 가 트리거하면 활성 chat 의 assistant 메시지들 스캔 → 모델별 비교 카드.

import type { ChatMessage, Model } from '../router/types'

export interface ModelStats {
  model: string
  count: number                      // 응답 개수
  totalChars: number
  avgChars: number
  totalLines: number
  avgLines: number
  codeBlockRatio: number             // 코드 블록 (```) 포함한 메시지 비율 0..1
  codeFenceTotal: number             // 전체 코드 블록 개수
  emojiTotal: number                 // 이모지 총 개수
  emojiPer1k: number                 // 1k char 당 이모지
  headerTotal: number                // # / ## / ### 줄 개수
  headerPer1k: number
  listTotal: number                  // -, *, 1. 줄 개수
  listPer1k: number
  engCharRatio: number               // 영문 char / total char (대략적 영어 비율)
  korCharRatio: number               // 한글 char / total char
  politenessScore: number            // 한·영 정중함 신호 빈도 (0..1 normalized)
  topStartPatterns: Array<{ phrase: string; count: number }>  // top 3 응답 시작 phrase (앞 8자)
}

export interface StyleAnalysis {
  scope: 'active_chat' | 'all_chats'
  totalMessages: number
  totalAssistantMessages: number
  startedAt: number
  endedAt: number                    // 마지막 메시지 timestamp
  byModel: Record<string, ModelStats>
}

// 이모지 패턴 — emoji presentation. \p{Extended_Pictographic} 가 가장 정확하지만 빠른 휴리스틱으로 충분.
const EMOJI_RE = /\p{Extended_Pictographic}/gu
const CODE_FENCE_RE = /```/g
const HEADER_RE = /^#{1,6}\s+/gm
const LIST_RE = /^\s*(?:[-*+]\s+|\d+\.\s+)/gm
const ENG_CHAR_RE = /[a-zA-Z]/g
const KOR_CHAR_RE = /[가-힣]/g

// 정중함 신호 — 한·영 모두 포함.
// 한국어: "...요" / "...습니다" 어미, "감사" / "죄송" / "부탁드"
// 영어: "please" / "sorry" / "thanks" / "kindly" / "would you"
const POLITENESS_PATTERNS = [
  /[가-힣]요(?:[.!?,~]|\s|$)/g,
  /[가-힣]습니다(?:[.!?,~]|\s|$)/g,
  /감사/g,
  /죄송/g,
  /부탁/g,
  /\bplease\b/gi,
  /\bsorry\b/gi,
  /\bthanks?\b/gi,
  /\bkindly\b/gi,
  /\bwould you\b/gi,
]

function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
}

function countMatches(text: string, re: RegExp): number {
  const matches = text.match(re)
  return matches ? matches.length : 0
}

function startPhrase(text: string): string {
  // 응답 시작 phrase — 앞 8자, 공백 정규화.
  const t = text.trim().slice(0, 24).replace(/\s+/g, ' ')
  // 한국어 8자 + 영어 16자 정도면 의미 있는 패턴.
  // 마침표 / 줄바꿈 전까지만.
  const cut = t.search(/[.!?:\n]/)
  return cut > 0 ? t.slice(0, cut).trim() : t
}

/** 한 모델의 메시지 배열 → 통계. */
function statsFor(model: string, msgs: ChatMessage[]): ModelStats {
  const s: ModelStats = {
    model, count: msgs.length,
    totalChars: 0, avgChars: 0,
    totalLines: 0, avgLines: 0,
    codeBlockRatio: 0, codeFenceTotal: 0,
    emojiTotal: 0, emojiPer1k: 0,
    headerTotal: 0, headerPer1k: 0,
    listTotal: 0, listPer1k: 0,
    engCharRatio: 0, korCharRatio: 0,
    politenessScore: 0,
    topStartPatterns: [],
  }
  if (msgs.length === 0) return s

  let withCodeBlock = 0
  let engChars = 0, korChars = 0
  let politenessHits = 0
  const startCounts = new Map<string, number>()

  for (const m of msgs) {
    const text = String(m.content || '')
    s.totalChars += text.length
    s.totalLines += text.split('\n').length

    const fences = countMatches(text, CODE_FENCE_RE)
    const codeBlocks = Math.floor(fences / 2)  // 쌍으로
    s.codeFenceTotal += codeBlocks
    if (codeBlocks > 0) withCodeBlock++

    s.emojiTotal += countMatches(text, EMOJI_RE)

    const textNoCode = stripCode(text)
    s.headerTotal += countMatches(textNoCode, HEADER_RE)
    s.listTotal += countMatches(textNoCode, LIST_RE)
    engChars += countMatches(textNoCode, ENG_CHAR_RE)
    korChars += countMatches(textNoCode, KOR_CHAR_RE)

    for (const re of POLITENESS_PATTERNS) {
      politenessHits += countMatches(text, re)
    }

    const phrase = startPhrase(text)
    if (phrase) startCounts.set(phrase, (startCounts.get(phrase) ?? 0) + 1)
  }

  s.avgChars = s.totalChars / msgs.length
  s.avgLines = s.totalLines / msgs.length
  s.codeBlockRatio = withCodeBlock / msgs.length
  const per1k = s.totalChars > 0 ? 1000 / s.totalChars : 0
  s.emojiPer1k = s.emojiTotal * per1k
  s.headerPer1k = s.headerTotal * per1k
  s.listPer1k = s.listTotal * per1k
  const langTotal = engChars + korChars
  s.engCharRatio = langTotal > 0 ? engChars / langTotal : 0
  s.korCharRatio = langTotal > 0 ? korChars / langTotal : 0
  // politeness — 1 hit per 200 chars 정도면 1.0 으로 normalize (높을수록 정중).
  s.politenessScore = s.totalChars > 0
    ? Math.min(1, politenessHits / (s.totalChars / 200))
    : 0
  s.topStartPatterns = [...startCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([phrase, count]) => ({ phrase, count }))

  return s
}

/** assistant 메시지 배열 → 모델별 통계 분석. */
export function analyzeMessageStyles(messages: ChatMessage[], scope: 'active_chat' | 'all_chats' = 'active_chat'): StyleAnalysis {
  const assistantMsgs = messages.filter(m => m.role === 'assistant')
  const byModel = new Map<string, ChatMessage[]>()
  for (const m of assistantMsgs) {
    const key = String(m.model || 'claude')
    if (!byModel.has(key)) byModel.set(key, [])
    byModel.get(key)!.push(m)
  }
  const byModelStats: Record<string, ModelStats> = {}
  for (const [model, msgs] of byModel.entries()) {
    byModelStats[model] = statsFor(model, msgs)
  }
  const timestamps = assistantMsgs.map(m => m.timestamp).filter((t): t is number => typeof t === 'number')
  return {
    scope,
    totalMessages: messages.length,
    totalAssistantMessages: assistantMsgs.length,
    startedAt: timestamps.length ? Math.min(...timestamps) : 0,
    endedAt: timestamps.length ? Math.max(...timestamps) : 0,
    byModel: byModelStats,
  }
}
