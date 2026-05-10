// src/telegram/client.ts
// Telegram Bot API 클라이언트. node-telegram-bot-api 안 쓰고 fetch만 사용 (VSCode extension 번들 최소화).

import { log } from '../util/log'

export interface TgChat {
  id: number | string
  type?: string
}

export interface TgFrom {
  id?: number
  first_name?: string
  username?: string
}

export interface TgFile {
  file_id: string
  file_unique_id: string
  file_size?: number
  // 종류별 추가 메타
  width?: number          // photo
  height?: number
  duration?: number       // voice/audio/video
  mime_type?: string      // document/audio/video
  file_name?: string      // document
}

export interface TgMessage {
  message_id: number
  message_thread_id?: number   // forum topic id (그룹 채팅에서 주제별 분리 시)
  chat: TgChat
  from?: TgFrom
  text?: string
  caption?: string             // photo/video 의 캡션
  date: number
  // 첨부 파일 — 한 메시지에 하나만
  photo?: TgFile[]             // 여러 해상도. 보통 마지막 (가장 큰 거) 사용
  document?: TgFile
  voice?: TgFile
  audio?: TgFile
  video?: TgFile
}

export interface TgSendResult {
  message_id: number
  chat: TgChat
  date: number
}

export class TelegramClient {
  private offset = 0
  private polling = false
  private pollAbort?: AbortController

