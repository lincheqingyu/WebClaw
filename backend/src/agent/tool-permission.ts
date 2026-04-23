import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentEvent, AgentTool } from '@mariozechner/pi-agent-core'
import { PermissionTier, type AgentRole } from '../core/prompts/prompt-layer-types.js'
import { bridgeResult, type BridgedTier, type PermissionManager } from '../runtime/permissions/index.js'

const AUTO_TOOLS = new Set([
  'read_file',
  'skill',
  'sessions_list',
  'sessions_history',
  'todo_write',
  'request_user_input',
])

const MANAGER_WHITELIST = new Set([
  'read_file',
  'skill',
  'todo_write',
  'request_user_input',
  'sessions_list',
  'sessions_history',
  'sessions_send',
])

const WORKER_BLACKLIST = new Set([
  'todo_write',
  'sessions_spawn',
])

const CONFIRM_PATTERNS = [
  /\brm\s/,
  /\brmdir\b/,
  /\bdel\b/,
  /\bRemove-Item\b/,
  /\binstall\b/,
  /\buninstall\b/,
  /\bdeploy\b/,
  /\bpush\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bsystemctl\b/,
  /\bservice\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\bdrop\s/i,
  /\btruncate\s/i,
  /\bdelete\s+from\b/i,
] as const

const PREAMBLE_PATTERNS = [
  /\bfind\b.*-exec/,
  /\bxargs\b/,
  /\bgrep\b.*-r/,
  /\bsed\b.*-i/,
  /\bwget\b/,
  /\bcurl\b.*-o/,
] as const

export interface PreambleEvent {
  type: 'preamble'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  description: string
}

export interface ConfirmRequiredEvent {
  type: 'confirm_required'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  description: string
}

export type ToolPermissionEvent = PreambleEvent | ConfirmRequiredEvent
export type AgentRuntimeEvent = AgentEvent | ToolPermissionEvent

function resolveTargetPath(filePath: string, workspaceDir: string): string {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath)
  }
  return path.resolve(workspaceDir, filePath)
}

function isWithinWorkspace(targetPath: string, workspaceDir: string): boolean {
  const normalizedWorkspace = path.resolve(workspaceDir)
  const normalizedTarget = path.resolve(targetPath)

  return (
    normalizedTarget === normalizedWorkspace
    || normalizedTarget.startsWith(`${normalizedWorkspace}${path.sep}`)
  )
}

function getFilePathArg(args: Record<string, unknown>): string | null {
  if (typeof args.path === 'string' && args.path.trim()) {
    return args.path
  }
  if (typeof args.file_path === 'string' && args.file_path.trim()) {
    return args.file_path
  }
  return null
}

function buildPermissionDescription(toolName: string, args: Record<string, unknown>, tier: PermissionTier): string {
  if (tier === PermissionTier.Preamble) {
    return `正在执行 ${toolName}...`
  }

  const serializedArgs = JSON.stringify(args)
  return `需要用户确认后才能执行 ${toolName}${serializedArgs ? `(${serializedArgs})` : ''}`
}

export function isCoreAgentEvent(event: AgentRuntimeEvent): event is AgentEvent {
  return (
    event.type === 'agent_start'
    || event.type === 'agent_end'
    || event.type === 'turn_start'
    || event.type === 'turn_end'
    || event.type === 'message_start'
    || event.type === 'message_update'
    || event.type === 'message_end'
    || event.type === 'tool_execution_start'
    || event.type === 'tool_execution_update'
    || event.type === 'tool_execution_end'
  )
}

