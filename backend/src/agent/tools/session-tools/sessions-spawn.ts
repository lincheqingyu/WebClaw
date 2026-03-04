import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { getBoundSessionService, getCurrentToolSessionKey } from './runtime.js'

const parameters = Type.Object({
  task: Type.String({ minLength: 1 }),
  label: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 3600 })),
  cleanup: Type.Optional(Type.Union([Type.Literal('delete'), Type.Literal('keep')])),
})

export function createSessionsSpawnTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_spawn',
    label: '生成隔离子会话',
    description: '创建隔离子任务会话并异步执行。',
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const requesterSessionKey = getCurrentToolSessionKey()
      if (!requesterSessionKey) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: 'missing requester session key' }) }],
          details: {},
        }
      }
      const result = await service.spawnTask(requesterSessionKey, params.task)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: {},
      }
    },
  }
}
