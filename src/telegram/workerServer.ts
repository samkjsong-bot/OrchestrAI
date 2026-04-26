// src/telegram/workerServer.ts
// 각 OrchestrAI 창이 여는 로컬 HTTP 서버.
// Hub(Telegram polling하는 창)이 POST /chat 으로 메시지 보내면 이 창이 자기 워크스페이스에서 처리하고 SSE로 스트리밍.

import * as http from 'http'
import { log } from '../util/log'

export interface WorkerHandlers {
  /** Hub가 채팅 메시지 보냄. chunk 단위로 send(), 끝나면 end() 호출 */
  onChat: (
    text: string,
    send: (chunk: string) => void,
    end: (info: { ok: boolean; error?: string }) => void,
  ) => Promise<void>
  /** Hub가 대상 워크스페이스의 permission/override 모드를 원격으로 바꿀 때 */
  onSetMode: (kind: 'permission' | 'override', value: string) => void
  onResolveApproval: (approved: boolean) => boolean
}

export class WorkerServer {
  private server?: http.Server
  private port = 0

  async start(handlers: WorkerHandlers): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = req.url ?? ''
        const method = req.method ?? 'GET'

        // CORS 필요 없음 — localhost only
        if (method === 'GET' && url === '/ping') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, port: this.port }))
          return
        }

        if (method === 'POST' && url === '/chat') {
          this._handleChat(req, res, handlers.onChat)
          return
        }

        if (method === 'POST' && url === '/mode') {
          this._handleMode(req, res, handlers.onSetMode)
          return
        }

        if (method === 'POST' && url === '/approval') {
          this._handleApproval(req, res, handlers.onResolveApproval)
          return
        }

        res.writeHead(404)
        res.end()
      })

      // 포트 0 = OS가 자동 선택
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          this.server = server
          log.info('worker-server', `listening on 127.0.0.1:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('failed to get server port'))
        }
      })
      server.on('error', reject)
    })
  }

  private _handleChat(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onChat: WorkerHandlers['onChat'],
  ) {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body)
        if (typeof text !== 'string') {
          res.writeHead(400)
          res.end('text required')
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        const send = (chunk: string) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
          }
        }
        const end = (info: { ok: boolean; error?: string }) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ done: true, ...info })}\n\n`)
            res.end()
          }
        }

        await onChat(text, send, end)
      } catch (err) {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ done: true, ok: false, error: String(err) })}\n\n`)
          res.end()
        }
      }
    })
  }

  private _handleMode(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onSetMode: WorkerHandlers['onSetMode'],
  ) {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { kind, value } = JSON.parse(body)
        if (kind !== 'permission' && kind !== 'override') {
          res.writeHead(400)
          res.end('bad kind')
          return
        }
        onSetMode(kind, String(value))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (err) {
        res.writeHead(400)
        res.end(String(err))
      }
    })
  }

  private _handleApproval(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onResolveApproval: WorkerHandlers['onResolveApproval'],
  ) {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { approved } = JSON.parse(body)
        if (typeof approved !== 'boolean') {
          res.writeHead(400)
          res.end('approved boolean required')
          return
        }
        const ok = onResolveApproval(approved)
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok }))
      } catch (err) {
        res.writeHead(400)
        res.end(String(err))
      }
    })
  }

  async stop() {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = undefined
  }

  get currentPort(): number {
    return this.port
  }
}
