/**
 * 工具集合导出
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { TodoManager } from '../../core/todo/todo-manager.js'
import { createBashTool } from './bash.js'
import { createReadFileTool } from './read-file.js'
import { createSkillTool } from './skill.js'
import { createTodoWriteTool } from './todo-write.js'
import { createExtensionTools } from '../../extensions/index.js'

/** 主 Agent 工具集（含 todoWrite + 扩展工具） */
export function createAgentTools(todoManager: TodoManager): AgentTool<any>[] {
  return [
    createBashTool(),
    createReadFileTool(),
    createSkillTool(),
    createTodoWriteTool(todoManager),
    ...createExtensionTools(),
  ]
}

/** 子 Agent 工具集（无 todoWrite，含扩展工具） */
export function createSubAgentTools(): AgentTool<any>[] {
  return [createBashTool(), createReadFileTool(), createSkillTool(), ...createExtensionTools()]
}

export { createBashTool } from './bash.js'
export { createReadFileTool } from './read-file.js'
export { createSkillTool } from './skill.js'
export { createTodoWriteTool } from './todo-write.js'
