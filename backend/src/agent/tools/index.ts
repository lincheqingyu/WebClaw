/**
 * 工具集合导出
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { TodoManager } from '../../core/todo/todo-manager.js'
import { createBashTool } from './bash.js'
import { createReadFileTool } from './read-file.js'
import { createEditFileTool } from './edit-file.js'
import { createWriteFileTool } from './write-file.js'
import { createSkillTool } from './skill.js'
import { createTodoWriteTool } from './todo-write.js'
import { createExtensionTools } from '../../extensions/index.js'

/** Simple 模式工具集（完整工具 + 扩展） */
export function createSimpleTools(): AgentTool<any>[] {
  return [
    createReadFileTool(),
    createBashTool(),
    createEditFileTool(),
    createWriteFileTool(),
    createSkillTool(),
    ...createExtensionTools(),
  ]
}

/** Manager 工具集（read + skill + todo_write） */
export function createManagerTools(todoManager: TodoManager): AgentTool<any>[] {
  return [createReadFileTool(), createSkillTool(), createTodoWriteTool(todoManager)]
}

/** Worker 工具集（完整工具 + 扩展） */
export function createWorkerTools(): AgentTool<any>[] {
  return [
    createReadFileTool(),
    createBashTool(),
    createEditFileTool(),
    createWriteFileTool(),
    createSkillTool(),
    ...createExtensionTools(),
  ]
}

export { createBashTool } from './bash.js'
export { createReadFileTool } from './read-file.js'
export { createEditFileTool } from './edit-file.js'
export { createWriteFileTool } from './write-file.js'
export { createSkillTool } from './skill.js'
export { createTodoWriteTool } from './todo-write.js'
