// src/telegram/bridge.ts
// Hub/Worker 통합 브리지.
// - 시작할 때 WorkerServer 띄우고 레지스트리에 하트비트.
// - Hub 없으면 hub 자격 획득 → Telegram polling 시작.
// - Hub이면: 폰 메시지 받음 → target 창으로 라우팅 (로컬 or 다른 창 HTTP).
// - Hub 아니면: 가만히 있다가 Hub이 보낸 /chat 요청 처리.

import * as vscode from 'vscode'
import * as crypto from 'crypto'
import { TelegramClient, TgMessage } from './client'
import { writeInstance, removeInstance, listInstances, findHub, findByTopicKey, instanceTopicKey, workspaceTopicKey, writeTarget, readTarget, readTopics, writeTopics, InstanceInfo } from './registry'
import { WorkerServer } from './workerServer'
import { log } from '../util/log'

const HEARTBEAT_MS = 8_000
const HUB_CHECK_MS = 15_000
const EDIT_INTERVAL_MS = 1_500
const TG_MAX = 4096

export type PermissionMode = 'ask' | 'auto-edit' | 'plan' | 'smart-auto'
export type OverrideMode = 'auto' | 'claude' | 'codex' | 'gemini' | 'argue' | 'team'

export interface TelegramBridgeHost {
  addExternalObserver(fn: (msg: any) => void): vscode.Disposable
  sendFromExternal(text: string, attachments?: any[]): Promise<void>
  getWorkspacePath(): string
  setPermissionMode(mode: PermissionMode): void
  setOverrideMode(mode: OverrideMode): void
  resolvePendingApproval(approved: boolean): boolean
}

interface ActiveStream {
  messageId: number
  buffer: string
  lastEdit: number
  observer: vscode.Disposable
  modelLabel?: string
  targetName: string
  done: boolean
  chunkStart: number          // 현재 placeholder가 보여주는 buffer 영역의 시작 index
  threadOpt?: { message_thread_id?: number }  // 새 placeholder send할 때 사용
  rolling: boolean             // 새 placeholder 만드는 중 (race 방지)
}

export class TelegramBridge implements vscode.Disposable {
  private id = crypto.randomBytes(6).toString('hex')
  private workspaceName: string
  private workspacePath: string
  private server = new WorkerServer()
  private port = 0
  private client?: TelegramClient
  private isHub = false
  private currentTargetId: string
  private heartbeatTimer?: NodeJS.Timeout
  private hubCheckTimer?: NodeJS.Timeout
  private disposed = false
  private activeStream?: ActiveStream
  private persistentObserver?: vscode.Disposable
  private desktopSync?: { user: string; buffer: string; modelLabel?: string }
  private sendClient?: TelegramClient  // 푸시 알림용 별도 클라이언트 (polling 안 함)
  private isHandlingExternal = false   // worker가 hub의 HTTP 요청 처리 중 플래그

  private useTopics: boolean
  private myThreadId?: number  // 이 워크스페이스에 배정된 forum topic thread id
  private botUsername?: string  // 그룹에서 /cmd@botname 형식 처리용

  constructor(
    private host: TelegramBridgeHost,
    private token: string,
    private chatId: string,
    name: string,
    useTopics: boolean = false,
  ) {
    this.workspaceName = name
    this.workspacePath = host.getWorkspacePath()
    this.currentTargetId = this.id  // 기본 대상 = 자기 자신
    this.useTopics = useTopics
  }

  private _topicKey(): string {
    return workspaceTopicKey(this.workspacePath, this.workspaceName)
  }

  private _topicKeyFor(inst: InstanceInfo): string {
    return instanceTopicKey(inst)
  }

  private _topicTitle(workspaceName: string, workspacePath: string): string {
    if (!workspacePath || workspacePath === '(no workspace)') return workspaceName
    const folder = workspacePath.split(/[\\/]+/).filter(Boolean).at(-1)
    if (folder && folder.toLowerCase() !== workspaceName.toLowerCase()) return folder
    const parent = workspacePath.split(/[\\/]+/).filter(Boolean).slice(-2, -1)[0]
    return parent ? `${workspaceName} · ${parent}` : workspaceName
  }

  private _displayName(inst: InstanceInfo): string {
    const folder = inst.workspacePath.split(/[\\/]+/).filter(Boolean).at(-1)
    if (folder && folder.toLowerCase() !== inst.workspaceName.toLowerCase()) {
      return `${folder} (${inst.workspaceName})`
    }
    return inst.workspaceName
  }

  private _resolveInstanceArg(arg: string): InstanceInfo | null {
    const query = arg.trim()
    const instances = listInstances()

    const index = Number(query)
    if (Number.isInteger(index) && index >= 1 && index <= instances.length) {
      return instances[index - 1]
    }

    const lower = query.toLowerCase()
    const exactName = instances.filter(i => i.workspaceName.toLowerCase() === lower)
    if (exactName.length === 1) return exactName[0]

    const exactFolder = instances.filter(i => {
      const folder = i.workspacePath.split(/[\\/]+/).filter(Boolean).at(-1)
      return folder?.toLowerCase() === lower
    })
    if (exactFolder.length === 1) return exactFolder[0]

    return instances.find(i => i.workspacePath.toLowerCase().includes(lower)) ?? null
  }

  async start() {
    // 모든 창이 HTTP 서버 띄움 (자동 포트)
    this.port = await this.server.start({
      onChat: (text, send, end) => this._onWorkerChat(text, send, end),
      onSetMode: (kind, value) => this._onWorkerSetMode(kind, value),
      onResolveApproval: (approved) => this.host.resolvePendingApproval(approved),
    })

    // 약간 지연 (동시 시작 레이스 완화)
    await new Promise(r => setTimeout(r, Math.random() * 500))

    const existingHub = findHub()
    if (!existingHub) {
      await this._becomeHub()
    } else {
      log.info('telegram', `hub exists (${this._displayName(existingHub)}), starting as worker`)
      this._writeHeartbeat()
    }

    // 주기적 하트비트 + hub 체크
    this.heartbeatTimer = setInterval(() => this._writeHeartbeat(), HEARTBEAT_MS)
    this.hubCheckTimer = setInterval(() => this._checkHub(), HUB_CHECK_MS)

    // 모든 인스턴스가 푸시 알림용 client 가짐 (hub polling client와 별개)
    this.sendClient = new TelegramClient(this.token)

    // 데스크톱 대화 감지용 영구 옵저버
    this.persistentObserver = this.host.addExternalObserver(msg => this._onPersistentEvent(msg))

    // topics 모드면 worker도 자기 topic을 확보 (hub이 없어도 / 있어도 동작)
    if (this.useTopics) {
      await this._ensureOwnTopic()
    }
  }

