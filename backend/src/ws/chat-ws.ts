/**
 * WebSocket chat server (深度思考)
 */

import type http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { runMainAgent, runSubAgent } from '../agent/index.js'
import { createVllmModel } from '../agent/vllm-model.js'
import { getConfig } from '../config/index.js'
import { TODO, type TodoItem } from '../core/todo/todo-manager.js'
import { logger } from '../utils/logger.js'
import {chatRequestSchema} from '../types/api.js'

type Mode = 'simple' | 'thinking'

interface SessionState {
  mode: Mode
  contextMessages: AgentMessage[]
  modelId?: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
  isRunning: boolean
  isWaiting: boolean
  resumeHint?: string
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

function shouldWaitForUserInput(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (normalized.includes('？') || normalized.includes('?')) return true
  if (normalized.includes('请') && (normalized.includes('提供') || normalized.includes('告诉'))) {
    return true
  }
  return false
}

async function executePendingTodos(
  ws: WebSocket,
  state: SessionState,
  model: ReturnType<typeof createVllmModel>,
  apiKey: string,
): Promise<void> {
  while (true) {
    const pending = TODO.getPending()
    if (!pending) break

    const [idx, item] = pending
    TODO.markInProgress(idx)
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

      TODO.markCompleted(idx)
      sendEvent(ws, 'todo_update', {
        todoIndex: idx,
        status: 'completed',
        summary: result.slice(0, 200),
      })
    } catch (error) {
      TODO.markCompleted(idx)
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
  let hasPendingTodos = false

  try {
    const result = await runMainAgent({
      messages: agentMessages,
      contextMessages: state.contextMessages,
      model: piModel,
      apiKey,
      temperature: options?.temperature,
      autoRunTodos: false,
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
  }
}

export function initChatWebSocketServer(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: '/api/v1/chat/ws' })

  wss.on('connection', (ws) => {
    const state: SessionState = {
      mode: 'thinking',
      contextMessages: [],
      isRunning: false,
      isWaiting: false,
    }

    ws.on('message', async (data) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString()
        const parsed = chatRequestSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) {
          sendEvent(ws, 'error', { message: parsed.error.issues.map((i) => i.message).join('; ') })
          return
        }

        state.mode = parsed.data.mode

        if (state.mode === 'simple') {
          sendEvent(ws, 'error', { message: 'WS 仅支持“thinking”模式，请改用 HTTP simple。' })
          return
        }

        if (state.isWaiting) {
          const userText = parsed.data.messages
            .filter((m) => m.role === 'user')
            .map((m) => m.content)
            .join('\n')
          state.resumeHint = userText || undefined
          state.isWaiting = false
        }

        await runDeepMode(ws, state, parsed.data)
      } catch (error) {
        logger.error('WS 处理消息失败:', error)
        sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
      }
    })

    ws.on('close', () => {
      state.contextMessages = []
      state.isRunning = false
      state.isWaiting = false
    })
  })
}
