// 中文：本文件（system-prompt-update-runtime.test.ts）验证 runtime 中 SystemPromptUpdate 的注入顺序、审计落点和 corrupt snapshot 降级。
// English: This file (system-prompt-update-runtime.test.ts) verifies runtime SystemPromptUpdate injection order, audit storage, and corrupt snapshot fallback.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentMessage, AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import type { Env } from '../../config/index.js'
import { ensurePromptContextFiles, resolvePromptContextPaths } from '../../core/prompts/context-files.js'
import {
  SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE,
  buildFrozenSystemSnapshot,
  isSystemPromptSnapshotEntryData,
  type SystemPromptSnapshotEntryData,
} from '../../core/prompts/system-prompt-snapshot.js'
import type { SystemPromptUpdatePhase } from '../../core/prompts/system-prompt-update.js'
import { buildReplayMessagesFromAugmentations } from '../context/prompt-frame-builder.js'
import {
  RUNTIME_AUGMENTATION_CUSTOM_TYPE,
  getRuntimeAugmentationsForPromptFrame,
  isRuntimeAugmentationEntryData,
} from '../context/runtime-augmentation.js'
import { SessionManager } from '../pi-session-core/session-manager.js'
import { SessionRuntimeService } from '../session-runtime-service.js'

function createMockTool(name: string, description: string): AgentTool<any> {
  return {
    name,
    label: description,
    description,
    parameters: {} as never,
    execute: async (): Promise<AgentToolResult<Record<string, never>>> => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    }),
  }
}

function createTestConfig(sessionStoreDir: string): Env {
  return {
    BACKEND_PORT: 3000,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://example.com/v1/',
    LLM_MODEL: 'Qwen3',
    LLM_TEMPERATURE: 0.7,
    LLM_MAX_TOKENS: 8192,
    LLM_TIMEOUT: 120000,
    COMPACTION_TIMEOUT_MS: 60000,
    LOG_LEVEL: 'error',
    SESSION_MAIN_KEY: 'main',
    SESSION_RESET_MODE: 'daily',
    SESSION_RESET_AT_HOUR: 4,
    SESSION_IDLE_MINUTES: 120,
    SESSION_STORE_DIR: sessionStoreDir,
    SESSION_PRUNING_MODE: 'off',
    SESSION_PRUNING_TTL: '5m',
    SESSION_PRUNING_KEEP_LAST_ASSISTANTS: 3,
    SESSION_PRUNING_SOFT_RATIO: 0.3,
    SESSION_PRUNING_HARD_RATIO: 0.5,
    SESSION_PRUNING_MIN_TOOL_CHARS: 50000,
  }
}

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'lecquy-runtime-update-'))
  await mkdir(path.join(workspaceDir, 'docs', 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'docs', 'README.md'), '# Docs\n', 'utf8')
  await mkdir(path.join(workspaceDir, 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'backend', 'AGENTS.md'), '# Backend AGENTS\n', 'utf8')
  await ensurePromptContextFiles(workspaceDir)
  return workspaceDir
}

function getBuildRunPromptContext(service: SessionRuntimeService) {
  return (service as unknown as {
    buildRunPromptContext(
      request: {
        sessionId: string
        manager: SessionManager
        role: 'simple' | 'manager' | 'worker'
        mode: 'simple' | 'plan'
        route?: { channel: string; chatType: string; peerId: string; userTimezone?: string }
        modelId: string
        thinkingLevel: 'off' | 'low' | 'medium' | 'high'
        tools: ReadonlyArray<AgentTool<any>>
        toolsEnabled: boolean
        extraInstructions?: string
      },
      baseContextMessages: AgentMessage[],
      options: {
        phase?: SystemPromptUpdatePhase
        targetMessageId: string
        runId: string
        stepId?: string
        memoryRecallMessages?: AgentMessage[]
        currentUserMessage: AgentMessage
      },
    ): Promise<{
      systemPrompt: string
      contextMessages: AgentMessage[]
      update?: { serializedText: string }
      augmentations: Array<{
        augmentationKind: 'retrieved_memory' | 'system_prompt_update' | 'plan_task_result'
        promptFrameId: string
        targetMessageId: string
        stepId?: string
        ordinal: number
        content: string
        contentHash: string
      }>
      frame: {
        promptFrameId: string
        replayMessages: readonly AgentMessage[]
        augmentations: readonly unknown[]
      }
    }>
  }).buildRunPromptContext.bind(service)
}