  // 이 워크스페이스의 topic이 존재하는지 확인, 없으면 만들기 (worker도 호출 가능)
  private async _ensureOwnTopic() {
    if (!this.useTopics || !this.sendClient) return
    const topicMap = readTopics()
    const key = this._topicKey()
    if (topicMap[key]) {
      this.myThreadId = topicMap[key]
      return
    }
    try {
      const result = await this.sendClient.createForumTopic(this.chatId, `📁 ${this._topicTitle(this.workspaceName, this.workspacePath)}`)
      topicMap[key] = result.message_thread_id
      writeTopics(topicMap)
      this.myThreadId = result.message_thread_id
      log.info('telegram', `created own topic "${this._topicTitle(this.workspaceName, this.workspacePath)}" (thread ${result.message_thread_id})`)
    } catch (err) {
      log.warn('telegram', `failed to create own topic for ${this.workspaceName}:`, err)
      // 실패 원인: 봇이 관리자 아님 / Manage Topics 권한 없음 / 그룹이 forum 아님 → 유저에게 알림
      void this.sendClient.sendMessage(
        this.chatId,
        `⚠ "${this.workspaceName}" topic 생성 실패. 봇이 그룹 관리자이고 'Manage Topics' 권한 있는지 확인해주세요.`,
      ).catch(() => undefined)
    }
  }

  private _writeHeartbeat() {
    if (this.disposed) return
    writeInstance({
      id: this.id,
      workspacePath: this.workspacePath,
      workspaceName: this.workspaceName,
      port: this.port,
      isHub: this.isHub,
      pid: process.pid,
      lastHeartbeat: Date.now(),
    })
  }

  private async _becomeHub() {
    // race 방지: target 파일에 자기 ID 쓰고 jitter 후 재확인. 다른 인스턴스가 더 늦게 썼으면 자기는 강등.
    writeTarget(this.id)
    await new Promise(r => setTimeout(r, 300 + Math.random() * 400))
    const winnerId = readTarget()
    if (winnerId !== this.id) {
      log.info('telegram', `lost hub claim race (winner=${winnerId?.slice(0, 8)}), staying as worker`)
      this.isHub = false
      this._writeHeartbeat()
      return
    }
    this.isHub = true
    this.currentTargetId = this.id
    this._writeHeartbeat()

    this.client = new TelegramClient(this.token)
    try {
      const me = await this.client.getMe()
      this.botUsername = me.username
      log.info('telegram', `HUB @${me.username ?? me.id} on ${this._topicTitle(this.workspaceName, this.workspacePath)}`)
    } catch (err) {
      this.isHub = false
      this._writeHeartbeat()
      throw err
    }

    // "/" 자동완성에 뜰 명령어 목록 등록 — 1회면 됨 (텔레그램 캐시)
    await this.client.setMyCommands([
      { command: 'help',       description: '도움말 + 전체 명령어' },
      { command: 'list',       description: '열린 창 목록' },
      { command: 'use',        description: '<이름> — 대상 창 전환' },
      { command: 'bind',       description: '<번호> 현재 topic을 창에 연결' },
      { command: 'approve',    description: '대기 중인 작업 승인' },
      { command: 'reject',     description: '대기 중인 작업 거절' },
      { command: 'pwd',        description: '현재 대상 경로' },
      { command: 'ping',       description: '연결 확인' },
      { command: 'plan',       description: '📋 Plan mode — 계획.md 먼저' },
      { command: 'ask',        description: '✋ 수정 전 확인' },
      { command: 'auto',       description: '</> 자동 수정' },
      { command: 'smart',      description: '⚡ 스마트 자동' },
      { command: 'argue',      description: '⇆ 토론 모드' },
      { command: 'team',       description: '👥 협업 (Claude→Codex→Gemini)' },
      { command: 'claude',     description: '◆ Claude 강제' },
      { command: 'codex',      description: '◇ Codex 강제' },
      { command: 'gemini',     description: '◈ Gemini 강제' },
      { command: 'reset',      description: '⚡ auto 라우팅 복귀' },
      { command: 'vibe',       description: '🎨 바이브코딩 가이드' },
      { command: 'examples',   description: '💬 프롬프트 예시' },
      { command: 'cheatsheet', description: '📋 한 장 정리' },
    ])

    // topics 모드면 모든 워크스페이스에 대해 topic 확보
    if (this.useTopics) {
      await this._ensureAllTopics()
    }

    const peers = listInstances().filter(i => i.id !== this.id)
    const peerLine = peers.length > 0
      ? `\n다른 창: ${peers.map(p => this._displayName(p)).join(', ')}`
      : ''
    const topicLine = this.useTopics ? '\n\n📁 각 폴더별 topic에서 대화하세요' : ''
    await this._sendToOwnTopic(
      `✅ OrchestrAI 연결됨 (${this._topicTitle(this.workspaceName, this.workspacePath)})${peerLine}${topicLine}\n\n/list · /use <번호|이름> · /help`,
    ).catch(() => undefined)

    void this.client.startPolling(
      msg => this._onTelegramMessage(msg),
      () => this._demoteFromHub('persistent 409'),
    )
  }

  // hub 자격 잃음 — worker로 강등. 다음 _checkHub tick에서 재경합 (또는 진짜 hub 보고 worker로 정착)
  private _demoteFromHub(reason: string) {
    log.warn('telegram', `demoting from hub (${reason})`)
    this.isHub = false
    this.client = undefined
    this._writeHeartbeat()
  }

