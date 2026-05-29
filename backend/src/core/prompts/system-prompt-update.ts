// 中文：本文件（system-prompt-update.ts）构建 FrozenSystemSnapshot 之后的 cumulative `<system_prompt_update>`，供 runtime 作为用户前置 synthetic context 注入。
// English: This file (system-prompt-update.ts) builds cumulative `<system_prompt_update>` messages after a FrozenSystemSnapshot for pre-user runtime context injection.

import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { SessionMode, SessionRouteContext } from '@lecquy/shared'
import { SKILLS } from '../skills/skill-loader.js'
import type { SkillSession } from '../skills/skill-session.js'
import type { AgentRole } from './prompt-layer-types.js'
import { hashContent } from './prompt-serializer.js'
import { parseUserMd } from './user-md-parser.js'
import {
  collectCurrentSystemPromptSourceState,
  hashSystemPromptRuntimeInputs,
  type FrozenSystemSnapshot,
  type FrozenSystemSourceHashes,
} from './system-prompt-snapshot.js'

export type SystemPromptUpdatePhase = 'normal' | 'plan_final_answer' | 'manager' | 'worker'

export interface SystemPromptUpdate {
  readonly sessionId: string
  readonly baseSnapshotId: string
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly generatedAt: string
  readonly sourceHashBefore: FrozenSystemSourceHashes
  readonly sourceHashNow: FrozenSystemSourceHashes
  readonly changes: SystemPromptUpdateChanges
  readonly serializedText: string
  readonly contentHash: string
}

export interface SystemPromptUpdateChanges {
  readonly currentDate?: {
    readonly snapshotDate: string
    readonly currentDate: string
    readonly timeZone: string
  }
  readonly runtime?: {
    readonly mode?: SessionMode
    readonly modelId?: string
    readonly thinkingLevel?: string
    readonly toolsEnabled?: boolean
    readonly extraInstructions?: string
    readonly phase?: SystemPromptUpdatePhase
  }
  readonly editableContext?: ReadonlyArray<{
    readonly path: 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.summary.md'
    readonly currentSummary: string
  }>
  readonly activeSkill?: {
    readonly name: string
    readonly currentSummary: string
  }
  readonly blockedSourceChanges?: ReadonlyArray<{
    readonly source: 'promptModules' | 'managedAgents' | 'managedTools' | 'toolInventory' | 'skillsIndex'
    readonly reason: string
  }>
}

export interface BuildSystemPromptUpdateRequest {
  readonly snapshot: FrozenSystemSnapshot
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly workspaceDir: string
  readonly route?: SessionRouteContext
  readonly modelId: string
  readonly thinkingLevel?: string
  readonly tools: ReadonlyArray<AgentTool<any>>
  readonly toolsEnabled: boolean
  readonly extraInstructions?: string
  readonly activeSkillName?: string
  readonly skillSession?: SkillSession
  readonly phase?: SystemPromptUpdatePhase
  readonly now?: Date
}

const SUMMARY_CHAR_LIMIT = 1800
const EXTRA_INSTRUCTIONS_CHAR_LIMIT = 1200

export async function buildSystemPromptUpdate(
  request: BuildSystemPromptUpdateRequest,
): Promise<SystemPromptUpdate | null> {
  const now = request.now ?? new Date()
  const sourceState = await collectCurrentSystemPromptSourceState({
    sessionId: request.snapshot.sessionId,
    createdReason: 'session_created',
    role: request.role,
    mode: request.mode,
    workspaceDir: request.workspaceDir,
    route: request.route,
    modelId: request.modelId,
    thinkingLevel: request.thinkingLevel,
    tools: request.tools,
    toolsEnabled: request.toolsEnabled,
    extraInstructions: request.extraInstructions,
    activeSkillName: request.activeSkillName,
    skillSession: request.skillSession,
  }, now)

  const changes = await collectUpdateChanges(request, sourceState, now)
  if (!hasUpdateChanges(changes)) {
    return null
  }

  const generatedAt = now.toISOString()
  const serializedText = serializeSystemPromptUpdate({
    baseSnapshotId: request.snapshot.snapshotId,
    generatedAt,
    changes,
  })

  return {
    sessionId: request.snapshot.sessionId,
    baseSnapshotId: request.snapshot.snapshotId,
    role: request.role,
    mode: request.mode,
    generatedAt,
    sourceHashBefore: request.snapshot.sourceHashes,
    sourceHashNow: sourceState.sourceHashes,
    changes,
    serializedText,
    contentHash: hashContent(serializedText),
  }
}

