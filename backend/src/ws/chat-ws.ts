/**
 * WebSocket chat server
 * 统一 simple/plan 模式
 */

import type http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import { createSessionId, type SessionId } from '@webclaw/shared'
import type { SessionRegistry, SessionState } from '../session/index.js'
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
  sessionId: SessionId
  lastPongAt: number
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

/** 从 URL query 解析 sessionId */
function parseSessionId(reqUrl: string | undefined): SessionId {
  if (!reqUrl) return createSessionId()
  try {
    const url = new URL(reqUrl, 'http://localhost')
    const id = url.searchParams.get('sessionId')
    return id ? createSessionId(id) : createSessionId()
  } catch {
    return createSessionId()
  }
}

/** 启动心跳定时器 */
function startHeartbeat(ws: WebSocket, meta: ConnectionMeta): void {
  meta.heartbeatTimer = setInterval(() => {
    if (Date.now() - meta.lastPongAt > HEARTBEAT_TIMEOUT) {
      logger.info(`心跳超时，关闭连接: ${meta.sessionId}`)
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

export function initChatWebSocketServer(server: http.Server, registry: SessionRegistry): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/api/v1/chat/ws' })

  wss.on('connection', async (ws, req) => {
    const sessionId = parseSessionId(req.url)

    // 尝试从 registry 恢复会话（内存 → 磁盘）
    let state = registry.get(sessionId) ?? (await registry.restore(sessionId))
    if (!state) {
      state = registry.getOrCreate(sessionId)
    }
    registry.set(sessionId, state)

    const sessionState: SessionState = state

    const meta: ConnectionMeta = {
      sessionId,
      lastPongAt: Date.now(),
      heartbeatTimer: null,
    }
    startHeartbeat(ws, meta)

    if (sessionState.contextMessages.length > 0) {
      sendEvent(ws, 'session_restored', {
        sessionId,
        messageCount: sessionState.contextMessages.length,
      })
    }

    logger.info(`WS 连接建立: ${sessionId} (消息数: ${sessionState.contextMessages.length})`)

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
          sessionState.abortController?.abort()
          sessionState.isRunning = false
          sessionState.isWaiting = false
          sessionState.resumeHint = undefined
          sessionState.waitingTodoIndex = undefined
          sendEvent(ws, 'error', { message: '已取消当前执行' })
          sendEvent(ws, 'done')
          registry.persist(sessionId)
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

        logger.info('收到 WS chat 请求', {
          sessionId,
          mode: chatParsed.data.mode,
          model: chatParsed.data.model ?? 'default',
          baseUrl: chatParsed.data.baseUrl ?? 'default',
          apiKey: maskApiKey(chatParsed.data.apiKey),
          enableTools: chatParsed.data.enableTools ?? false,
          options: chatParsed.data.options ?? {},
          messages: summarizeMessages(chatParsed.data.messages),
        })

        registry.touch(sessionId)
        sessionState.mode = chatParsed.data.mode

        if (sessionState.isWaiting && sessionState.mode !== 'plan') {
          sendEvent(ws, 'error', { message: '当前计划正在等待补充信息，请继续使用 plan 模式' })
          return
        }

        if (sessionState.isWaiting) {
          const userText = chatParsed.data.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .join('\n')
          sessionState.resumeHint = userText || undefined
          await resumePlanChat(ws, sessionState, chatParsed.data, registry)
          return
        }

        if (sessionState.mode === 'simple') {
          await handleSimpleChat(ws, sessionState, chatParsed.data, registry)
          return
        }

        await handlePlanChat(ws, sessionState, chatParsed.data, registry)
      } catch (error) {
        logger.error('WS 处理消息失败:', error)
        sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
      }
    })

    ws.on('close', () => {
      stopHeartbeat(meta)
      sessionState.isRunning = false
      sessionState.isWaiting = false
      registry.persist(sessionId)
      logger.info(`WS 连接关闭: ${sessionId}`)
    })
  })

  return wss
}
