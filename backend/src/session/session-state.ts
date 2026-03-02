/**
 * 会话状态定义与序列化
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { UserMessage, AssistantMessage } from '@mariozechner/pi-ai'
import type { SessionId, SessionSnapshot, SerializedTodoItem } from '@webclaw/shared'
import { createTodoManager, type TodoManager, type TodoItem } from '../core/todo/todo-manager.js'

export type Mode = 'simple' | 'plan'

/** 会话状态 */
export interface SessionState {
  readonly sessionId: SessionId
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
  waitingTodoIndex?: number
  abortController?: AbortController
  todoManager: TodoManager
  memoryTurnCounter: number
  lastActiveAt: number
  createdAt: number
}

/** 创建新会话状态 */
export function createSessionState(sessionId: SessionId): SessionState {
  const now = Date.now()
  return {
    sessionId,
    mode: 'simple',
    contextMessages: [],
    isRunning: false,
    isWaiting: false,
    todoManager: createTodoManager(),
    memoryTurnCounter: 0,
    lastActiveAt: now,
    createdAt: now,
  }
}

/** 将会话状态序列化为快照（排除运行时字段和敏感信息） */
export function serializeSessionState(state: SessionState): SessionSnapshot {
  return {
    sessionId: state.sessionId,
    mode: state.mode,
    contextMessages: state.contextMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: m.timestamp,
    })),
    todoItems: state.todoManager.getItems().map((item) => ({
      content: item.content,
      status: item.status,
      activeForm: item.activeForm,
      result: item.result,
      errorMessage: item.errorMessage,
    })),
    memoryTurnCounter: state.memoryTurnCounter,
    createdAt: state.createdAt,
    lastActiveAt: state.lastActiveAt,
  }
}

/** 从快照恢复会话状态 */
export function restoreSessionState(snapshot: SessionSnapshot): SessionState {
  const todoManager = createTodoManager()
  const todoItems: TodoItem[] = (snapshot.todoItems ?? []).map((item: SerializedTodoItem) => ({
    content: item.content,
    status: item.status,
    activeForm: item.activeForm,
    result: item.result,
    errorMessage: item.errorMessage,
  }))
  todoManager.loadItems(todoItems)

  // 恢复时只保留 user/assistant 消息（toolResult 缺少必填字段且不影响后续上下文）
  const contextMessages: AgentMessage[] = (snapshot.contextMessages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m): AgentMessage => {
      const ts = m.timestamp ?? Date.now()
      if (m.role === 'user') {
        return { role: 'user', content: m.content, timestamp: ts } satisfies UserMessage
      }
      // assistant 消息补充默认元数据（序列化时已丢失，仅用于上下文传递）
      return {
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-completions',
        provider: 'unknown',
        model: 'unknown',
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: ts,
      } satisfies AssistantMessage
    })

  return {
    sessionId: snapshot.sessionId as SessionId,
    mode: snapshot.mode ?? 'simple',
    contextMessages,
    isRunning: false,
    isWaiting: false,
    todoManager,
    memoryTurnCounter: snapshot.memoryTurnCounter ?? 0,
    lastActiveAt: snapshot.lastActiveAt ?? Date.now(),
    createdAt: snapshot.createdAt ?? Date.now(),
  }
}
