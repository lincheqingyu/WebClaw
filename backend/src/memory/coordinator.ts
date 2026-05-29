// 中文：本文件（coordinator.ts）位于 backend/src/memory/coordinator.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (coordinator.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/coordinator.ts, wiring upstream callers with downstream runtime logic.

import { extractSessionText, type SessionProjection } from '@lecquy/shared'
import type { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { logger } from '../utils/logger.js'
import { extractEventMemoryItems } from './extraction-runner.js'
import { deriveProjectId } from './project-id.js'
import {
  getLastExtractedSeq,
  insertItemsAndAdvanceWatermark,
} from './sqlite-store.js'
import type { EventExtractionInput, MemoryItemInsert } from './types.js'

const EVENT_EXTRACTION_MESSAGE_THRESHOLD = 4
const EVENT_EXTRACTION_MAX_MESSAGES = 8

function countDurableCandidateMessages(manager: SessionManager, fromEventSeq: number): number {
  return manager.getEntries()
    .slice(fromEventSeq)
    .filter((entry) =>
      entry.type === 'message'
      && (entry.message.role === 'user' || entry.message.role === 'assistant')
      && entry.message.content,
    )
    .length
}

interface ExtractAndPersistOptions {
  readonly extractItems?: (input: EventExtractionInput) => Promise<MemoryItemInsert[]>
}

export function buildEventExtractionInput(
  projection: SessionProjection,
  manager: SessionManager,
  fromSeq = 0,
): EventExtractionInput {
  const messages = manager.getEntries()
    .map((entry, index) => ({ entry, seq: index + 1 }))
    .filter(({ seq }) => seq > fromSeq)
    .filter(({ entry }) => {
      if (entry.type !== 'message') return false
      if (entry.message.role !== 'user' && entry.message.role !== 'assistant') return false
      return Boolean(extractSessionText(entry.message.content).trim())
    })
    .slice(-EVENT_EXTRACTION_MAX_MESSAGES)
    .map(({ entry, seq }) => {
      if (entry.type !== 'message') {
        throw new Error('unexpected non-message entry in memory extraction input')
      }

      return {
        seq,
        eventId: entry.id,
        role: entry.message.role === 'assistant' ? 'assistant' as const : 'user' as const,
        text: extractSessionText(entry.message.content).trim(),
        timestamp: entry.timestamp,
      }
    })

  return {
    sessionContext: {
      sessionId: projection.sessionId,
      sessionKey: projection.key,
      title: projection.title,
      mode: projection.workflow?.mode === 'plan' ? 'plan' : 'simple',
    },
    messages,
  }
}

export async function extractAndPersistOnTurnComplete(
  projection: SessionProjection,
  manager: SessionManager,
  cwd: string,
  options: ExtractAndPersistOptions = {},
): Promise<void> {
  const sessionId = projection.sessionId
  const lastSeq = getLastExtractedSeq(sessionId)
  const currentSeq = manager.getEntries().length
  const newMessageCount = countDurableCandidateMessages(manager, lastSeq)
  if (newMessageCount < EVENT_EXTRACTION_MESSAGE_THRESHOLD) return

  const input = buildEventExtractionInput(projection, manager, lastSeq)
  if (input.messages.length < EVENT_EXTRACTION_MESSAGE_THRESHOLD) return

  const projectId = deriveProjectId(cwd)
  const extractItems = options.extractItems ?? extractEventMemoryItems
  const items = (await extractItems(input)).map((item) => ({
    ...item,
    projectId,
  }))

  insertItemsAndAdvanceWatermark(items, sessionId, currentSeq)
  logger.info('SQLite event memory 已落库', {
    sessionKey: projection.key,
    sessionId,
    projectId,
    count: items.length,
    fromSeq: lastSeq,
    toSeq: currentSeq,
  })
}
