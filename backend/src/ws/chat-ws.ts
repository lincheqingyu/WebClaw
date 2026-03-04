/**
 * WebSocket chat server
 * 统一 simple/plan 模式
 */

import type http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import type { SessionService } from '../session-v2/index.js'
import type { SessionRuntimeState } from '../session-v2/index.js'
import { logger } from '../utils/logger.js'
import { chatRequestSchema } from '../types/api.js'
import { sendEvent } from './event-sender.js'
import { handleSimpleChat } from './simple-handler.js'
import { handlePlanChat, resumePlanChat } from './plan-handler.js'

/** 心跳间隔 30 秒 */
const HEARTBEAT_INTERVAL = 30_000

/** 心跳超时 60 秒 */
const HEARTBEAT_TIMEOUT = 60_000

/** 每个 WS 连接的元信息 */
interface ConnectionMeta {
  sessionKey?: string
  state?: SessionRuntimeState
  lastPongAt: number
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

/** 启动心跳定时器 */
function startHeartbeat(ws: WebSocket, meta: ConnectionMeta): void {
  meta.heartbeatTimer = setInterval(() => {
    if (Date.now() - meta.lastPongAt > HEARTBEAT_TIMEOUT) {
      logger.info(`心跳超时，关闭连接: ${meta.sessionKey ?? 'unknown'}`)
      stopHeartbeat(meta)
      ws.close(4000, '心跳超时')
      return
    }
    sendEvent(ws, 'ping', { timestamp: Date.now() })
  }, HEARTBEAT_INTERVAL)
}

/** 停止心跳定时器 */
function stopHeartbeat(meta: ConnectionMeta): void {
  if (meta.heartbeatTimer) {
    clearInterval(meta.heartbeatTimer)
    meta.heartbeatTimer = null
  }
}

const wsEnvelopeSchema = z.object({
  event: z.string(),
  payload: z.record(z.unknown()).optional(),
})

function maskApiKey(value?: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.length <= 8 ? `${value.slice(0, 2)}****` : `${value.slice(0, 6)}****`
}

function summarizeMessages(messages: Array<{ role: string; content: string }>): string[] {
  return messages.map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
}

export function initChatWebSocketServer(server: http.Server, sessionService: SessionService): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/api/v1/chat/ws' })

  wss.on('connection', async (ws) => {
    const meta: ConnectionMeta = {
      sessionKey: undefined,
      state: undefined,
      lastPongAt: Date.now(),
      heartbeatTimer: null,
    }
    startHeartbeat(ws, meta)

    ws.on('message', async (data) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString()
        const parsed = wsEnvelopeSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) {
          sendEvent(ws, 'error', { message: 'WS 消息格式错误' })
          return
        }

        const { event, payload } = parsed.data

        if (event === 'pong') {
          meta.lastPongAt = Date.now()
          return
        }

        if (event === 'cancel') {
          meta.state?.abortController?.abort()
          if (meta.state) {
            meta.state.isRunning = false
            meta.state.isWaiting = false
            meta.state.resumeHint = undefined
            meta.state.waitingTodoIndex = undefined
            await sessionService.persistState(meta.state)
          }
          sendEvent(ws, 'error', { message: '已取消当前执行' })
          sendEvent(ws, 'done')
          return
        }

        if (event !== 'chat') {
          sendEvent(ws, 'error', { message: `未知事件: ${event}` })
          return
        }

        const chatParsed = chatRequestSchema.safeParse(payload ?? {})
        if (!chatParsed.success) {
          sendEvent(ws, 'error', { message: chatParsed.error.issues.map((i) => i.message).join('; ') })
          return
        }

        const active = await sessionService.resolveActiveSession(chatParsed.data.route)
        meta.sessionKey = active.entry.key
        meta.state = active.state

        sessionService.setNotifier(active.entry.key, (evt, body) => sendEvent(ws, evt, body))

        sendEvent(ws, 'session_key_resolved', {
          sessionKey: active.entry.key,
          sessionId: active.entry.sessionId,
          kind: active.entry.kind,
          channel: active.entry.channel,
        })

        if (active.restored && active.state.contextMessages.length > 0) {
          sendEvent(ws, 'session_restored', {
            sessionId: active.state.sessionId,
            messageCount: active.state.contextMessages.length,
          })
        }

        logger.info('收到 WS chat 请求', {
          sessionKey: active.entry.key,
          mode: chatParsed.data.mode,
          model: chatParsed.data.model ?? 'default',
          baseUrl: chatParsed.data.baseUrl ?? 'default',
          apiKey: maskApiKey(chatParsed.data.apiKey),
          enableTools: chatParsed.data.enableTools ?? false,
          options: chatParsed.data.options ?? {},
          messages: summarizeMessages(chatParsed.data.messages),
        })

        active.state.mode = chatParsed.data.mode

        if (active.state.isWaiting && active.state.mode !== 'plan') {
          sendEvent(ws, 'error', { message: '当前计划正在等待补充信息，请继续使用 plan 模式' })
          return
        }

        if (active.state.isWaiting) {
          const userText = chatParsed.data.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .join('\n')
          active.state.resumeHint = userText || undefined
          await resumePlanChat(ws, active.state, chatParsed.data, sessionService)
          return
        }

        if (active.state.mode === 'simple') {
          await handleSimpleChat(ws, active.state, chatParsed.data, sessionService)
          return
        }

        await handlePlanChat(ws, active.state, chatParsed.data, sessionService)
      } catch (error) {
        logger.error('WS 处理消息失败:', error)
        sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
      }
    })

    ws.on('close', async () => {
      stopHeartbeat(meta)
      if (meta.sessionKey) {
        sessionService.clearNotifier(meta.sessionKey)
      }
      if (meta.state) {
        meta.state.isRunning = false
        meta.state.isWaiting = false
        await sessionService.persistState(meta.state)
      }
      logger.info(`WS 连接关闭: ${meta.sessionKey ?? 'unknown'}`)
    })
  })

  return wss
}
