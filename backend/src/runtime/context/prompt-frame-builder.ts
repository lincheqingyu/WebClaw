// 中文：本文件（prompt-frame-builder.ts）把可见历史、runtime augmentation 与当前 user message 组装成可重放 prompt frame。
// English: This file (prompt-frame-builder.ts) assembles visible history, runtime augmentations, and the current user message into a replayable prompt frame.

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { createRuntimeAugmentationMessage, type RuntimeAugmentationEntryData } from './runtime-augmentation.js'

export interface RuntimePromptFrame {
  readonly promptFrameId: string
  readonly systemPrompt: string
  readonly systemSnapshotId?: string
  readonly systemPromptHash: string
  readonly currentVisibleMessage: AgentMessage
  readonly replayMessages: readonly AgentMessage[]
  readonly augmentations: readonly RuntimeAugmentationEntryData[]
}

export interface RuntimePromptFrameInput {
  readonly promptFrameId: string
  readonly systemPrompt: string
  readonly systemSnapshotId?: string
  readonly systemPromptHash: string
  readonly currentVisibleMessage: AgentMessage
  readonly historyMessages: readonly AgentMessage[]
  readonly augmentations: readonly RuntimeAugmentationEntryData[]
  readonly currentUserMessage: AgentMessage
}

export interface AiRequestPromptFrameMeta {
  readonly promptFrameId: string
  readonly systemSnapshotId?: string
  readonly systemPromptHash: string
  readonly replayMessageCount: number
  readonly augmentations: ReadonlyArray<{
    readonly augmentationKind: RuntimeAugmentationEntryData['augmentationKind']
    readonly promptFrameId: string
    readonly contentHash: string
    readonly targetMessageId: string
    readonly ordinal: number
  }>
}

export function buildRuntimePromptFrame(input: RuntimePromptFrameInput): RuntimePromptFrame {
  const orderedAugmentations = [...input.augmentations].sort((left, right) => left.ordinal - right.ordinal)
  const augmentationMessages = orderedAugmentations.map(createRuntimeAugmentationMessage)

  return {
    promptFrameId: input.promptFrameId,
    systemPrompt: input.systemPrompt,
    systemSnapshotId: input.systemSnapshotId,
    systemPromptHash: input.systemPromptHash,
    currentVisibleMessage: input.currentVisibleMessage,
    replayMessages: [
      ...input.historyMessages,
      ...augmentationMessages,
      input.currentUserMessage,
    ],
    augmentations: orderedAugmentations,
  }
}

export function buildReplayMessagesFromAugmentations(input: {
  readonly historyMessages: readonly AgentMessage[]
  readonly augmentations: readonly RuntimeAugmentationEntryData[]
  readonly currentUserMessage: AgentMessage
}): AgentMessage[] {
  return [
    ...input.historyMessages,
    ...[...input.augmentations]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(createRuntimeAugmentationMessage),
    input.currentUserMessage,
  ]
}

export function toAiRequestPromptFrameMeta(frame: RuntimePromptFrame): AiRequestPromptFrameMeta {
  return {
    promptFrameId: frame.promptFrameId,
    systemSnapshotId: frame.systemSnapshotId,
    systemPromptHash: frame.systemPromptHash,
    replayMessageCount: frame.replayMessages.length,
    augmentations: frame.augmentations.map((augmentation) => ({
      augmentationKind: augmentation.augmentationKind,
      promptFrameId: augmentation.promptFrameId,
      contentHash: augmentation.contentHash,
      targetMessageId: augmentation.targetMessageId,
      ordinal: augmentation.ordinal,
    })),
  }
}
