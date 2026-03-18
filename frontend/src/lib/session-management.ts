import {
  extractSessionAttachments,
  extractSessionText,
  extractSessionThinking,
  type SessionEventEntry,
  type SessionMessageRecord,
  type SessionProjection,
} from '@webclaw/shared'
import type { ChatMessage } from '../hooks/useChat'

export interface SessionListItemVm {
  id: string
  title: string
  preview: string
  updatedAt: number
  createdAt: number
  sessionId: string
  channel: string
  peerId?: string
}

export function extractMessageText(content: unknown): string {
  return extractSessionText(content)
}

function normalizePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '暂无消息'
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

export function toSessionListItemVm(entry: SessionProjection): SessionListItemVm {
  const latest = entry.recentMessages?.[entry.recentMessages.length - 1]
  const latestText = latest ? extractMessageText(latest.content) : ''

  return {
    id: entry.key,
    title: entry.title?.trim() || entry.displayName?.trim() || '未命名会话',
    preview: normalizePreview(latestText),
    updatedAt: entry.updatedAt,
    createdAt: entry.createdAt,
    sessionId: entry.sessionId,
    channel: entry.channel,
    peerId: entry.origin?.peerId,
  }
}

export function toChatMessages(records: SessionMessageRecord[]): ChatMessage[] {
  return records
    .filter((record) => record.role === 'user' || record.role === 'assistant')
    .map((record, index) => {
      const thinkingContent = extractSessionThinking(record.content)
      return {
        id: `history_${record.role}_${record.timestamp ?? Date.now()}_${index}`,
        role: record.role as ChatMessage['role'],
        content: extractMessageText(record.content),
        attachments: record.role === 'user' ? extractSessionAttachments(record.content) : undefined,
        thinkingContent: thinkingContent || undefined,
        hasThinking: thinkingContent.trim().length > 0,
        isThinkingExpanded: false,
        timestamp: record.timestamp ?? Date.now(),
      }
    })
}

