// 中文：本文件（prompt-injector.ts）位于 backend/src/memory/prompt-injector.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (prompt-injector.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/prompt-injector.ts, wiring upstream callers with downstream runtime logic.

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionMode, SessionRouteContext } from '@lecquy/shared'
import { formatMemoryRecallBlock } from '../runtime/context/templates/memory-recall.template.js'
import { logger } from '../utils/logger.js'
import { deriveProjectId } from './project-id.js'
import { MEMORY_RECALL_TOP_K, searchForRecall, type MemoryItemRow } from './sqlite-store.js'
import { loadMemoryInjectionText } from './store.js'
import type { MemoryRecallResult } from './types.js'

interface BuildMemoryRecallBlockArgs {
  readonly sessionId: string
  readonly sessionKey: string
  readonly userQuery: string
  readonly workspaceDir: string
  readonly mode: SessionMode
  readonly route?: SessionRouteContext
}

interface BuildMemoryRecallMessagesArgs {
  readonly sessionId: string
  readonly sessionKey?: string
  readonly userQuery: string
  readonly workspaceDir: string
  readonly mode?: SessionMode
  readonly route?: SessionRouteContext
}

export const promptInjectorDeps = {
  searchForRecall,
  deriveProjectId,
  formatMemoryRecallBlock,
  loadMemoryInjectionText,
  logger,
} as const

/**
 * @deprecated 使用 buildMemoryRecallMessages 替代。
 */
export async function buildMemoryRecallBlockLegacy(
  args: BuildMemoryRecallBlockArgs,
): Promise<string> {
  let recallText = buildSQLiteMemoryRecallText(args)
  if (!recallText.trim()) {
    recallText = await promptInjectorDeps.loadMemoryInjectionText(args.workspaceDir)
  }
  return recallText
}

function createMemoryRecallMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: `<retrieved_memory priority="low" source="lecquy">\n${text}\n</retrieved_memory>`,
    timestamp: 0,
  }
}

function toRecallResult(item: MemoryItemRow): MemoryRecallResult {
  return {
    id: item.id,
    kind: 'event',
    eventType: item.eventType,
    projectId: item.projectId,
    summary: item.summary,
    content: item.content,
    tags: item.tags,
    importance: item.importance,
    confidence: item.confidence,
    occurredAt: item.occurredAt,
    sourceEventIds: item.sourceEventIds,
    score: item.score ?? 0,
  }
}

function buildSQLiteMemoryRecallText(args: BuildMemoryRecallMessagesArgs): string {
  if (process.env.LECQUY_MEMORY_DISABLED === 'true') {
    return ''
  }

  try {
    const projectId = promptInjectorDeps.deriveProjectId(args.workspaceDir)
    const recallItems = promptInjectorDeps.searchForRecall({
      currentProjectId: projectId,
      userQuery: args.userQuery,
      limit: MEMORY_RECALL_TOP_K,
    })

    return promptInjectorDeps.formatMemoryRecallBlock(recallItems.map(toRecallResult))
  } catch (error) {
    promptInjectorDeps.logger.warn('SQLite memory recall 失败，已回退为文件系统 recall', {
      sessionId: args.sessionId,
      sessionKey: args.sessionKey ?? args.sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

export async function buildMemoryRecallMessages(
  args: BuildMemoryRecallMessagesArgs,
): Promise<AgentMessage[]> {
  let recallText = buildSQLiteMemoryRecallText(args)

  if (!recallText.trim()) {
    recallText = await promptInjectorDeps.loadMemoryInjectionText(args.workspaceDir)
  }

  const normalized = recallText.trim()
  if (!normalized) {
    return []
  }

  return [createMemoryRecallMessage(normalized)]
}