function createPromptFrameOptions(overrides: Partial<{
  phase: SystemPromptUpdatePhase
  targetMessageId: string
  runId: string
  stepId: string
  memoryRecallMessages: AgentMessage[]
  additionalAugmentations: Array<{
    augmentationKind: 'retrieved_memory' | 'system_prompt_update' | 'plan_task_result'
    content: string
    stepId?: string
  }>
  currentUserMessage: AgentMessage
}> = {}) {
  return {
    phase: overrides.phase ?? 'normal',
    targetMessageId: overrides.targetMessageId ?? 'msg_current',
    runId: overrides.runId ?? 'run_test',
    stepId: overrides.stepId,
    memoryRecallMessages: overrides.memoryRecallMessages ?? [],
    additionalAugmentations: overrides.additionalAugmentations ?? [],
    currentUserMessage: overrides.currentUserMessage ?? {
      role: 'user' as const,
      content: 'current user input',
      timestamp: 1,
    },
  }
}

function userMd(profile: string): string {
  return [
    '---',
    'schema: lecquy.user/v1',
    '---',
    '## Profile',
    profile,
    '',
  ].join('\n')
}

test('runtime appends update before current user input and stores audit as custom entry only', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'true'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir

    const service = new SessionRuntimeService(createTestConfig('.lecquy/sessions-test'))
    const buildRunPromptContext = getBuildRunPromptContext(service)
    const tools = [createMockTool('read_file', '读取文件')]
    const request = {
      sessionId: manager.getSessionId(),
      manager,
      role: 'simple' as const,
      mode: 'simple' as const,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'Asia/Shanghai' },
      modelId: 'Qwen3',
      thinkingLevel: 'medium' as const,
      tools,
      toolsEnabled: true,
    }

    const targetMessageId = 'msg_user_1'
    await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId,
      currentUserMessage: {
        role: 'user',
        content: 'first user input',
        timestamp: 1,
      },
    }))
    await writeFile(paths.userFile, userMd('kira 正在验证 update 顺序。'), 'utf8')
    const baseContextMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'stable session history' }],
      timestamp: 0,
    }
    const memoryRecallMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: '<retrieved_memory priority="low" source="lecquy">\nmemory recall context\n</retrieved_memory>' }],
      timestamp: 0,
    }
    const currentUserMessage: AgentMessage = {
      role: 'user',
      content: 'current user input',
      timestamp: 2,
    }
    const result = await buildRunPromptContext(request, [baseContextMessage], createPromptFrameOptions({
      targetMessageId,
      runId: 'run_runtime_order',
      memoryRecallMessages: [memoryRecallMessage],
      currentUserMessage,
    }))

    assert.equal(result.contextMessages.length, 3)
    assert.equal(result.contextMessages[0], baseContextMessage)
    assert.match(JSON.stringify(result.contextMessages[1].content), /retrieved_memory/)
    assert.match(JSON.stringify(result.contextMessages[2].content), /system_prompt_update/)
    assert.deepEqual(result.frame.replayMessages, [...result.contextMessages, currentUserMessage])
    assert.deepEqual(result.augmentations.map((augmentation) => augmentation.augmentationKind), [
      'retrieved_memory',
      'system_prompt_update',
    ])
    assert.ok(result.frame.promptFrameId.startsWith('frame_run_runtime_order_simple_normal_'))
    assert.equal(result.augmentations[0]?.promptFrameId, result.frame.promptFrameId)
    assert.equal(result.augmentations[1]?.promptFrameId, result.frame.promptFrameId)
    assert.equal(result.augmentations[0]?.targetMessageId, targetMessageId)
    assert.equal(result.augmentations[0]?.ordinal, 0)
    assert.equal(result.augmentations[1]?.ordinal, 1)
    assert.match(result.update?.serializedText ?? '', /USER\.md current effective content/)

    const runtimeAugmentationEntries = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === RUNTIME_AUGMENTATION_CUSTOM_TYPE)
      .map((entry) => entry.type === 'custom' ? entry.data : undefined)
      .filter(isRuntimeAugmentationEntryData)
    const visibleRuntimeAugmentationEntries = manager.getEntries()
      .filter((entry) => entry.type === 'custom_message' && entry.customType === RUNTIME_AUGMENTATION_CUSTOM_TYPE)

    assert.equal(runtimeAugmentationEntries.length, 2)
    assert.equal(runtimeAugmentationEntries[0]?.contentHash, result.augmentations[0]?.contentHash)
    assert.equal(runtimeAugmentationEntries[0]?.runId, 'run_runtime_order')
    assert.equal(runtimeAugmentationEntries[0]?.visible, false)
    assert.equal(visibleRuntimeAugmentationEntries.length, 0)
    assert.equal(isRuntimeAugmentationEntryData({
      ...runtimeAugmentationEntries[0],
      augmentationKind: 'unknown',
    }), false)
    assert.equal(isRuntimeAugmentationEntryData({
      ...runtimeAugmentationEntries[0],
      ordinal: -1,
    }), false)
    assert.equal(isRuntimeAugmentationEntryData({
      ...runtimeAugmentationEntries[0],
      createdAt: 'not-a-date',
    }), false)
    assert.equal(isRuntimeAugmentationEntryData({
      ...runtimeAugmentationEntries[1],
      source: {
        ...runtimeAugmentationEntries[1]?.source,
        sourceHashBefore: [],
      },
    }), false)
    assert.equal(isRuntimeAugmentationEntryData({
      ...runtimeAugmentationEntries[1],
      source: {
        ...runtimeAugmentationEntries[1]?.source,
        sourceHashNow: 'not-object',
      },
    }), false)

    const reconstructed = buildReplayMessagesFromAugmentations({
      historyMessages: [baseContextMessage],
      augmentations: getRuntimeAugmentationsForPromptFrame(manager.getEntries(), result.frame.promptFrameId),
      currentUserMessage,
    })
    assert.deepEqual(reconstructed, result.frame.replayMessages)
  } finally {
    if (previousLayeredPrompt === undefined) delete process.env.LAYERED_PROMPT
    else process.env.LAYERED_PROMPT = previousLayeredPrompt
    if (previousWorkspaceRoot === undefined) delete process.env.LECQUY_WORKSPACE_ROOT
    else process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('compact absorbs current USER update into fresh snapshot and later USER changes stay incremental', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'true'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir
    await writeFile(paths.userFile, userMd('compact 前初始 USER 内容。'), 'utf8')

    const service = new SessionRuntimeService(createTestConfig('.lecquy/sessions-test'))
    const buildRunPromptContext = getBuildRunPromptContext(service)
    const tools = [createMockTool('read_file', '读取文件')]
    const request = {
      sessionId: manager.getSessionId(),
      manager,
      role: 'simple' as const,
      mode: 'simple' as const,
      modelId: 'Qwen3',
      thinkingLevel: 'medium' as const,
      tools,
      toolsEnabled: true,
    }

    await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_compact_first',
      runId: 'run_compact_first',
    }))
    await writeFile(paths.userFile, userMd('compact 前等待吸收的 USER 内容。'), 'utf8')
    const beforeCompact = await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_compact_update',
      runId: 'run_compact_update',
    }))
    const keptId = manager.appendMessage({
      role: 'user',
      content: 'compact 后保留的尾部消息',
      timestamp: Date.now(),
    })
    manager.appendCompaction('compact summary', keptId, 1234)
    const afterCompact = await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_after_compact',
      runId: 'run_after_compact',
    }))
    await writeFile(paths.userFile, userMd('compact 后新修改的 USER 内容。'), 'utf8')
    const afterUserChange = await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_after_compact_user_change',
      runId: 'run_after_compact_user_change',
    }))
    const snapshotEntries = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE)
    const latestSnapshotEntry = snapshotEntries.at(-1)
    const latestSnapshotData = latestSnapshotEntry?.type === 'custom' ? latestSnapshotEntry.data : undefined

    assert.match(beforeCompact.update?.serializedText ?? '', /compact 前等待吸收的 USER 内容/)
    assert.equal(afterCompact.update, undefined)
    assert.match(afterCompact.systemPrompt, /compact 前等待吸收的 USER 内容/)
    assert.match(afterUserChange.update?.serializedText ?? '', /compact 后新修改的 USER 内容/)
    assert.doesNotMatch(afterUserChange.update?.serializedText ?? '', /compact 前等待吸收的 USER 内容/)
    assert.equal(snapshotEntries.length, 2)
    assert.equal(isSystemPromptSnapshotEntryData(latestSnapshotData), true)
    if (isSystemPromptSnapshotEntryData(latestSnapshotData)) {
      assert.equal(latestSnapshotData.snapshot.createdReason, 'compact')
    }
  } finally {
    if (previousLayeredPrompt === undefined) delete process.env.LAYERED_PROMPT
    else process.env.LAYERED_PROMPT = previousLayeredPrompt
    if (previousWorkspaceRoot === undefined) delete process.env.LECQUY_WORKSPACE_ROOT
    else process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('plan final answer reuses simple snapshot and carries final directive in update', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'true'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir

    const service = new SessionRuntimeService(createTestConfig('.lecquy/sessions-test'))
    const buildRunPromptContext = getBuildRunPromptContext(service)
    const tools = [createMockTool('read_file', '读取文件')]
    const request = {
      sessionId: manager.getSessionId(),
      manager,
      role: 'simple' as const,
      mode: 'simple' as const,
      modelId: 'Qwen3',
      thinkingLevel: 'medium' as const,
      tools,
      toolsEnabled: true,
    }
    const first = await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_plan_final',
      runId: 'run_plan_first',
      currentUserMessage: {
        role: 'user',
        content: 'plan first prompt',
        timestamp: 1,
      },
    }))
    const finalDirective = '你正在完成 plan 工作流的最终答复阶段。直接回答用户。'
    const final = await buildRunPromptContext({
      ...request,
      mode: 'plan',
      tools: [],
      toolsEnabled: false,
      extraInstructions: finalDirective,
    }, [], createPromptFrameOptions({
      phase: 'plan_final_answer',
      targetMessageId: 'msg_plan_final',
      runId: 'run_plan_final',
      additionalAugmentations: [{
        augmentationKind: 'plan_task_result',
        content: '<plan_task_result source="lecquy" todo_id="todo-1" status="completed">\n任务 1 执行结果：ok\n</plan_task_result>',
      }],
      currentUserMessage: {
        role: 'user',
        content: 'final answer prompt',
        timestamp: 2,
      },
    }))
    const snapshotEntries = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE)

    assert.equal(final.systemPrompt, first.systemPrompt)
    assert.equal(snapshotEntries.length, 1)
    assert.match(final.update?.serializedText ?? '', /plan_final_answer/)
    assert.match(final.update?.serializedText ?? '', /最终答复阶段/)
    assert.match(JSON.stringify(final.contextMessages.at(-2)?.content), /system_prompt_update/)
    assert.match(JSON.stringify(final.contextMessages.at(-1)?.content), /plan_task_result/)
    assert.deepEqual(getRuntimeAugmentationsForPromptFrame(manager.getEntries(), final.frame.promptFrameId)
      .map((augmentation) => augmentation.augmentationKind), ['system_prompt_update', 'plan_task_result'])
  } finally {
    if (previousLayeredPrompt === undefined) delete process.env.LAYERED_PROMPT
    else process.env.LAYERED_PROMPT = previousLayeredPrompt
    if (previousWorkspaceRoot === undefined) delete process.env.LECQUY_WORKSPACE_ROOT
    else process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('worker replay frame places memory and update before todo snapshot', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'true'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir

    const service = new SessionRuntimeService(createTestConfig('.lecquy/sessions-test'))
    const buildRunPromptContext = getBuildRunPromptContext(service)
    const tools = [createMockTool('edit_file', '编辑文件')]
    const request = {
      sessionId: manager.getSessionId(),
      manager,
      role: 'worker' as const,
      mode: 'plan' as const,
      modelId: 'Qwen3',
      thinkingLevel: 'medium' as const,
      tools,
      toolsEnabled: true,
    }

    await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_worker',
      runId: 'run_worker_first',
      currentUserMessage: {
        role: 'user',
        content: 'first todo snapshot',
        timestamp: 1,
      },
    }))
    await writeFile(paths.userFile, userMd('worker 阶段必须在 todo 前接收 update。'), 'utf8')

    const memoryRecallMessage: AgentMessage = {
      role: 'user',
      content: '<retrieved_memory priority="low" source="lecquy">\nworker memory\n</retrieved_memory>',
      timestamp: 0,
    }
    const todoSnapshot: AgentMessage = {
      role: 'user',
      content: '执行 todo snapshot',
      timestamp: 2,
    }
    const result = await buildRunPromptContext(request, [], createPromptFrameOptions({
      targetMessageId: 'msg_worker',
      runId: 'run_worker_update',
      stepId: 'step_worker_1',
      phase: 'worker',
      memoryRecallMessages: [memoryRecallMessage],
      currentUserMessage: todoSnapshot,
    }))

    assert.equal(result.contextMessages.length, 2)
    assert.match(JSON.stringify(result.contextMessages[0]?.content), /retrieved_memory/)
    assert.match(JSON.stringify(result.contextMessages[1]?.content), /system_prompt_update/)
    assert.deepEqual(result.frame.replayMessages, [...result.contextMessages, todoSnapshot])
    assert.equal(result.augmentations[0]?.stepId, 'step_worker_1')
    assert.equal(result.augmentations[1]?.stepId, 'step_worker_1')
  } finally {
    if (previousLayeredPrompt === undefined) delete process.env.LAYERED_PROMPT
    else process.env.LAYERED_PROMPT = previousLayeredPrompt
    if (previousWorkspaceRoot === undefined) delete process.env.LECQUY_WORKSPACE_ROOT
    else process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('runtime ignores corrupt snapshot before building update context', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'true'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir

    const tools = [createMockTool('read_file', '读取文件')]
    const validSnapshot = await buildFrozenSystemSnapshot({
      sessionId: manager.getSessionId(),
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      thinkingLevel: 'medium',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    manager.appendCustomEntry(SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE, {
      kind: SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE,
      snapshot: {
        ...validSnapshot,
        systemText: 'corrupted system text',
      },
    } satisfies SystemPromptSnapshotEntryData)

    const service = new SessionRuntimeService(createTestConfig('.lecquy/sessions-test'))
    const result = await getBuildRunPromptContext(service)({
      sessionId: manager.getSessionId(),
      manager,
      role: 'simple',
      mode: 'simple',
      modelId: 'Qwen3',
      thinkingLevel: 'medium',
      tools,
      toolsEnabled: true,
    }, [], createPromptFrameOptions({
      targetMessageId: 'msg_corrupt',
      runId: 'run_corrupt',
    }))
    const snapshotEntries = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE)

    assert.notEqual(result.systemPrompt, 'corrupted system text')
    assert.equal(result.update, undefined)
    assert.deepEqual(result.augmentations, [])
    assert.equal(snapshotEntries.length, 2)
  } finally {
    if (previousLayeredPrompt === undefined) delete process.env.LAYERED_PROMPT
    else process.env.LAYERED_PROMPT = previousLayeredPrompt
    if (previousWorkspaceRoot === undefined) delete process.env.LECQUY_WORKSPACE_ROOT
    else process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