export function classifyToolPermission(
  toolName: string,
  args: Record<string, unknown>,
  role: AgentRole,
  workspaceDir: string,
): PermissionTier {
  void role

  if (AUTO_TOOLS.has(toolName)) {
    return PermissionTier.Auto
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const filePath = getFilePathArg(args)
    if (!filePath) {
      return PermissionTier.Confirm
    }

    const resolvedPath = resolveTargetPath(filePath, workspaceDir)
    if (!isWithinWorkspace(resolvedPath, workspaceDir)) {
      return PermissionTier.Confirm
    }

    return existsSync(resolvedPath)
      ? PermissionTier.Preamble
      : PermissionTier.Auto
  }

  if (toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    if (CONFIRM_PATTERNS.some((pattern) => pattern.test(command))) {
      return PermissionTier.Confirm
    }
    if (PREAMBLE_PATTERNS.some((pattern) => pattern.test(command))) {
      return PermissionTier.Preamble
    }
    return PermissionTier.Auto
  }

  if (toolName === 'sessions_send') {
    return PermissionTier.Preamble
  }

  if (toolName === 'sessions_spawn') {
    return PermissionTier.Confirm
  }

  return PermissionTier.Confirm
}

export function isManagerAllowed(toolName: string): boolean {
  return MANAGER_WHITELIST.has(toolName)
}

export function isWorkerAllowed(toolName: string): boolean {
  return !WORKER_BLACKLIST.has(toolName)
}

/**
 * 取更严格的 `PermissionTier`（Confirm > Preamble > Auto）。
 * 用于双引擎并行时合并新旧决策。
 */
function mostRestrictiveTier(a: PermissionTier, b: PermissionTier): PermissionTier {
  const rank = (t: PermissionTier): number => {
    switch (t) {
      case PermissionTier.Confirm:
        return 2
      case PermissionTier.Preamble:
        return 1
      case PermissionTier.Auto:
        return 0
      default:
        return 0
    }
  }
  return rank(a) >= rank(b) ? a : b
}

export function createPermissionAwareTools(
  tools: readonly AgentTool<any>[],
  options: {
    role: AgentRole
    workspaceDir: string
    enabled: boolean
    onEvent?: (event: ToolPermissionEvent) => void
    /**
     * 新权限引擎实例（可选）。
     *
     * 若提供，则与现有 `classifyToolPermission` 双引擎并行决策，取更严格一方。
     * 新引擎的硬拒绝（hardDeny）会直接短路，不走 Confirm 的等待确认流程。
     * 新引擎抛错时优雅降级到旧引擎。
     */
    manager?: PermissionManager
  },
): AgentTool<any>[] {
  if (!options.enabled) {
    return [...tools]
  }

  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>

      // 1. 新引擎决策（若注入）
      let bridged: BridgedTier | null = null
      if (options.manager) {
        try {
          const result = await options.manager.check({
            toolName: tool.name,
            args,
            workspaceDir: options.workspaceDir,
            role: options.role,
          })
          bridged = bridgeResult(result)
        } catch {
          // 新引擎失败降级到旧引擎，保持主路径可用
          bridged = null
        }
      }

      // 2. 硬拒绝短路：不走 Confirm，直接抛错
      if (bridged?.hardDeny) {
        const description = bridged.description
        options.onEvent?.({
          type: 'confirm_required',
          toolCallId,
          toolName: tool.name,
          args,
          description,
        })
        throw new Error(description)
      }

      // 3. 旧引擎决策
      const legacyTier = classifyToolPermission(tool.name, args, options.role, options.workspaceDir)

      // 4. 双引擎取更严格
      const tier = bridged ? mostRestrictiveTier(bridged.tier, legacyTier) : legacyTier

      if (tier === PermissionTier.Preamble) {
        options.onEvent?.({
          type: 'preamble',
          toolCallId,
          toolName: tool.name,
          args,
          description: bridged?.description ?? buildPermissionDescription(tool.name, args, tier),
        })
      }

      if (tier === PermissionTier.Confirm) {
        const description = bridged?.description ?? buildPermissionDescription(tool.name, args, tier)
        options.onEvent?.({
          type: 'confirm_required',
          toolCallId,
          toolName: tool.name,
          args,
          description,
        })
        throw new Error(description)
      }

      return await tool.execute(toolCallId, params, signal, onUpdate)
    },
  }))
}
