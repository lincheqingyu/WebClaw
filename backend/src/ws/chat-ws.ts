/**
 * WebSocket chat server (深度思考)
 * 支持会话持久化、心跳检测、sessionId 握手
 */

import type http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { createSessionId, type SessionId } from '@webclaw/shared'
import { runMainAgent, runSubAgent } from '../agent/index.js'
import { createVllmModel } from '../agent/vllm-model.js'
import { getConfig } from '../config/index.js'
import type { SessionRegistry } from '../session/index.js'
import type { SessionState } from '../session/index.js'
import { logger } from '../utils/logger.js'
import { chatRequestSchema } from '../types/api.js'

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

function sendEvent(ws: WebSocket, event: string, payload: Record<string, unknown> = {}): void {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify({ event, ...payload }))
}

function toUserAgentMessages(
  messages: readonly { role: string; content: string }[],
): AgentMessage[] {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => ({
      role: 'user' as const,
      content: m.content,
      timestamp: Date.now(),
    }))
}

function extractSystemPrompt(messages: readonly { role: string; content: string }[]): string | undefined {
  const chunks = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content.trim())
    .filter(Boolean)
  return chunks.length > 0 ? chunks.join('\n\n') : undefined
}

function shouldWaitForUserInput(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (normalized.includes('？') || normalized.includes('?')) return true
  if (normalized.includes('请') && (normalized.includes('提供') || normalized.includes('告诉'))) {
    return true
  }
  return false
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
    // 检查超时
    if (Date.now() - meta.lastPongAt > HEARTBEAT_TIMEOUT) {
      logger.info(`心跳超时，关闭连接: ${meta.sessionId}`)
      stopHeartbeat(meta)
      ws.close(4000, '心跳超时')
      return
    }
    // 发送 ping
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

async function executePendingTodos(
  ws: WebSocket,
  state: SessionState,
  model: ReturnType<typeof createVllmModel>,
  apiKey: string,
): Promise<void> {
  while (true) {
    const pending = state.todoManager.getPending()
    if (!pending) break

    const [idx, item] = pending
    state.todoManager.markInProgress(idx)
    sendEvent(ws, 'subagent_start', { todoIndex: idx, content: item.content })

    try {
      const prompt = state.resumeHint
        ? `${item.content}\n\n用户补充信息:\n${state.resumeHint}`
        : item.content
      const result = await runSubAgent({
        description: item.content.slice(0, 50),
        prompt,
        agentType: 'query',
        model,
        apiKey,
      })

      sendEvent(ws, 'subagent_result', { todoIndex: idx, result })

      if (shouldWaitForUserInput(result)) {
        state.isWaiting = true
        sendEvent(ws, 'need_user_input', { prompt: result })
        sendEvent(ws, 'waiting')
        return
      }

      state.todoManager.markCompleted(idx)
      sendEvent(ws, 'todo_update', {
        todoIndex: idx,
        status: 'completed',
        summary: result.slice(0, 200),
      })
    } catch (error) {
      state.todoManager.markCompleted(idx)
      sendEvent(ws, 'subagent_error', {
        todoIndex: idx,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

async function runDeepMode(
  ws: WebSocket,
  state: SessionState,
  payload: z.infer<typeof chatRequestSchema>,
  registry: SessionRegistry,
): Promise<void> {
  if (state.isRunning) {
    sendEvent(ws, 'error', { message: '当前会话正在运行，请稍后再试。' })
    return
  }

  state.isRunning = true
  state.isWaiting = false
  state.resumeHint = undefined

  const config = getConfig()
  const { messages, model: modelId, baseUrl, apiKey: reqApiKey, options } = payload
  const piModel = createVllmModel({
    modelId,
    baseUrl,
    maxTokens: options?.maxTokens,
  })
  const apiKey = reqApiKey ?? config.LLM_API_KEY

  const agentMessages = toUserAgentMessages(messages)
  const extraSystemPrompt = extractSystemPrompt(messages)
  let hasPendingTodos = false

  try {
    const result = await runMainAgent({
      messages: agentMessages,
      contextMessages: state.contextMessages,
      model: piModel,
      apiKey,
      temperature: options?.temperature,
      extraSystemPrompt,
      autoRunTodos: false,
      todoManager: state.todoManager,
      turnState: { counter: state.memoryTurnCounter },
      onEvent: (event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          const delta = event.assistantMessageEvent.delta
          if (delta) {
            sendEvent(ws, 'message_delta', { content: delta })
          }
        }
        if (event.type === 'tool_execution_end' && event.toolName === 'todo_write' && !event.isError) {
          const rendered = Array.isArray(event.result?.content)
            ? event.result.content.map((c: { text?: string }) => c.text).filter(Boolean).join('\n')
            : ''
          sendEvent(ws, 'todo_write', { content: rendered })
          const details = event.result?.details as { hasPending?: boolean } | undefined
          if (details?.hasPending) {
            hasPendingTodos = true
          }
        }
      },
    })

    state.contextMessages = result.messages
    sendEvent(ws, 'message_end')

    if (hasPendingTodos) {
      await executePendingTodos(ws, state, piModel, apiKey)
    }

    if (!state.isWaiting) {
      sendEvent(ws, 'done')
    }
  } catch (error) {
    sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    state.isRunning = false
    // 每轮结束后持久化
    registry.persist(state.sessionId)
  }
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

    // state 已确定非 null，后续闭包中使用 sessionState 避免非空断言
    const sessionState: SessionState = state

    // 启动心跳
    const meta: ConnectionMeta = {
      sessionId,
      lastPongAt: Date.now(),
      heartbeatTimer: null,
    }
    startHeartbeat(ws, meta)

    // 如果是恢复的会话，通知客户端
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
        const parsed = JSON.parse(raw) as Record<string, unknown>

        // 处理心跳 pong
        if (parsed.event === 'pong') {
          meta.lastPongAt = Date.now()
          return
        }

        // 解析聊天请求
        const chatParsed = chatRequestSchema.safeParse(parsed)
        if (!chatParsed.success) {
          sendEvent(ws, 'error', { message: chatParsed.error.issues.map((i) => i.message).join('; ') })
          return
        }

        // 更新活跃时间
        registry.touch(sessionId)
        sessionState.mode = chatParsed.data.mode

        if (sessionState.mode === 'simple') {
          sendEvent(ws, 'error', { message: 'WS 仅支持"thinking"模式，请改用 HTTP simple。' })
          return
        }

        if (sessionState.isWaiting) {
          const userText = chatParsed.data.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .join('\n')
          sessionState.resumeHint = userText || undefined
          sessionState.isWaiting = false
          sessionState.isRunning = true
          try {
            const config = getConfig()
            const apiKey = chatParsed.data.apiKey ?? sessionState.apiKey ?? config.LLM_API_KEY
            const piModel = createVllmModel({
              modelId: chatParsed.data.model,
              baseUrl: chatParsed.data.baseUrl,
              maxTokens: chatParsed.data.options?.maxTokens,
            })
            await executePendingTodos(ws, sessionState, piModel, apiKey)
            if (!sessionState.isWaiting) sendEvent(ws, 'done')
          } catch (error) {
            sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
          } finally {
            sessionState.isRunning = false
            registry.persist(sessionId)
          }
          return
        }

        await runDeepMode(ws, sessionState, chatParsed.data, registry)
      } catch (error) {
        logger.error('WS 处理消息失败:', error)
        sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
      }
    })

    ws.on('close', () => {
      stopHeartbeat(meta)
      // 断线时持久化而非清空，支持重连恢复
      sessionState.isRunning = false
      sessionState.isWaiting = false
      registry.persist(sessionId)
      logger.info(`WS 连接关闭: ${sessionId}`)
    })
  })

  return wss
}
