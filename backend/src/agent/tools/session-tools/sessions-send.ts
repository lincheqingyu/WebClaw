import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { getBoundSessionService } from './runtime.js'

const parameters = Type.Object({
  sessionKey: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 600, default: 30 })),
})

export function createSessionsSendTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_send',
    label: '跨会话发送消息',
    description: '向另一个会话发送消息。',
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const timeoutSeconds = params.timeoutSeconds ?? 30
      const promise = service.runSend(params.sessionKey, params.message)
      if (timeoutSeconds === 0) {
        void promise
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'accepted' }) }],
          details: {},
        }
      }

      const timeout = new Promise<{ timeout: true }>((resolve) => {
        setTimeout(() => resolve({ timeout: true }), timeoutSeconds * 1000)
      })

      const race = await Promise.race([promise, timeout])
      if ('timeout' in race) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'timeout', error: `waited ${timeoutSeconds}s` }) }],
          details: {},
        }
      }

      if (race.status === 'error') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ runId: race.runId, status: race.status, error: race.error }) }],
          details: {},
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ runId: race.runId, status: race.status, reply: race.reply }) }],
        details: {},
      }
    },
  }
}
