import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { WS_BASE } from '../config/api.ts'
import { getSessionId } from '../lib/session.ts'
import { ReconnectableWs, type ConnectionStatus } from '../lib/ws-reconnect.ts'

export type ChatMode = 'simple' | 'plan'

export type MessageRole = 'user' | 'assistant' | 'system' | 'event'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  eventType?: string
}

export interface ModelConfig {
  model: string
  temperature: number
  maxTokens: number
  baseUrl: string
  apiKey: string
  enableTools: boolean
}

interface UseChatOptions {
  systemPrompt: string
  modelConfig: ModelConfig
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function appendMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  msg: ChatMessage,
) {
  setMessages((prev) => [...prev, msg])
}

/** 处理 WS 消息的纯函数 */
function handleWsEvent(
  payload: Record<string, unknown>,
  lastAssistantIdRef: { current: string | null },
  lastWorkerIdRef: { current: string | null },
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  updateContent: (id: string, delta: string) => void,
  setIsStreaming: Dispatch<SetStateAction<boolean>>,
  setIsWaiting: Dispatch<SetStateAction<boolean>>,
): void {
  const eventType = payload.event as string
  const eventPayload = (payload.payload as Record<string, unknown>) ?? {}

  if (eventType === 'message_delta') {
    const last = lastAssistantIdRef.current
    if (last) {
      updateContent(last, (eventPayload.content as string) ?? '')
    }
    return
  }

  if (eventType === 'worker_delta') {
    const last = lastWorkerIdRef.current
    if (last) {
      updateContent(last, (eventPayload.content as string) ?? '')
    }
    return
  }

  if (eventType === 'message_end') {
    setIsStreaming(false)
    return
  }

  if (eventType === 'need_user_input') {
    setIsWaiting(true)
    appendMessage(setMessages, {
      id: createId('event'),
      role: 'event',
      content: (eventPayload.prompt as string) ?? '需要补充信息',
      timestamp: Date.now(),
      eventType,
    })
    return
  }

  if (eventType === 'done') {
    setIsStreaming(false)
    setIsWaiting(false)
    return
  }

  if (eventType === 'session_restored') {
    appendMessage(setMessages, {
      id: createId('system'),
      role: 'system',
      content: `会话已恢复 (${eventPayload.messageCount ?? 0} 条上下文)`,
      timestamp: Date.now(),
      eventType: 'session_restored',
    })
    return
  }

  if (eventType === 'error') {
    appendMessage(setMessages, {
      id: createId('system'),
      role: 'system',
      content: (eventPayload.message as string) ?? '发生错误',
      timestamp: Date.now(),
    })
    setIsStreaming(false)
    setIsWaiting(false)
    return
  }

  if (eventType === 'worker_start') {
    const id = createId('worker')
    lastWorkerIdRef.current = id
    const content = `Worker #${eventPayload.todoIndex ?? ''}: ${eventPayload.content ?? ''}`
    appendMessage(setMessages, {
      id,
      role: 'event',
      content,
      timestamp: Date.now(),
      eventType,
    })
    return
  }

  if (eventType === 'worker_end') {
    lastWorkerIdRef.current = null
  }

  // 其他事件（todo_write, subagent_start 等）
  const content =
    (eventPayload.content as string) ??
    (eventPayload.result as string) ??
    (eventPayload.prompt as string) ??
    JSON.stringify(eventPayload, null, 2)

  appendMessage(setMessages, {
    id: createId('event'),
    role: 'event',
    content,
    timestamp: Date.now(),
    eventType,
  })
}

export function useChat({ systemPrompt, modelConfig }: UseChatOptions) {
  const [mode, setMode] = useState<ChatMode>('simple')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')

  const reconnectWsRef = useRef<ReconnectableWs | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)
  const lastWorkerIdRef = useRef<string | null>(null)

  const updateMessageContent = useCallback((id: string, delta: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
    )
  }, [])

  /** 获取或创建 ReconnectableWs */
  const ensureWs = useCallback(() => {
    if (reconnectWsRef.current) return reconnectWsRef.current

    const sessionId = getSessionId()
    const url = `${WS_BASE}/api/v1/chat/ws?sessionId=${sessionId}`

    const rws = new ReconnectableWs({
      url,
      onMessage: (data) => {
        try {
          const payload = JSON.parse(data) as Record<string, unknown>
          handleWsEvent(
            payload,
            lastAssistantIdRef,
            lastWorkerIdRef,
            setMessages,
            updateMessageContent,
            setIsStreaming,
            setIsWaiting,
          )
        } catch {
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: '无法解析 WS 消息',
            timestamp: Date.now(),
          })
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status)
        if (status === 'disconnected') {
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: 'WebSocket 连接已断开',
            timestamp: Date.now(),
          })
        }
      },
    })

    reconnectWsRef.current = rws
    return rws
  }, [updateMessageContent, setMessages, setIsStreaming, setIsWaiting, setConnectionStatus])

  const buildMessages = useCallback(
    (text: string) => {
      const result: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (systemPrompt.trim()) {
        result.push({ role: 'system', content: systemPrompt.trim() })
      }
      const history = messages
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            m.content.trim().length > 0,
        )
        .map((m) => ({
          role: m.role,
          content: m.content,
        })) as Array<{ role: 'user' | 'assistant'; content: string }>

      result.push(...history)
      result.push({ role: 'user', content: text })
      return result
    },
    [messages, systemPrompt],
  )

  const sendWs = useCallback(
    (text: string) => {
      const userId = createId('user')
      appendMessage(setMessages, {
        id: userId,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      })

      const assistantId = createId('assistant')
      lastAssistantIdRef.current = assistantId
      lastWorkerIdRef.current = null
      appendMessage(setMessages, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      })

      setIsStreaming(true)
      setIsWaiting(false)

      const payload = JSON.stringify({
        event: 'chat',
        payload: {
          mode,
          model: modelConfig.model,
          baseUrl: modelConfig.baseUrl || undefined,
          apiKey: modelConfig.apiKey || undefined,
          enableTools: modelConfig.enableTools,
          options: {
            temperature: modelConfig.temperature,
            maxTokens: modelConfig.maxTokens,
          },
          messages: buildMessages(text),
        },
      })

      const rws = ensureWs()
      rws.send(payload)
    },
    [buildMessages, ensureWs, mode, modelConfig.apiKey, modelConfig.baseUrl, modelConfig.enableTools, modelConfig.maxTokens, modelConfig.model, modelConfig.temperature],
  )

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return
      sendWs(text)
    },
    [sendWs],
  )

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      reconnectWsRef.current?.close()
      reconnectWsRef.current = null
    }
  }, [])

  return {
    mode,
    setMode,
    messages,
    send,
    isStreaming,
    isWaiting,
    connectionStatus,
  }
}