  // 각 등록된 워크스페이스에 대해 topic 존재 확인하고 없으면 생성 (topics 모드 전용)
  private async _ensureAllTopics() {
    if (!this.useTopics || !this.client) return
    const instances = listInstances()
    const topicMap = readTopics()
    let changed = false

    for (const inst of instances) {
      const key = this._topicKeyFor(inst)
      if (topicMap[key]) continue  // 이미 있음
      try {
        const result = await this.client.createForumTopic(this.chatId, `📁 ${this._topicTitle(inst.workspaceName, inst.workspacePath)}`)
        topicMap[key] = result.message_thread_id
        changed = true
        log.info('telegram', `created topic for ${this._displayName(inst)} (thread ${result.message_thread_id})`)
      } catch (err) {
        log.warn('telegram', `failed to create topic for ${inst.workspaceName}:`, err)
        // 그룹이 forum 아니거나 봇 권한 없으면 계속 실패 — 한 번 로그만 남기고 다음
      }
    }
    if (changed) writeTopics(topicMap)
    // 내 thread id 캐시
    this.myThreadId = topicMap[this._topicKey()]
  }

  // topic 모드일 때 워크스페이스 이름으로 thread_id 조회 (없으면 즉석 생성 시도)
  private async _threadIdFor(workspaceName: string, workspacePath: string = this.workspacePath): Promise<number | undefined> {
    if (!this.useTopics || !this.client) return undefined
    const topicMap = readTopics()
    const key = workspaceTopicKey(workspacePath, workspaceName)
    if (topicMap[key]) return topicMap[key]
    try {
      const result = await this.client.createForumTopic(this.chatId, `📁 ${this._topicTitle(workspaceName, workspacePath)}`)
      topicMap[key] = result.message_thread_id
      writeTopics(topicMap)
      return result.message_thread_id
    } catch (err) {
      log.warn('telegram', `failed to create topic for ${workspaceName}:`, err)
      return undefined
    }
  }

  // 자기 워크스페이스 topic으로 메시지 전송
  private async _sendToOwnTopic(text: string) {
    if (!this.client) return null as any
    const thread_id = this.useTopics ? await this._threadIdFor(this.workspaceName, this.workspacePath) : undefined
    return this.client.sendMessage(this.chatId, text, { message_thread_id: thread_id })
  }

  private async _checkHub() {
    if (this.disposed) return
    if (this.isHub) {
      // hub이면 주기적으로 새로 들어온 워크스페이스 topic도 챙김
      if (this.useTopics) {
        await this._ensureAllTopics().catch(() => undefined)
      }
      return
    }
    const hub = findHub()
    if (!hub) {
      // 허브가 죽었다 → 내가 승격
      log.info('telegram', 'no hub detected, taking over')
      try { await this._becomeHub() } catch (err) {
        log.error('telegram', 'hub takeover failed:', err)
      }
    } else {
      // worker — 혹시 내 topic이 아직 없으면 확보 (startup 때 실패했을 수도)
      if (this.useTopics && !this.myThreadId) {
        await this._ensureOwnTopic().catch(() => undefined)
      }
    }
  }

  // ── Telegram 수신 (Hub 전용) ───────────────────────────────────

  private async _onTelegramMessage(msg: TgMessage) {
    if (!this.isHub || !this.client) return
    if (String(msg.chat.id) !== String(this.chatId)) {
      log.warn('telegram', `rejected chat ${msg.chat.id}`)
      return
    }
    const text = (msg.text ?? '').trim()
    if (!text) return

    // topics 모드: 메시지가 어떤 topic에서 왔는지로 target 자동 결정
    let overrideTargetId: string | undefined
    let unmappedTopic = false
    if (this.useTopics && msg.message_thread_id != null) {
      const topicMap = readTopics()
      const topicKey = Object.keys(topicMap).find(k => topicMap[k] === msg.message_thread_id)
      if (topicKey) {
        const inst = findByTopicKey(topicKey)
        if (inst) overrideTargetId = inst.id
      } else {
        unmappedTopic = true
      }
      // General(thread_id 없는 채팅은 위 블록 실행 안 됨)이나 매핑 없는 topic은 currentTargetId로 폴백
    }

    if (text.startsWith('/')) {
      await this._handleCommand(text, msg.message_thread_id)
    } else {
      await this._routeChat(text, overrideTargetId, msg.message_thread_id, unmappedTopic)
    }
  }