async function collectUpdateChanges(
  request: BuildSystemPromptUpdateRequest,
  sourceState: Awaited<ReturnType<typeof collectCurrentSystemPromptSourceState>>,
  now: Date,
): Promise<SystemPromptUpdateChanges> {
  return {
    currentDate: buildCurrentDateChange(request, now),
    runtime: buildRuntimeChange(request),
    editableContext: buildEditableContextChanges(request.snapshot.sourceHashes, sourceState),
    activeSkill: await buildActiveSkillChange(request, sourceState.sourceHashes),
    blockedSourceChanges: buildBlockedSourceChanges(request.snapshot.sourceHashes, sourceState.sourceHashes),
  }
}

function buildCurrentDateChange(
  request: BuildSystemPromptUpdateRequest,
  now: Date,
): SystemPromptUpdateChanges['currentDate'] {
  const currentTimeZone = request.route?.userTimezone ?? request.snapshot.timeZone ?? 'UTC'
  const snapshotTimeZone = request.snapshot.timeZone ?? 'UTC'
  const snapshotDate = formatDateInTimeZone(new Date(request.snapshot.createdAt), snapshotTimeZone)
  const currentDate = formatDateInTimeZone(now, currentTimeZone)
  const timeZoneChanged = request.snapshot.timeZone === undefined
    ? request.route?.userTimezone !== undefined
    : request.snapshot.timeZone !== currentTimeZone

  if (snapshotDate === currentDate && !timeZoneChanged) {
    return undefined
  }

  return {
    snapshotDate,
    currentDate,
    timeZone: currentTimeZone,
  }
}

function buildRuntimeChange(request: BuildSystemPromptUpdateRequest): SystemPromptUpdateChanges['runtime'] {
  const runtime: {
    mode?: SessionMode
    modelId?: string
    thinkingLevel?: string
    toolsEnabled?: boolean
    extraInstructions?: string
    phase?: SystemPromptUpdatePhase
  } = {}
  const runtimeInputsAtSnapshotTime = hashSystemPromptRuntimeInputs(request, request.snapshot.createdAt)
  const runtimeInputsChanged = runtimeInputsAtSnapshotTime !== request.snapshot.sourceHashes.runtimeInputs

  if (request.snapshot.mode !== request.mode) {
    runtime.mode = request.mode
  }
  if ((request.snapshot.modelId ?? '') !== request.modelId) {
    runtime.modelId = request.modelId
  }
  if (runtimeInputsChanged) {
    if (request.thinkingLevel) {
      runtime.thinkingLevel = request.thinkingLevel
    }
    runtime.toolsEnabled = request.toolsEnabled
    if (request.extraInstructions?.trim()) {
      runtime.extraInstructions = truncateSummary(request.extraInstructions.trim(), EXTRA_INSTRUCTIONS_CHAR_LIMIT)
    }
  }
  if (request.phase && request.phase !== 'normal' && request.phase !== request.role) {
    runtime.phase = request.phase
  }

  return Object.keys(runtime).length > 0 ? runtime : undefined
}

