/**
 * WriteFile 工具 — 写入/创建文件
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../types.js'

/** 工作空间根目录 */
const PROJECT_ROOT = process.cwd()

/** 确保路径保持在工作空间内 */
function safePath(p: string): string {
  const resolved = resolve(PROJECT_ROOT, p)
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(`路径逃逸工作空间: ${p}`)
  }
  return resolved
}

export function createWriteFileTool(): AgentTool<typeof parameters> {
  return {
    name: 'write_file',
    label: '写入文件',
    description: '写入或创建文件内容（覆盖写入）。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const fullPath = safePath(params.file_path)
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, params.content ?? '', 'utf-8')

        const summary = `已写入 ${params.file_path}（${(params.content ?? '').length} 字符）`
        return { content: [{ type: 'text', text: summary.slice(0, TOOL_OUTPUT_LIMIT) }], details: {} }
      } catch (error) {
        const text = `错误: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text: text.slice(0, TOOL_OUTPUT_LIMIT) }], details: {} }
      }
    },
  }
}

const parameters = Type.Object({
  file_path: Type.String({ description: '目标文件路径（相对于工作目录）' }),
  content: Type.String({ description: '文件内容（覆盖写入）' }),
})