  private async _handleCommand(text: string, replyToThreadId?: number) {
    if (!this.client) return
    const [cmdRaw, ...args] = text.slice(1).split(/\s+/)

    // 그룹에서 자동완성 누르면 텔레그램이 "/cmd@botname" 형태로 보냄
    // @ 뒤에 붙은 봇 이름이 우리 봇이 아니면 무시, 맞으면 떼고 매칭
    const atIdx = cmdRaw.indexOf('@')
    if (atIdx >= 0) {
      const target = cmdRaw.slice(atIdx + 1).toLowerCase()
      if (this.botUsername && target !== this.botUsername.toLowerCase()) {
        return  // 다른 봇한테 가는 명령 — 우리가 응답하지 않음
      }
    }
    const cmd = (atIdx >= 0 ? cmdRaw.slice(0, atIdx) : cmdRaw).toLowerCase()
    const arg = args.join(' ').trim()
    const threadOpt = replyToThreadId != null ? { message_thread_id: replyToThreadId } : undefined
    const reply = (t: string) => this.client!.sendMessage(this.chatId, t, threadOpt)

    // topics 모드에서 현재 thread 추론 (Telegram이 준 thread_id → 워크스페이스 이름)
    const topicTargetName = this.useTopics && replyToThreadId != null
      ? Object.keys(readTopics()).find(k => readTopics()[k] === replyToThreadId)
      : undefined

    switch (cmd) {
      case 'start':
      case 'help':
        await reply([
          '🎛 OrchestrAI 봇',
          '',
          '📍 창 관리',
          '/list — 열린 창 목록',
          '/use <번호|이름> — 대상 창 전환 (일반 채팅)',
          '/bind <번호|이름> — 현재 topic을 창에 연결',
          '/pwd — 현재 대상 경로',
          '/ping — 연결 확인',
          '',
          '⚙ 모드 변경 (이 topic 창에 적용)',
          '/plan · /ask · /auto · /smart — 권한 모드',
          '/argue · /team — 협업/토론',
          '/claude · /codex · /gemini · /reset — 모델 강제',
          '',
          '📘 가이드',
          '/vibe · /examples · /cheatsheet',
          '',
          this.useTopics
            ? '📁 각 폴더별 topic에서 대화하면 자동 라우팅'
            : '일반 텍스트는 현재 대상 창으로 라우팅',
        ].join('\n'))
        return

      case 'vibe':      await this._sendLongMessage(VIBE_GUIDE, replyToThreadId); return
      case 'examples':  await this._sendLongMessage(VIBE_EXAMPLES, replyToThreadId); return
      case 'cheatsheet': await this._sendLongMessage(VIBE_CHEATSHEET, replyToThreadId); return

      case 'list': {
        const instances = listInstances()
        const topicMap = readTopics()
        const lines = instances.map((i, idx) => {
          const mark = i.id === this.currentTargetId ? '●' : '○'
          const hub = i.isHub ? ' (HUB)' : ''
          const topicKey = this._topicKeyFor(i)
          const topic = this.useTopics && topicMap[topicKey]
            ? ` · topic ${topicMap[topicKey]}`
            : ''
          return `${mark} ${idx + 1}. ${this._displayName(i)}${hub}${topic}\n   ${i.workspacePath}`
        }).join('\n\n')
        await reply(
          `📋 창 ${instances.length}개\n\n${lines}\n\n${this.useTopics ? 'topic 안에서 /bind <번호> 로 연결 가능' : '/use <번호|이름> 로 전환'}`,
        )
        return
      }

      case 'use': {
        if (!arg) { await reply('사용법: /use <번호|이름> — /list 로 번호 확인'); return }
        const target = this._resolveInstanceArg(arg)
        if (!target) { await reply(`❌ "${arg}" 없음. /list 로 확인`); return }
        this.currentTargetId = target.id
        writeTarget(target.id)
        await reply(`✅ 대상 → ${this._displayName(target)}${target.isHub ? ' (HUB)' : ''}\n${target.workspacePath}`)
        return
      }

      case 'bind': {
        if (!this.useTopics || replyToThreadId == null) {
          await reply('사용법: 연결할 Telegram topic 안에서 /bind <번호|이름>')
          return
        }
        if (!arg) { await reply('사용법: /bind <번호|이름> — /list 로 번호 확인'); return }
        const target = this._resolveInstanceArg(arg)
        if (!target) { await reply(`❌ "${arg}" 없음. /list 로 확인`); return }

        // thread_id ↔ workspace 매핑만 저장. 글로벌 currentTargetId는 건드리지 않음
        // (그래야 다른 topic의 매핑이 영향받지 않음 — /use 는 글로벌 fallback 변경)
        const topicMap = readTopics()
        for (const key of Object.keys(topicMap)) {
          if (topicMap[key] === replyToThreadId) delete topicMap[key]
        }
        topicMap[this._topicKeyFor(target)] = replyToThreadId
        writeTopics(topicMap)
        await reply(`✅ 이 topic → ${this._displayName(target)}\n${target.workspacePath}`)
        return
      }

      case 'approve':
      case 'yes':
      case 'ok':
        return this._remoteResolveApproval(true, topicTargetName, replyToThreadId)

      case 'reject':
      case 'no':
        return this._remoteResolveApproval(false, topicTargetName, replyToThreadId)

      case 'pwd': {
        // 이 topic에 bind된 워크스페이스 우선, 없으면 글로벌 fallback (/use 로 정한 거)
        const t = topicTargetName
          ? findByTopicKey(topicTargetName) ?? this._resolveTarget()
          : this._resolveTarget()
        if (!t) { await reply('❌ 대상 없음 (창이 닫혔을 수 있음). /list 확인'); return }
        const source = topicTargetName ? '(this topic)' : '(global /use)'
        await reply(`📁 ${this._displayName(t)} ${source}\n${t.workspacePath}`)
        return
      }

      case 'ping':
        await reply('🏓 pong')
        return

      // ── 모드 명령 — topic에서 호출했으면 그 topic의 워크스페이스에 적용, 아니면 current target ──
      case 'plan':   return this._remoteSetMode('permission', 'plan', '📋 Plan mode', topicTargetName, replyToThreadId)
      case 'ask':    return this._remoteSetMode('permission', 'ask', '✋ Ask-before-edits', topicTargetName, replyToThreadId)
      case 'auto':   return this._remoteSetMode('permission', 'auto-edit', '</> Edit automatically', topicTargetName, replyToThreadId)
      case 'smart':  return this._remoteSetMode('permission', 'smart-auto', '⚡ Smart auto', topicTargetName, replyToThreadId)
      case 'argue':  return this._remoteSetMode('override', 'argue', '⇆ Argue', topicTargetName, replyToThreadId)
      case 'team':   return this._remoteSetMode('override', 'team', '👥 Team', topicTargetName, replyToThreadId)
      case 'claude': return this._remoteSetMode('override', 'claude', '◆ Force Claude', topicTargetName, replyToThreadId)
      case 'codex':  return this._remoteSetMode('override', 'codex', '◇ Force Codex', topicTargetName, replyToThreadId)
      case 'gemini': return this._remoteSetMode('override', 'gemini', '◈ Force Gemini', topicTargetName, replyToThreadId)
      case 'reset':  return this._remoteSetMode('override', 'auto', '⚡ Auto routing', topicTargetName, replyToThreadId)
    }

    await reply(`알 수 없는 명령: /${cmd}\n/help`)
  }

  private _resolveTarget(): InstanceInfo | null {
    return listInstances().find(i => i.id === this.currentTargetId) ?? null
  }

