// src/telegram/registry.ts
// 여러 OrchestrAI 창들이 서로를 발견하기 위한 파일 기반 레지스트리.
// ~/.orchestrai/instances/{id}.json 에 하트비트 쓰고, 30초 넘은 건 죽은 걸로 간주.

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const REGISTRY_DIR = path.join(os.homedir(), '.orchestrai', 'instances')
const STALE_MS = 30_000

export interface InstanceInfo {
  id: string              // 창마다 생성되는 랜덤 id
  workspacePath: string
  workspaceName: string   // 유저가 붙인 별칭 — /use 에서 이 이름으로 지정
  port: number            // HTTP worker 엔드포인트 포트
  isHub: boolean          // true면 Telegram polling 담당
  pid: number
  lastHeartbeat: number
}

function ensureDir() {
  try { fs.mkdirSync(REGISTRY_DIR, { recursive: true }) } catch {}
}

export function writeInstance(info: InstanceInfo): void {
  ensureDir()
  fs.writeFileSync(
    path.join(REGISTRY_DIR, `${info.id}.json`),
    JSON.stringify(info, null, 2),
  )
}

export function removeInstance(id: string): void {
  try { fs.unlinkSync(path.join(REGISTRY_DIR, `${id}.json`)) } catch {}
}

export function listInstances(): InstanceInfo[] {
  ensureDir()
  const now = Date.now()
  const result: InstanceInfo[] = []
  let files: string[] = []
  try { files = fs.readdirSync(REGISTRY_DIR) } catch { return [] }

  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const full = path.join(REGISTRY_DIR, f)
    try {
      const raw = fs.readFileSync(full, 'utf8')
      const info: InstanceInfo = JSON.parse(raw)
      // 30초 이상 하트비트 없으면 죽은 창 — 파일 정리
      if (now - info.lastHeartbeat > STALE_MS) {
        try { fs.unlinkSync(full) } catch {}
        continue
      }
      result.push(info)
    } catch {
      // 깨진 파일은 치움
      try { fs.unlinkSync(full) } catch {}
    }
  }
  return result
}

export function findHub(): InstanceInfo | null {
  return listInstances().find(i => i.isHub) ?? null
}

export function findByName(name: string): InstanceInfo | null {
  const lower = name.toLowerCase()
  return listInstances().find(i => i.workspaceName.toLowerCase() === lower) ?? null
}

export function workspaceTopicKey(workspacePath: string, workspaceName: string): string {
  const trimmedPath = workspacePath.trim()
  if (!trimmedPath || trimmedPath === '(no workspace)') {
    return `name:${workspaceName.trim().toLowerCase()}`
  }

  const normalized = path.resolve(trimmedPath).replace(/\\/g, '/')
  return `path:${process.platform === 'win32' ? normalized.toLowerCase() : normalized}`
}

export function instanceTopicKey(info: Pick<InstanceInfo, 'workspacePath' | 'workspaceName'>): string {
  return workspaceTopicKey(info.workspacePath, info.workspaceName)
}

export function findByTopicKey(key: string): InstanceInfo | null {
  return listInstances().find(i => instanceTopicKey(i) === key) ?? findByName(key)
}

// 모든 인스턴스가 공유하는 "현재 target" 포인터 — hub만 쓰고, 모든 인스턴스가 읽음
const TARGET_FILE = path.join(os.homedir(), '.orchestrai', 'target.json')

export function writeTarget(instanceId: string): void {
  ensureDir()
  try {
    fs.writeFileSync(TARGET_FILE, JSON.stringify({ instanceId, ts: Date.now() }))
  } catch {}
}

export function readTarget(): string | null {
  try {
    const raw = fs.readFileSync(TARGET_FILE, 'utf8')
    const data = JSON.parse(raw)
    return typeof data.instanceId === 'string' ? data.instanceId : null
  } catch {
    return null
  }
}

// Forum topics 매핑: 워크스페이스 이름 → message_thread_id
// Hub가 생성/갱신하고 모든 인스턴스가 조회. 토픽 자체는 새로 생성하지 않으면 텔레그램이 유지 → 히스토리 유지.
const TOPICS_FILE = path.join(os.homedir(), '.orchestrai', 'topics.json')

export function readTopics(): Record<string, number> {
  try {
    const raw = fs.readFileSync(TOPICS_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object') return data
  } catch {}
  return {}
}

export function writeTopics(map: Record<string, number>): void {
  ensureDir()
  try {
    fs.writeFileSync(TOPICS_FILE, JSON.stringify(map, null, 2))
  } catch {}
}