export function toChatMessagesFromHistoryView(projection: SessionProjection, entries: SessionEventEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const messageById = new Map<string, ChatMessage>()
  const stepById = new Map<string, { kind: string; todoIndex?: number; runId: string; title?: string }>()
  const activeRunById = new Map<string, { mode: string; planMessageId?: string }>()
  let activeStepId: string | null = null

  const createHistoryId = (prefix: string, index: number) => `history_${prefix}_${index}`

  const appendMessage = (message: ChatMessage) => {
    messages.push(message)
    messageById.set(message.id, message)
  }

  entries.forEach((entry, index) => {
    if (entry.type === 'run_started') {
      const planMessageId = entry.mode === 'plan' ? createHistoryId('plan', index) : undefined
      activeRunById.set(entry.runId, { mode: entry.mode, planMessageId })

      if (entry.mode === 'plan' && planMessageId) {
        appendMessage({
          id: planMessageId,
          role: 'event',
          content: '',
          todoItems: [],
          planDetails: {},
          isTodoExpanded: true,
          expandedPlanTaskIndexes: [],
          timestamp: new Date(entry.timestamp).getTime(),
          eventType: 'plan',
        })
      }
      return
    }

    if (entry.type === 'step_started') {
      stepById.set(entry.stepId, { kind: entry.kind, todoIndex: entry.todoIndex, runId: entry.runId, title: entry.title })
      activeStepId = entry.stepId

      if (entry.kind === 'task' && typeof entry.todoIndex === 'number') {
        const run = activeRunById.get(entry.runId)
        const planMessage = run?.planMessageId ? messageById.get(run.planMessageId) : undefined
        if (planMessage) {
          planMessage.expandedPlanTaskIndexes = planMessage.expandedPlanTaskIndexes?.includes(entry.todoIndex)
            ? planMessage.expandedPlanTaskIndexes
            : [...(planMessage.expandedPlanTaskIndexes ?? []), entry.todoIndex].sort((a, b) => a - b)

          planMessage.planDetails = {
            ...(planMessage.planDetails ?? {}),
            [entry.todoIndex]: {
              todoIndex: entry.todoIndex,
              title: entry.title,
              content: planMessage.planDetails?.[entry.todoIndex]?.content ?? '',
              stepId: entry.stepId,
            },
          }
        }
      }
      return
    }

    if (entry.type === 'message') {
      if (entry.message.role === 'user') {
        appendMessage({
          id: createHistoryId('user', index),
          role: 'user',
          content: extractSessionText(entry.message.content),
          attachments: extractSessionAttachments(entry.message.content),
          timestamp: entry.message.timestamp ?? new Date(entry.timestamp).getTime(),
        })
        return
      }

      if (entry.message.role === 'assistant') {
        const step = activeStepId ? stepById.get(activeStepId) : undefined
        const run = step ? activeRunById.get(step.runId) : undefined

        if (step?.kind === 'planner' && run?.mode === 'plan') {
          return
        }

        if (step?.kind === 'task' && run?.mode === 'plan' && typeof step.todoIndex === 'number' && run.planMessageId) {
          const planMessage = messageById.get(run.planMessageId)
          if (planMessage) {
            const content = extractSessionText(entry.message.content)
            const existing = planMessage.planDetails?.[step.todoIndex] ?? {
              todoIndex: step.todoIndex,
              content: '',
              stepId: activeStepId ?? undefined,
            }

            planMessage.planDetails = {
              ...(planMessage.planDetails ?? {}),
              [step.todoIndex]: {
                ...existing,
                content: content || existing.content,
              },
            }
          }
          return
        }

        const thinkingContent = extractSessionThinking(entry.message.content)
        appendMessage({
          id: createHistoryId('assistant', index),
          role: 'assistant',
          content: extractSessionText(entry.message.content),
          thinkingContent: thinkingContent || undefined,
          hasThinking: thinkingContent.trim().length > 0,
          isThinkingExpanded: false,
          timestamp: entry.message.timestamp ?? new Date(entry.timestamp).getTime(),
        })
      }
      return
    }

    if (entry.type === 'todo_updated') {
      const run = activeRunById.get(entry.runId)
      const planMessage = run?.planMessageId ? messageById.get(run.planMessageId) : undefined
      if (planMessage) {
        planMessage.todoItems = entry.items.map((item) => ({ ...item }))
      }
      return
    }

    if (entry.type === 'step_finished') {
      const step = stepById.get(entry.stepId)
      if (step?.kind === 'task' && typeof entry.todoIndex === 'number') {
        const run = activeRunById.get(entry.runId)
        const planMessage = run?.planMessageId ? messageById.get(run.planMessageId) : undefined
        if (planMessage) {
          const existing = planMessage.planDetails?.[entry.todoIndex] ?? {
            todoIndex: entry.todoIndex,
            content: '',
            stepId: entry.stepId,
          }
          planMessage.planDetails = {
            ...(planMessage.planDetails ?? {}),
            [entry.todoIndex]: {
              ...existing,
              title: step.title ?? existing.title,
              content: entry.summary ?? existing.content,
            },
          }
        }
      }

      if (activeStepId === entry.stepId) {
        activeStepId = null
      }
      return
    }

    if (entry.type === 'run_finished') {
      activeRunById.delete(entry.runId)
    }
  })

  if (projection.workflow?.mode === 'plan' && projection.workflow.todo?.items?.length) {
    const hasPlanMessage = messages.some((message) => message.eventType === 'plan')
    if (!hasPlanMessage) {
      messages.unshift({
        id: 'history_plan_fallback',
        role: 'event',
        content: '',
        todoItems: projection.workflow.todo.items.map((item) => ({ ...item })),
        planDetails: Object.fromEntries(
          projection.workflow.todo.items.map((item, index) => [
            index,
            {
              todoIndex: index,
              content: item.result ?? '',
            },
          ]),
        ),
        isTodoExpanded: true,
        expandedPlanTaskIndexes: projection.workflow.todo.items.map((_, index) => index),
        timestamp: projection.workflow.updatedAt,
        eventType: 'plan',
      })
    }
  }

  return messages
}

export function parsePeerIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:[^:]+:[^:]+:[^:]+:dm:(.+)$/)
  return match?.[1] ?? null
}
