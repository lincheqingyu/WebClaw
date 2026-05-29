// 中文：本文件（runtime-augmentation.ts）定义运行时 synthetic context 的可审计记录，并提供 replay message 转换工具。
// English: This file (runtime-augmentation.ts) defines auditable runtime synthetic context records and replay message conversion helpers.

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { RunId, SessionEventEntry, StepId } from '@lecquy/shared'
import type { AgentRole } from '../../core/prompts/prompt-layer-types.js'
import { hashContent } from '../../core/prompts/prompt-serializer.js'
import type { SystemPromptUpdatePhase } from '../../core/prompts/system-prompt-update.js'

export const RUNTIME_AUGMENTATION_CUSTOM_TYPE = 'runtime_augmentation'

export type RuntimeAugmentationKind =
  | 'retrieved_memory'
  | 'system_prompt_update'
  | 'plan_task_result'
  | 'attachment_context'
  | 'compact_context'

const RUNTIME_AUGMENTATION_KINDS = new Set<RuntimeAugmentationKind>([
  'retrieved_memory',
  'system_prompt_update',
  'plan_task_result',
  'attachment_context',
  'compact_context',
])

export interface RuntimeAugmentationEntryData {
  readonly kind: typeof RUNTIME_AUGMENTATION_CUSTOM_TYPE
  readonly augmentationKind: RuntimeAugmentationKind
  readonly promptFrameId: string
  readonly sessionId: string
  readonly runId: string
  readonly stepId?: string
  readonly promptRole: AgentRole
  readonly phase: SystemPromptUpdatePhase
  readonly targetMessageId: string
  readonly insertBefore: 'current_user'
  readonly ordinal: number
  readonly role: 'user'
  readonly content: string
  readonly contentHash: string
  readonly source?: {
    readonly snapshotId?: string
    readonly snapshotHash?: string
    readonly sourceHashBefore?: unknown
    readonly sourceHashNow?: unknown
  }
  readonly visible: false
  readonly createdAt: string
}

export interface CreateRuntimeAugmentationInput {
  readonly augmentationKind: RuntimeAugmentationKind
  readonly promptFrameId: string
  readonly sessionId: string
  readonly runId: RunId | string
  readonly stepId?: StepId | string
  readonly promptRole: AgentRole
  readonly phase: SystemPromptUpdatePhase
  readonly targetMessageId: string
  readonly ordinal: number
  readonly content: string
  readonly source?: RuntimeAugmentationEntryData['source']
  readonly createdAt?: Date
}

export function createRuntimeAugmentationEntryData(
  input: CreateRuntimeAugmentationInput,
): RuntimeAugmentationEntryData {
  return {
    kind: RUNTIME_AUGMENTATION_CUSTOM_TYPE,
    augmentationKind: input.augmentationKind,
    promptFrameId: input.promptFrameId,
    sessionId: input.sessionId,
    runId: String(input.runId),
    stepId: input.stepId ? String(input.stepId) : undefined,
    promptRole: input.promptRole,
    phase: input.phase,
    targetMessageId: input.targetMessageId,
    insertBefore: 'current_user',
    ordinal: input.ordinal,
    role: 'user',
    content: input.content,
    contentHash: hashContent(input.content),
    source: input.source,
    visible: false,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  }
}

export function createRuntimeAugmentationMessage(
  augmentation: RuntimeAugmentationEntryData,
): AgentMessage {
  return {
    role: augmentation.role,
    content: [{ type: 'text', text: augmentation.content }],
    timestamp: new Date(augmentation.createdAt).getTime(),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isAgentRole(value: unknown): value is AgentRole {
  return value === 'simple' || value === 'manager' || value === 'worker'
}

function isSystemPromptUpdatePhase(value: unknown): value is SystemPromptUpdatePhase {
  return value === 'normal'
    || value === 'plan_final_answer'
    || value === 'manager'
    || value === 'worker'
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
}

function isRuntimeAugmentationKind(value: unknown): value is RuntimeAugmentationKind {
  return typeof value === 'string' && RUNTIME_AUGMENTATION_KINDS.has(value as RuntimeAugmentationKind)
}

function isRuntimeAugmentationSource(value: unknown): value is RuntimeAugmentationEntryData['source'] {
  if (value === undefined) {
    return true
  }
  if (!isObject(value)) {
    return false
  }
  return (value.snapshotId === undefined || typeof value.snapshotId === 'string')
    && (value.snapshotHash === undefined || typeof value.snapshotHash === 'string')
    && (value.sourceHashBefore === undefined || isPlainObject(value.sourceHashBefore))
    && (value.sourceHashNow === undefined || isPlainObject(value.sourceHashNow))
}

export function isRuntimeAugmentationEntryData(input: unknown): input is RuntimeAugmentationEntryData {
  if (!isObject(input)) {
    return false
  }

  const data = input as Partial<RuntimeAugmentationEntryData>
  return data.kind === RUNTIME_AUGMENTATION_CUSTOM_TYPE
    && isRuntimeAugmentationKind(data.augmentationKind)
    && isNonEmptyString(data.promptFrameId)
    && isNonEmptyString(data.sessionId)
    && isNonEmptyString(data.runId)
    && (data.stepId === undefined || isNonEmptyString(data.stepId))
    && isAgentRole(data.promptRole)
    && isSystemPromptUpdatePhase(data.phase)
    && isNonEmptyString(data.targetMessageId)
    && data.insertBefore === 'current_user'
    && typeof data.ordinal === 'number'
    && Number.isInteger(data.ordinal)
    && data.ordinal >= 0
    && data.role === 'user'
    && typeof data.content === 'string'
    && typeof data.contentHash === 'string'
    && data.contentHash === hashContent(data.content)
    && isRuntimeAugmentationSource(data.source)
    && data.visible === false
    && isValidIsoTimestamp(data.createdAt)
}

export function getRuntimeAugmentationsForPromptFrame(
  entries: ReadonlyArray<SessionEventEntry>,
  promptFrameId: string,
): RuntimeAugmentationEntryData[] {
  return entries
    .filter((entry) => entry.type === 'custom' && entry.customType === RUNTIME_AUGMENTATION_CUSTOM_TYPE)
    .map((entry) => entry.type === 'custom' ? entry.data : undefined)
    .filter(isRuntimeAugmentationEntryData)
    .filter((augmentation) => augmentation.promptFrameId === promptFrameId)
    .sort((left, right) => left.ordinal - right.ordinal)
}

export function getRuntimeAugmentationsForTarget(
  entries: ReadonlyArray<SessionEventEntry>,
  targetMessageId: string,
): RuntimeAugmentationEntryData[] {
  return entries
    .filter((entry) => entry.type === 'custom' && entry.customType === RUNTIME_AUGMENTATION_CUSTOM_TYPE)
    .map((entry) => entry.type === 'custom' ? entry.data : undefined)
    .filter(isRuntimeAugmentationEntryData)
    .filter((augmentation) => augmentation.targetMessageId === targetMessageId)
    .sort((left, right) => left.promptFrameId.localeCompare(right.promptFrameId) || left.ordinal - right.ordinal)
}
