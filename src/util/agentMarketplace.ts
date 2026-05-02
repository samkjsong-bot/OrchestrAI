// src/util/agentMarketplace.ts
// AI agent (= 커스텀 system prompt + 추천 모드/effort) 공유 시스템.
// GitHub Gist 기반 — 서버 인프라 0, 사용자가 Gist URL 입력하거나 직접 만든 prompt 저장.

import * as fs from 'fs'
import * as path from 'path'
import { log } from './log'

export interface SharedAgent {
  name: string                        // "vibe-game-builder"
  description: string                 // "한 줄 짜리 게임 만들어주는 agent"
  author?: string
  systemPrompt: string                // 시스템 프롬프트 본문
  recommendedMode?: 'auto' | 'team' | 'boomerang' | 'loop' | 'argue'
  recommendedEffort?: 'low' | 'medium' | 'high' | 'extra-high'
  modelHint?: 'claude' | 'codex' | 'gemini'
  tags?: string[]
  version?: string
}

// Gist URL 또는 raw URL → SharedAgent
export async function fetchAgentFromUrl(url: string): Promise<SharedAgent> {
  // Gist URL 정규화: https://gist.github.com/USER/HASH → raw URL
  let fetchUrl = url.trim()
  const gistMatch = fetchUrl.match(/^https:\/\/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i)
  if (gistMatch) {
    // gist API로 첫 파일 raw 받기
    const apiUrl = `https://api.github.com/gists/${gistMatch[1]}`
    const r = await fetch(apiUrl)
    if (!r.ok) throw new Error(`Gist fetch ${r.status}`)
    const data = await r.json() as any
    const files = Object.values(data.files ?? {}) as any[]
    const jsonFile = files.find(f => f.filename?.endsWith('.json')) ?? files[0]
    if (!jsonFile?.content) throw new Error('Gist 안에 파일 없음')
    return parseAgent(jsonFile.content)
  }
  // 일반 URL → fetch 후 JSON parse
  const r = await fetch(fetchUrl)
  if (!r.ok) throw new Error(`fetch ${r.status}`)
  const text = await r.text()
  return parseAgent(text)
}

function parseAgent(text: string): SharedAgent {
  const data = JSON.parse(text)
  if (!data.name || !data.systemPrompt) throw new Error('agent JSON에 name/systemPrompt 누락')
  return {
    name: String(data.name),
    description: String(data.description ?? ''),
    author: data.author ? String(data.author) : undefined,
    systemPrompt: String(data.systemPrompt),
    recommendedMode: data.recommendedMode,
    recommendedEffort: data.recommendedEffort,
    modelHint: data.modelHint,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
    version: data.version ? String(data.version) : undefined,
  }
}

// 디스크에 저장된 agent들 — 사용자가 import한 + 자체 만든
const AGENTS_FILE = 'agents.json'

interface AgentStore {
  agents: SharedAgent[]
  activeAgent?: string  // 현재 활성화된 agent 이름
}

function agentsFilePath(storageRoot: string): string {
  const dir = path.join(storageRoot, 'agents')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, AGENTS_FILE)
}

export function loadAgentStore(storageRoot: string): AgentStore {
  try {
    const p = agentsFilePath(storageRoot)
    if (!fs.existsSync(p)) return { agents: [] }
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (err) {
    log.warn('agents', 'load failed:', err)
    return { agents: [] }
  }
}

export function saveAgentStore(storageRoot: string, store: AgentStore): void {
  fs.writeFileSync(agentsFilePath(storageRoot), JSON.stringify(store, null, 2), 'utf8')
}

export function addAgent(storageRoot: string, agent: SharedAgent): void {
  const store = loadAgentStore(storageRoot)
  // 같은 이름 있으면 덮어씀
  store.agents = store.agents.filter(a => a.name !== agent.name)
  store.agents.push(agent)
  saveAgentStore(storageRoot, store)
}

export function removeAgent(storageRoot: string, name: string): void {
  const store = loadAgentStore(storageRoot)
  store.agents = store.agents.filter(a => a.name !== name)
  if (store.activeAgent === name) store.activeAgent = undefined
  saveAgentStore(storageRoot, store)
}

export function setActiveAgent(storageRoot: string, name: string | undefined): void {
  const store = loadAgentStore(storageRoot)
  store.activeAgent = name
  saveAgentStore(storageRoot, store)
}

export function getActiveAgent(storageRoot: string): SharedAgent | null {
  const store = loadAgentStore(storageRoot)
  if (!store.activeAgent) return null
  return store.agents.find(a => a.name === store.activeAgent) ?? null
}