function buildEditableContextChanges(
  sourceHashBefore: FrozenSystemSourceHashes,
  sourceState: Awaited<ReturnType<typeof collectCurrentSystemPromptSourceState>>,
): SystemPromptUpdateChanges['editableContext'] {
  const changes: Array<{
    path: 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.summary.md'
    currentSummary: string
  }> = []
  const { sourceHashes, currentEditableSources } = sourceState

  if (sourceHashBefore.soul !== sourceHashes.soul) {
    changes.push({
      path: 'SOUL.md',
      currentSummary: summarizePlainContext(currentEditableSources.soul),
    })
  }
  if (sourceHashBefore.identity !== sourceHashes.identity) {
    changes.push({
      path: 'IDENTITY.md',
      currentSummary: summarizePlainContext(currentEditableSources.identity),
    })
  }
  if (sourceHashBefore.user !== sourceHashes.user) {
    changes.push({
      path: 'USER.md',
      currentSummary: summarizeUserContext(currentEditableSources.user),
    })
  }
  if (sourceHashBefore.memorySummary !== sourceHashes.memorySummary) {
    changes.push({
      path: 'MEMORY.summary.md',
      currentSummary: summarizePlainContext(currentEditableSources.memorySummary),
    })
  }

  return changes.length > 0 ? changes : undefined
}

async function buildActiveSkillChange(
  request: BuildSystemPromptUpdateRequest,
  sourceHashNow: FrozenSystemSourceHashes,
): Promise<SystemPromptUpdateChanges['activeSkill']> {
  const before = request.snapshot.sourceHashes.activeSkill
  const current = sourceHashNow.activeSkill
  if ((before ?? '') === (current ?? '')) {
    return undefined
  }

  const activeSkillName = (request.skillSession?.getActiveSkillName() ?? request.activeSkillName?.trim()) || undefined
  if (!activeSkillName || !current) {
    return {
      name: request.snapshot.activeSkillName ?? 'active_skill',
      currentSummary: 'Active skill cleared.',
    }
  }

  const content = request.skillSession?.hasActiveSkill()
    ? request.skillSession.getSlice().content
    : SKILLS.getSkillContent(activeSkillName, request.workspaceDir) ?? ''

  return {
    name: activeSkillName,
    currentSummary: summarizePlainContext(content),
  }
}

function buildBlockedSourceChanges(
  sourceHashBefore: FrozenSystemSourceHashes,
  sourceHashNow: FrozenSystemSourceHashes,
): SystemPromptUpdateChanges['blockedSourceChanges'] {
  const changes: Array<{
    source: 'promptModules' | 'managedAgents' | 'managedTools' | 'toolInventory' | 'skillsIndex'
    reason: string
  }> = []

  if (!areHashRecordsEqual(sourceHashBefore.promptModules, sourceHashNow.promptModules)) {
    changes.push({
      source: 'promptModules',
      reason: 'promptModules changed; existing snapshot base prompt remains authoritative until resnapshot.',
    })
  }
  if (sourceHashBefore.managedAgents !== sourceHashNow.managedAgents) {
    changes.push({
      source: 'managedAgents',
      reason: 'managedAgents changed; existing snapshot AGENTS rules remain authoritative until resnapshot.',
    })
  }
  if (sourceHashBefore.managedTools !== sourceHashNow.managedTools) {
    changes.push({
      source: 'managedTools',
      reason: 'managedTools changed; existing snapshot TOOLS rules remain authoritative until resnapshot.',
    })
  }
  if (sourceHashBefore.toolInventory !== sourceHashNow.toolInventory) {
    changes.push({
      source: 'toolInventory',
      reason: 'toolInventory changed; existing snapshot tool policy remains authoritative until resnapshot.',
    })
  }
  if (sourceHashBefore.skillsIndex !== sourceHashNow.skillsIndex) {
    changes.push({
      source: 'skillsIndex',
      reason: 'skillsIndex changed; existing snapshot skill index remains authoritative until resnapshot.',
    })
  }

  return changes.length > 0 ? changes : undefined
}