  private async _remoteSetMode(
    kind: 'permission' | 'override',
    value: string,
    label: string,
    topicTargetName?: string,
    replyThreadId?: number,
  ) {
    if (!this.client) return
    const threadOpt = replyThreadId != null ? { message_thread_id: replyThreadId } : undefined
    const reply = (t: string) => this.client!.sendMessage(this.chatId, t, threadOpt)

    // topic 모드면 topic의 워크스페이스가 우선 대상
    const target = topicTargetName
      ? findByTopicKey(topicTargetName) ?? this._resolveTarget()
      : this._resolveTarget()
    if (!target) { await reply('❌ 대상 없음'); return }
    try {
      if (target.id === this.id) {
        if (kind === 'permission') this.host.setPermissionMode(value as PermissionMode)
        else this.host.setOverrideMode(value as OverrideMode)
      } else {
        const res = await fetch(`http://127.0.0.1:${target.port}/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, value }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      await reply(`${label} → ${target.workspaceName}`)
    } catch (err) {
      await reply(`❌ 모드 변경 실패 (${target.workspaceName}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async _remoteResolveApproval(
    approved: boolean,
    topicTargetName?: string,
    replyThreadId?: number,
  ) {
    if (!this.client) return
    const threadOpt = replyThreadId != null ? { message_thread_id: replyThreadId } : undefined
    const reply = (t: string) => this.client!.sendMessage(this.chatId, t, threadOpt)
    const target = topicTargetName
      ? findByTopicKey(topicTargetName) ?? this._resolveTarget()
      : this._resolveTarget()
    if (!target) { await reply('대상 창이 없어요. /list 확인'); return }

    try {
      let ok = false
      if (target.id === this.id) {
        ok = this.host.resolvePendingApproval(approved)
      } else {
        const res = await fetch(`http://127.0.0.1:${target.port}/approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved }),
        })
        ok = res.ok
      }
      await reply(ok
        ? `${approved ? '승인' : '거절'}됨 → ${this._displayName(target)}`
        : `대기 중인 승인 요청이 없어요 → ${this._displayName(target)}`)
    } catch (err) {
      await reply(`승인 처리 실패 (${this._displayName(target)}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async _routeChat(text: string, overrideTargetId?: string, replyThreadId?: number, unmappedTopic = false) {
    if (!this.client) return
    // topic에서 왔으면 거기가 target, 아니면 /use로 지정된 current target
    let target: InstanceInfo | null = null
    if (overrideTargetId) {
      target = listInstances().find(i => i.id === overrideTargetId) ?? null
    }
    target = target ?? this._resolveTarget()

    const threadOpt = replyThreadId != null ? { message_thread_id: replyThreadId } : undefined
    if (unmappedTopic) {
      await this.client.sendMessage(
        this.chatId,
        '이 topic은 아직 OrchestrAI 창에 연결되지 않았어요.\n/list 로 번호 확인 후 이 topic 안에서 /bind <번호> 를 보내주세요.',
        threadOpt,
      )
      return
    }
    if (!target) {
      await this.client.sendMessage(this.chatId, '❌ 대상 없음. /list 확인', threadOpt)
      return
    }
    if (target.id === this.id) {
      await this._processLocal(text, target.workspaceName, threadOpt)
    } else {
      await this._forwardToWorker(target, text, threadOpt)
    }
  }

  // ── 로컬(허브 창 자체) 처리 ────────────────────────────────────

  private async _processLocal(text: string, targetName: string, threadOpt?: { message_thread_id?: number }) {
    if (!this.client) return
    let placeholder
    try {
      placeholder = await this.client.sendMessage(this.chatId, `⏳ ${targetName}...`, threadOpt)
    } catch { return }

    this.activeStream?.observer.dispose()
    this.isHandlingExternal = true  // 영구 옵저버 중복 푸시 방지

    const observer = this.host.addExternalObserver((msg) => {
      if (!this.activeStream) return
      if (msg.type === 'routingDecision') {
        this.activeStream.modelLabel = `${msg.decision.model} · ${msg.decision.effort}`
        void this._editStream(this._header() + '⏳ 생각 중...')
      } else if (msg.type === 'streamChunk') {
        this.activeStream.buffer += msg.text
        this._maybeEdit()
      } else if (msg.type === 'streamEnd') {
        this.activeStream.done = true
        // 긴 응답은 placeholder 마무리 + 나머지를 별도 메시지로 분할 발송
        const stream = this.activeStream
        void (async () => {
          await this._finalizeAndSplit(stream, threadOpt)
        })()
        this.activeStream.observer.dispose()
        this.activeStream = undefined
        this.isHandlingExternal = false
      } else if (msg.type === 'streamError') {
        this.activeStream.done = true
        void this._editStream(`❌ ${msg.error}`)
        this.activeStream.observer.dispose()
        this.activeStream = undefined
        this.isHandlingExternal = false
      } else if (msg.type === 'approvalRequested') {
        void this.client!.sendMessage(this.chatId, this._formatApproval(msg), threadOpt).catch(() => undefined)
      }
    })

    this.activeStream = {
      messageId: placeholder.message_id,
      buffer: '',
      lastEdit: Date.now(),
      observer,
      targetName,
      done: false,
      chunkStart: 0,
      threadOpt,
      rolling: false,
    }

    try {
      await this.host.sendFromExternal(text)
    } catch (err) {
      if (this.activeStream) {
        await this._editStream(`❌ ${err instanceof Error ? err.message : String(err)}`)
        this.activeStream.observer.dispose()
        this.activeStream = undefined
      }
    }
  }

  // ── 다른 창(worker)으로 HTTP 포워딩 ─────────────────────────────

  private async _forwardToWorker(target: InstanceInfo, text: string, threadOpt?: { message_thread_id?: number }) {
    if (!this.client) return
    let placeholder
    try {
      placeholder = await this.client.sendMessage(
        this.chatId,
        `⏳ ${target.workspaceName}...`,
        threadOpt,
      )
    } catch { return }

    let buffer = ''
    let chunkStart = 0           // 현재 placeholder가 보여주는 buffer 영역 시작
    let lastEdit = Date.now()
    let currentMessageId = placeholder.message_id
    const header = `🎯 ${target.workspaceName}\n\n`
    const limit = TG_MAX - header.length - 100

    const edit = async (body: string) => {
      await this.client!.editMessageText(this.chatId, currentMessageId, `${header}${body}`).catch(() => undefined)
    }

    // 4000자 도달 시 새 placeholder 자동 roll
    const maybeRoll = async () => {
      const tail = buffer.slice(chunkStart)
      if (tail.length <= limit) return false
      const splitAt = (() => {
        const tryNL = tail.lastIndexOf('\n', limit)
        return tryNL > limit - 500 ? tryNL : limit
      })()
      const firstPart = tail.slice(0, splitAt)
      try {
        await this.client!.editMessageText(this.chatId, currentMessageId, `${header}${firstPart}\n\n…(이어짐 ↓)`)
      } catch {}
      try {
        const next = await this.client!.sendMessage(this.chatId, '⏳ ...', threadOpt)
        currentMessageId = next.message_id
        chunkStart += firstPart.length
        lastEdit = 0
      } catch {}
      return true
    }

    try {
      const res = await fetch(`http://127.0.0.1:${target.port}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.body) throw new Error('no body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let pendingLine = ''
      let lastErr: string | undefined

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pendingLine += decoder.decode(value, { stream: true })
        const lines = pendingLine.split('\n')
        pendingLine = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (typeof data.chunk === 'string') {
              buffer += data.chunk
              const rolled = await maybeRoll()
              const now = Date.now()
              if (rolled || now - lastEdit > EDIT_INTERVAL_MS) {
                lastEdit = now
                await edit(buffer.slice(chunkStart))
              }
            } else if (data.done) {
              if (!data.ok) lastErr = data.error ?? 'unknown error'
              break outer
            }
          } catch {}
        }
      }

      // 마무리: 남은 chunk 분할 발송
      if (lastErr) {
        await edit(`❌ ${lastErr}`)
      } else {
        const remaining = buffer.slice(chunkStart)
        if (remaining.length <= limit) {
          await edit(remaining || '(빈 응답)')
        } else {
          // 첫 part는 현재 placeholder, 나머지는 새 메시지로
          const firstPart = remaining.slice(0, limit)
          await edit(firstPart + '\n\n…(이어짐 ↓)')
          let rest = remaining.slice(limit)
          let partNum = 2
          while (rest.length > 0) {
            const chunkLimit = TG_MAX - 60
            let splitAt = rest.length <= chunkLimit ? rest.length :
              (rest.lastIndexOf('\n', chunkLimit) > chunkLimit - 500 ? rest.lastIndexOf('\n', chunkLimit) : chunkLimit)
            const part = rest.slice(0, splitAt)
            rest = rest.slice(splitAt).trimStart()
            const tag = rest.length > 0 ? `(part ${partNum} ↓)` : `(part ${partNum} · 끝)`
            try { await this.client!.sendMessage(this.chatId, `${tag}\n\n${part}`, threadOpt) } catch {}
            partNum++
          }
        }
      }
    } catch (err) {
      await edit(`❌ 통신 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Worker로 HTTP 요청 받음 (Hub가 우리한테 보낸 메시지) ───────

  private async _onWorkerChat(
    text: string,
    send: (chunk: string) => void,
    end: (info: { ok: boolean; error?: string }) => void,
  ) {
    // 영구 옵저버가 중복 푸시하지 않도록 플래그 켜둠 (hub HTTP 스트림이 이미 폰에 쏘고 있음)
    this.isHandlingExternal = true
    const observer = this.host.addExternalObserver((msg) => {
      if (msg.type === 'streamChunk') send(msg.text)
      else if (msg.type === 'approvalRequested') send(this._formatApproval(msg))
      else if (msg.type === 'streamEnd') end({ ok: true })
      else if (msg.type === 'streamError') end({ ok: false, error: msg.error })
    })
    try {
      await this.host.sendFromExternal(text)
      end({ ok: true })
    } catch (err) {
      end({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      observer.dispose()
      this.isHandlingExternal = false
    }
  }

  private _onWorkerSetMode(kind: 'permission' | 'override', value: string) {
    if (kind === 'permission') this.host.setPermissionMode(value as PermissionMode)
    else this.host.setOverrideMode(value as OverrideMode)
  }

  // ── 데스크톱 대화 → 폰 동기화 ──────────────────────────────────

  private _isCurrentTarget(): boolean {
    const currentId = readTarget()
    return currentId === this.id
  }

  private _onPersistentEvent(msg: any) {
    // 폰 초기 대화 처리 중(activeStream 있거나 worker가 hub HTTP 요청 처리 중)에는 푸시하지 않음 — 중복 방지
    if (this.activeStream || this.isHandlingExternal) return
    // DM 모드에선 target일 때만 푸시 (단일 채팅 노이즈 방지), topics 모드는 각자 자기 topic에 가니까 조건 불필요
    if (!this.useTopics && !this._isCurrentTarget()) return
    if (!this.sendClient) return

    if (msg.type === 'userMessage' && msg.message?.role === 'user') {
      this.desktopSync = { user: String(msg.message.content ?? ''), buffer: '' }
    } else if (msg.type === 'routingDecision' && this.desktopSync) {
      this.desktopSync.modelLabel = `${msg.decision.model} · ${msg.decision.effort}`
    } else if (msg.type === 'streamChunk' && this.desktopSync) {
      this.desktopSync.buffer += msg.text
    } else if (msg.type === 'streamEnd' && this.desktopSync) {
      const { user, buffer, modelLabel } = this.desktopSync
      this.desktopSync = undefined
      // 유저 질문 + AI 답변을 폰으로 푸시
      const userPart = user.length > 300 ? user.slice(0, 300) + '...' : user
      const aiPart = buffer.length > TG_MAX - userPart.length - 200
        ? buffer.slice(0, TG_MAX - userPart.length - 200) + '\n\n...(잘림)'
        : buffer
      const label = modelLabel ? ` · ${modelLabel}` : ''
      const text = `💻 ${this.workspaceName}${label}\n\n👤 ${userPart}\n\n🤖 ${aiPart || '(빈 응답)'}`
      // topics 모드면 자기 topic으로, 아니면 DM으로
      const threadOpt = this._ownThreadOpt()
      void this.sendClient.sendMessage(this.chatId, text, threadOpt).catch(() => undefined)
    } else if (msg.type === 'streamError' && this.desktopSync) {
      const { user } = this.desktopSync
      this.desktopSync = undefined
      const threadOpt = this._ownThreadOpt()
      void this.sendClient.sendMessage(
        this.chatId,
        `💻 ${this.workspaceName}\n\n👤 ${user.slice(0, 300)}\n\n❌ ${msg.error}`,
        threadOpt,
      ).catch(() => undefined)
    }
  }

  // 이 워크스페이스의 topic thread 옵션 (topics 모드 꺼져있으면 undefined)
  private _ownThreadOpt(): { message_thread_id?: number } | undefined {
    if (!this.useTopics) return undefined
    const topicMap = readTopics()
    const id = topicMap[this._topicKey()]
    return id ? { message_thread_id: id } : undefined
  }

  // ── 스트림 편집 헬퍼 ───────────────────────────────────────────

  private _header(stream?: ActiveStream): string {
    const s = stream ?? this.activeStream
    if (!s) return ''
    const parts: string[] = []
    if (s.targetName) parts.push(`🎯 ${s.targetName}`)
    if (s.modelLabel) parts.push(s.modelLabel)
    return parts.join(' · ') + '\n\n'
  }

  private _formatApproval(msg: any): string {
    const lines = [
      '승인 필요',
      msg.title ? String(msg.title) : '',
      msg.detail ? String(msg.detail) : '',
      '',
      '승인: /approve',
      '거절: /reject',
    ].filter(Boolean)
    return lines.join('\n')
  }

  private async _editStream(text: string) {
    if (!this.activeStream || !this.client) return
    await this.client.editMessageText(this.chatId, this.activeStream.messageId, text || '(empty)').catch(() => undefined)
  }

  // 현재 placeholder가 보여주는 영역 (chunkStart부터). TG_MAX 한도 도달하면 새 placeholder로 rolling.
  private _maybeEdit() {
    if (!this.activeStream || !this.client) return
    const stream = this.activeStream
    const tail = stream.buffer.slice(stream.chunkStart)
    const header = this._header(stream)
    const limit = TG_MAX - header.length - 100  // 100 buffer for "...(이어짐 ↓)" 등

    // 현재 placeholder 한도 도달 → 마무리 + 새 placeholder
    if (tail.length > limit && !stream.rolling) {
      stream.rolling = true
      void this._rollNewPlaceholder(stream, header, limit).finally(() => {
        if (this.activeStream === stream) stream.rolling = false
      })
      return
    }

    if (stream.rolling) return  // rolling 중엔 update 스킵 (race 방지)
    const now = Date.now()
    if (now - stream.lastEdit < EDIT_INTERVAL_MS) return
    stream.lastEdit = now
    void this._editStream(header + tail)
  }

  // 현재 placeholder를 첫 part로 마무리 + 새 placeholder send + chunkStart 갱신
  private async _rollNewPlaceholder(stream: ActiveStream, header: string, limit: number) {
    if (!this.client) return
    const tail = stream.buffer.slice(stream.chunkStart)
    const splitAt = (() => {
      const tryNL = tail.lastIndexOf('\n', limit)
      return tryNL > limit - 500 ? tryNL : limit
    })()
    const firstPart = tail.slice(0, splitAt)
    try {
      await this.client.editMessageText(
        this.chatId, stream.messageId,
        header + firstPart + '\n\n…(이어짐 ↓)',
      )
    } catch {}
    try {
      const next = await this.client.sendMessage(this.chatId, '⏳ ...', stream.threadOpt)
      stream.messageId = next.message_id
      stream.chunkStart += firstPart.length
      stream.lastEdit = 0  // 새 placeholder 즉시 update 가능
    } catch (err) {
      log.warn('telegram', 'rolling new placeholder failed:', err)
    }
  }

  private _finalize(): string {
    if (!this.activeStream) return ''
    const header = this._header()
    const body = this.activeStream.buffer
    const limit = TG_MAX - header.length - 60
    const text = body.length > limit
      ? body.slice(0, limit) + '\n\n...(잘림 · VSCode에서 전체 확인)'
      : body
    return header + (text || '(빈 응답)')
  }

  // 긴 응답 마무리: rolling 동안 chunkStart까지는 이미 placeholder로 보냈음.
  // 현재 placeholder에 chunkStart부터 끝까지 채우고, 한도 넘으면 추가 메시지로 분할.
  private async _finalizeAndSplit(stream: ActiveStream, threadOpt?: { message_thread_id?: number }) {
    if (!this.client) return
    const header = this._header(stream)
    const remaining = stream.buffer.slice(stream.chunkStart)
    const limit = TG_MAX - header.length - 60

    if (remaining.length <= limit) {
      // 한 placeholder에 다 들어감
      const text = header + (remaining || '(빈 응답)')
      await this.client.editMessageText(this.chatId, stream.messageId, text).catch(() => undefined)
      return
    }

    // 첫 part: 현재 placeholder edit
    const firstPart = remaining.slice(0, limit)
    await this.client.editMessageText(
      this.chatId, stream.messageId,
      header + firstPart + '\n\n…(이어짐 ↓)',
    ).catch(() => undefined)

    // 나머지: 새 메시지로 분할
    let rest = remaining.slice(limit)
    let partNum = 2
    while (rest.length > 0) {
      const chunkLimit = TG_MAX - 60
      let splitAt = rest.length <= chunkLimit ? rest.length :
        Math.max(rest.lastIndexOf('\n', chunkLimit), chunkLimit - 500) > chunkLimit - 500
          ? rest.lastIndexOf('\n', chunkLimit) : chunkLimit
      if (splitAt <= 0) splitAt = Math.min(chunkLimit, rest.length)
      const part = rest.slice(0, splitAt)
      rest = rest.slice(splitAt).trimStart()
      const tag = rest.length > 0 ? `(part ${partNum} ↓)` : `(part ${partNum} · 끝)`
      try {
        await this.client.sendMessage(this.chatId, `${tag}\n\n${part}`, threadOpt)
      } catch {}
      partNum++
    }
  }

  // 4096 자 넘는 메시지를 여러 통으로 쪼개서 보냄 (Telegram 제한)
  private async _sendLongMessage(text: string, threadId?: number) {
    if (!this.client) return
    const parts: string[] = []
    let remaining = text
    while (remaining.length > 0) {
      if (remaining.length <= TG_MAX) { parts.push(remaining); break }
      let splitAt = remaining.lastIndexOf('\n', TG_MAX)
      if (splitAt < TG_MAX - 500) splitAt = TG_MAX
      parts.push(remaining.slice(0, splitAt))
      remaining = remaining.slice(splitAt).trimStart()
    }
    const threadOpt = threadId != null ? { message_thread_id: threadId } : undefined
    for (const p of parts) {
      await this.client.sendMessage(this.chatId, p, threadOpt).catch(() => undefined)
    }
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.hubCheckTimer) clearInterval(this.hubCheckTimer)
    this.activeStream?.observer.dispose()
    this.activeStream = undefined
    this.persistentObserver?.dispose()
    this.persistentObserver = undefined
    this.client?.stopPolling()
    removeInstance(this.id)
    await this.server.stop()
  }
}

// ── 바이브코딩 가이드 텍스트 (폰에서 참고용) ──────────────────────

const VIBE_GUIDE = `🎨 바이브코딩 가이드 (초보 → 고급)

바이브코딩이란 "AI에게 느낌·목적 중심으로 지시해서 빠르게 결과 뽑는 코딩 스타일"입니다.

━━━━━━━━━━━━━━━━━━━━

📌 기본 원칙 3가지

1️⃣ 결과물 이미지 먼저
"버튼 하나 있는데 누르면 토스트 뜨는 페이지" → AI가 뼈대 즉시 생성
"어떻게 짜야 할지 모르겠어"는 피하고 "뭘 원하는지"만 명확히.

2️⃣ 스택은 명시
"Next.js 14 App Router + Tailwind + MDX"
숫자 버전까지 찍으면 구버전 코드 안 뽑힘.

3️⃣ 맥락은 1줄로
"블로그인데 글이 10개쯤 있고, 검색 필요 없음"
범위를 좁게 알려주면 오버엔지니어링 방지.

━━━━━━━━━━━━━━━━━━━━

🎯 모드 선택 가이드

• /plan — 큰 작업 시작 전 (AI가 docs/plans/*.md로 계획서 먼저)
• /ask — 실수 무서울 때 (AI가 diff 보여주고 확인받고 수정)
• /auto — 빠르게 진행 (기본, 알아서 수정)
• /team — 복잡한 기능 (Claude 설계 → Codex 구현 → Gemini 리뷰)
• /argue — 설계 결정 애매할 때 (셋이 서로 다른 관점으로 토론)

━━━━━━━━━━━━━━━━━━━━

💡 언제 어떤 모델?

• @claude — 아키텍처, 리팩토링, 디버깅, 코드리뷰
• @codex — 빠른 구현, CLI 스크립트, 보일러플레이트
• @gemini — 긴 문서·코드베이스 전체 분석, 요약, 이미지

자동 라우팅이 기본이라 보통 신경 안 써도 됨. 원하는 거 명시하고 싶을 때만 이름 부르세요.

━━━━━━━━━━━━━━━━━━━━

/examples — 실전 프롬프트 예시
/cheatsheet — 한 장 정리`

const VIBE_EXAMPLES = `💬 바이브코딩 프롬프트 예시

━━━━━━━━━━━━━━━━━━━━

🚀 새 프로젝트 뼈대

❌ 나쁜 예: "웹사이트 만들어줘"
✅ 좋은 예:
"Next.js 14 App Router + TypeScript + Tailwind로 개인 블로그 뼈대.
/, /posts/[slug], RSS 피드.
글은 일단 하드코딩 배열, 나중에 DB 연결 예정.
README에 실행법 적어줘."

━━━━━━━━━━━━━━━━━━━━

🐛 버그 고치기

❌ "이거 에러 나"
✅ "src/api/user.ts:42 에서 'undefined의 length 읽을 수 없음' 에러.
req.body.items 가 비었을 때 같아. 빈 배열 케이스 처리해줘."

에러 메시지 + 어디서 + 의심되는 원인 이 세트면 정확도 90%.

━━━━━━━━━━━━━━━━━━━━

♻ 리팩토링

❌ "코드 정리해줘"
✅ "/plan src/utils/auth.ts 리팩토링해줘.
함수 10개가 한 파일에 있는데 로그인/세션/토큰 3개 테마로 분리하고 싶어.
순환 의존성 안 생기게."

/plan 모드로 시작 → 계획서 확인 → 좋으면 실행 요청.

━━━━━━━━━━━━━━━━━━━━

✨ 기능 추가

❌ "검색 기능 만들어"
✅ "게시글에 검색창 추가.
입력하면 제목·본문에서 부분일치, 디바운스 300ms.
서버에 부담 가기 싫으니 클라이언트에서 필터링.
글 100개 이하 전제."

━━━━━━━━━━━━━━━━━━━━

🎨 디자인 수정

❌ "이쁘게 바꿔"
✅ "랜딩 페이지 히어로 섹션을 좀 더 모던하게.
레퍼런스: Vercel 랜딩 스타일.
큰 헤드라인 + 옅은 그라데이션 배경 + 가운데 정렬 CTA 버튼 하나.
Tailwind 유지, 새 라이브러리 안 씀."

━━━━━━━━━━━━━━━━━━━━

📖 이해하고 싶을 때

"이 파일 왜 이렇게 짜여있어?"
→ @claude 가 좋음. 구조·의도 설명 잘함.

"이 에러 메시지 무슨 뜻?"
→ @codex 도 충분. 빠르고 실무적.

━━━━━━━━━━━━━━━━━━━━

🏗 진짜 큰 작업

"/team 결제 모듈 붙여줘. Stripe Checkout Session, 성공/취소 페이지, webhook으로 주문 상태 업데이트."
→ Claude가 설계 → Codex가 구현 → Gemini가 리뷰. 한 방.

━━━━━━━━━━━━━━━━━━━━

/cheatsheet — 요약판`

const VIBE_CHEATSHEET = `📋 OrchestrAI 치트시트

【 3 줄 공식 】
1. 뭘 만들지 (결과 이미지)
2. 스택 (버전까지)
3. 제약 (범위·규모)

【 모드 】
/plan — 작업 전 계획서
/ask — 수정 전 확인
/auto — 빠른 실행 (기본)
/team — Claude 설계→Codex 구현→Gemini 리뷰
/argue — 의견 충돌 시 토론

【 모델 】
@claude — 설계·디버깅·리뷰
@codex — 빠른 구현·CLI
@gemini — 긴 문서·이미지·요약

【 창 관리 】
/list — 창 목록
/use <이름> — 전환
/pwd — 현재 경로

【 프롬프트 패턴 】
"<스택>으로 <기능> 구현. <제약조건>. <참고 레퍼런스>."

【 실수 피하기 】
• 큰 작업엔 /plan 먼저
• 기존 코드 만질 땐 "먼저 읽고 수정" 명시
• 불확실하면 @claude 로 설명 요청
• 파일 복구는 VSCode 채팅의 rollback 버튼

/vibe — 풀 가이드
/examples — 프롬프트 예시`