  constructor(private token: string) {}

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`
  }

  async getMe(): Promise<{ id: number; username?: string; first_name?: string }> {
    const res = await fetch(this.url('getMe'))
    const data = await res.json() as any
    if (!data.ok) throw new Error(`Telegram getMe failed: ${data.description}`)
    return data.result
  }

  // file_id → 다운로드 URL → 실제 바이트
  async downloadFile(fileId: string): Promise<{ buffer: Buffer; mime?: string; size?: number }> {
    const r1 = await fetch(this.url('getFile') + `?file_id=${encodeURIComponent(fileId)}`)
    const data1 = await r1.json() as any
    if (!data1.ok) throw new Error(`Telegram getFile failed: ${data1.description}`)
    const filePath = data1.result?.file_path
    if (!filePath) throw new Error('Telegram getFile: file_path 없음')
    const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`
    const r2 = await fetch(downloadUrl)
    if (!r2.ok) throw new Error(`Telegram file download failed: ${r2.status}`)
    const arrayBuffer = await r2.arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuffer),
      mime: r2.headers.get('content-type') ?? undefined,
      size: arrayBuffer.byteLength,
    }
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    opts?: { parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML'; message_thread_id?: number },
  ): Promise<TgSendResult> {
    const res = await fetch(this.url('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4096),
        parse_mode: opts?.parse_mode,
        message_thread_id: opts?.message_thread_id,
      }),
    })
    const data = await res.json() as any
    if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`)
    return data.result
  }

  async editMessageText(
    chatId: string | number,
    messageId: number,
    text: string,
    opts?: { parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML' },
  ): Promise<boolean> {
    try {
      const res = await fetch(this.url('editMessageText'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: text.slice(0, 4096),
          parse_mode: opts?.parse_mode,
        }),
      })
      const data = await res.json() as any
      if (data.ok) return true
      if (data.description?.includes('not modified')) return true
      return false
    } catch {
      return false
    }
  }

  /** 봇 명령어 목록 등록 — Telegram 클라이언트에서 "/" 치면 자동완성으로 뜸 */
  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    try {
      const res = await fetch(this.url('setMyCommands'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands }),
      })
      const data = await res.json() as any
      if (!data.ok) {
        console.warn('[telegram] setMyCommands failed:', data.description)
      }
    } catch (err) {
      console.warn('[telegram] setMyCommands error:', err)
    }
  }

  /** Forum-enabled 그룹에 topic 생성. 반환된 message_thread_id로 이후 sendMessage 호출 시 분리된 스레드로 감. */
  async createForumTopic(
    chatId: string | number,
    name: string,
    opts?: { icon_color?: number; icon_custom_emoji_id?: string },
  ): Promise<{ message_thread_id: number; name: string }> {
    const res = await fetch(this.url('createForumTopic'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        name: name.slice(0, 128),
        icon_color: opts?.icon_color,
        icon_custom_emoji_id: opts?.icon_custom_emoji_id,
      }),
    })
    const data = await res.json() as any
    if (!data.ok) throw new Error(`Telegram createForumTopic failed: ${data.description}`)
    return data.result
  }

  async startPolling(
    onMessage: (msg: TgMessage) => Promise<void>,
    onPersistentConflict?: () => void,
  ) {
    this.polling = true
    let consecutiveErrors = 0
    let consecutive409 = 0
    let last409Logged = 0
    log.info('telegram', 'polling started')
    // long-poll timeout 25초 → 응답 거의 없을 때도 조용히 대기
    while (this.polling) {
      // hard-timeout 35초 — Telegram 25초 long-poll + 여유 10초. 네트워크 hang 방지.
      const hardTimeout = setTimeout(() => {
        try { this.pollAbort?.abort() } catch {}
      }, 35_000)
      try {
        this.pollAbort = new AbortController()
        const res = await fetch(
          this.url('getUpdates') + `?offset=${this.offset}&timeout=25&allowed_updates=${encodeURIComponent('["message"]')}`,
          { signal: this.pollAbort.signal },
        )
        // HTTP status 별 처리
        if (res.status === 409) {
          consecutive409++
          // Conflict: 다른 인스턴스가 같은 봇 토큰으로 polling 중
          const now = Date.now()
          if (now - last409Logged > 10_000) {
            log.warn('telegram', `409 Conflict #${consecutive409} — 다른 곳에서 같은 봇 polling 중`)
            last409Logged = now
          }
          // 3회 연속 409면 자기가 hub 자격 잃었다고 판단 → polling 종료, bridge가 worker 강등 처리 후 다음 _checkHub에서 재경합
          if (consecutive409 >= 3 && onPersistentConflict) {
            log.warn('telegram', 'polling giving up due to persistent 409 — bridge will demote and retry hub claim later')
            this.polling = false
            try { onPersistentConflict() } catch {}
            break
          }
          await new Promise(r => setTimeout(r, 5_000))
          continue
        }
        consecutive409 = 0  // 409 외 응답 받으면 리셋
        if (res.status === 401) {
          log.error('telegram', '401 Unauthorized — 봇 토큰 무효. polling 중단')
          this.polling = false
          break
        }
        if (res.status === 429) {
          // Rate limit — Retry-After 헤더 확인
          const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10)
          log.warn('telegram', `429 Rate limit — ${retryAfter}s 대기`)
          await new Promise(r => setTimeout(r, retryAfter * 1000))
          continue
        }
        if (!res.ok) {
          log.warn('telegram', `getUpdates HTTP ${res.status} — backoff`)
          consecutiveErrors++
          await new Promise(r => setTimeout(r, Math.min(3000 * 2 ** consecutiveErrors, 60_000)))
          continue
        }
        const data = await res.json() as any
        if (data.ok && Array.isArray(data.result)) {
          if (consecutiveErrors > 0) {
            log.info('telegram', `polling recovered (after ${consecutiveErrors} errors)`)
            consecutiveErrors = 0
          }
          for (const update of data.result) {
            this.offset = (update.update_id as number) + 1
            if (update.message) {
              try {
                await onMessage(update.message)
              } catch (err) {
                log.error('telegram', 'handler error:', err)
              }
            }
          }
        } else if (!data.ok) {
          log.warn('telegram', `getUpdates failed: ${data.description ?? 'unknown'}`)
          consecutiveErrors++
          await new Promise(r => setTimeout(r, Math.min(3000 * 2 ** consecutiveErrors, 60_000)))
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // 의도적 stopPolling()이면 break, 아니면 hard-timeout (네트워크 hang) → retry
          if (!this.polling) {
            log.info('telegram', 'polling aborted (stopped intentionally)')
            break
          }
          log.warn('telegram', 'polling hard-timeout (35s) — fetch hang, restarting')
          consecutiveErrors++
          const delay = Math.min(3000 * 2 ** consecutiveErrors, 60_000)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        consecutiveErrors++
        const delay = Math.min(3000 * 2 ** consecutiveErrors, 60_000)
        log.warn('telegram', `polling error (#${consecutiveErrors}, retry in ${delay}ms): ${err?.message ?? err}`)
        await new Promise(r => setTimeout(r, delay))
      } finally {
        clearTimeout(hardTimeout)
      }
    }
    log.info('telegram', `polling ended (polling=${this.polling})`)
  }

  stopPolling() {
    this.polling = false
    this.pollAbort?.abort()
  }
}