function serializeSystemPromptUpdate(input: {
  readonly baseSnapshotId: string
  readonly generatedAt: string
  readonly changes: SystemPromptUpdateChanges
}): string {
  const sections: string[] = []
  const { changes } = input

  if (changes.currentDate) {
    sections.push([
      `Current date: ${changes.currentDate.currentDate}`,
      `Time zone: ${changes.currentDate.timeZone}`,
    ].join('\n'))
  }

  if (changes.runtime) {
    const lines = ['Runtime updates since snapshot:']
    if (changes.runtime.mode) lines.push(`- Current mode: ${changes.runtime.mode}`)
    if (changes.runtime.modelId) lines.push(`- Current model: ${changes.runtime.modelId}`)
    if (changes.runtime.thinkingLevel) lines.push(`- Thinking level: ${changes.runtime.thinkingLevel}`)
    if (changes.runtime.toolsEnabled !== undefined) lines.push(`- Tools enabled: ${String(changes.runtime.toolsEnabled)}`)
    if (changes.runtime.phase) lines.push(`- Current phase: ${changes.runtime.phase}`)
    if (changes.runtime.extraInstructions) {
      lines.push(`- Additional runtime instruction: ${sanitizeBodyText(changes.runtime.extraInstructions)}`)
    }
    sections.push(lines.join('\n'))
  }

  if (changes.editableContext?.length) {
    const lines = ['Changed stable context since snapshot:']
    for (const item of changes.editableContext) {
      lines.push(`- ${item.path} current effective content:`)
      lines.push(indentBlock(sanitizeBodyText(item.currentSummary), '  '))
    }
    sections.push(lines.join('\n'))
  }

  if (changes.activeSkill) {
    const lines = ['Active skill update since snapshot:']
    if (changes.activeSkill.currentSummary === 'Active skill cleared.') {
      lines.push(`- Active skill cleared: ${changes.activeSkill.name}`)
    } else {
      lines.push(`- Active skill: ${changes.activeSkill.name}`)
      lines.push(indentBlock(sanitizeBodyText(changes.activeSkill.currentSummary), '  '))
    }
    sections.push(lines.join('\n'))
  }

  if (changes.blockedSourceChanges?.length) {
    const lines = ['Source changes detected but not applied through update:']
    for (const item of changes.blockedSourceChanges) {
      lines.push(`- ${item.reason}`)
    }
    sections.push(lines.join('\n'))
  }

  const body = sections.join('\n\n')
  return [
    `<system_prompt_update priority="high" source="lecquy" base_snapshot_id="${escapeXmlAttribute(input.baseSnapshotId)}" generated_at="${escapeXmlAttribute(input.generatedAt)}">`,
    body,
    '</system_prompt_update>',
  ].join('\n')
}

function hasUpdateChanges(changes: SystemPromptUpdateChanges): boolean {
  return Boolean(
    changes.currentDate
    || changes.runtime
    || changes.editableContext?.length
    || changes.activeSkill
    || changes.blockedSourceChanges?.length,
  )
}

function summarizeUserContext(content: string): string {
  const parsed = parseUserMd(content)
  if (parsed.rejected) {
    return `USER.md rejected: ${parsed.rejectReason ?? 'untrusted_schema'}`
  }

  const lines: string[] = []
  if (parsed.profileSlice.trim()) {
    lines.push(`Profile: ${truncateSummary(parsed.profileSlice.trim(), SUMMARY_CHAR_LIMIT)}`)
  }
  if (parsed.preferenceSlice.trim()) {
    lines.push(`Preference: ${truncateSummary(parsed.preferenceSlice.trim(), SUMMARY_CHAR_LIMIT)}`)
  }

  return lines.length > 0 ? lines.join('\n') : 'Current effective content cleared.'
}

function summarizePlainContext(content: string): string {
  const normalized = content.trim()
  return normalized ? truncateSummary(normalized, SUMMARY_CHAR_LIMIT) : 'Current effective content cleared.'
}

function truncateSummary(content: string, maxChars: number): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function areHashRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
}

function indentBlock(content: string, prefix: string): string {
  return content
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function sanitizeBodyText(content: string): string {
  return content.replace(/\r\n/g, '\n').replaceAll('</system_prompt_update>', '<\\/system_prompt_update>')
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
