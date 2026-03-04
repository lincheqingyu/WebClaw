import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { getBoundSessionService } from './runtime.js'

const parameters = Type.Object({
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  activeMinutes: Type.Optional(Type.Number({ minimum: 1 })),
  messageLimit: Type.Optional(Type.Number({ minimum: 0, maximum: 50 })),
})

export function createSessionsListTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_list',
    label: '列出会话',
    description: '列出最近会话，可选附带最近消息。',
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const rows = await service.listSessions(params)
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
        details: {},
      }
    },
  }
}
