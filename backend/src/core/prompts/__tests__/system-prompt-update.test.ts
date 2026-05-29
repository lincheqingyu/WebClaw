// 中文：本文件（system-prompt-update.test.ts）验证 SystemPromptUpdate 的 cumulative 变化检测、序列化和 source hash 分类。
// English: This file (system-prompt-update.test.ts) verifies cumulative SystemPromptUpdate change detection, serialization, and source hash classification.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { ensurePromptContextFiles, resolvePromptContextPaths } from '../context-files.js'
import { buildFrozenSystemSnapshot } from '../system-prompt-snapshot.js'
import { buildSystemPromptUpdate } from '../system-prompt-update.js'

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

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'lecquy-update-'))
  await mkdir(path.join(workspaceDir, 'docs', 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'docs', 'README.md'), '# Docs\n', 'utf8')
  await mkdir(path.join(workspaceDir, 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'backend', 'AGENTS.md'), '# Backend AGENTS\n', 'utf8')
  await ensurePromptContextFiles(workspaceDir)
  return workspaceDir
}

function userMd(profile: string, preference = ''): string {
  return [
    '---',
    'schema: lecquy.user/v1',
    '---',
    '## Profile',
    profile,
    '',
    '## Preference',
    preference,
    '',
  ].join('\n')
}

test('buildSystemPromptUpdate returns null when nothing changed since snapshot', async () => {
  const workspaceDir = await createWorkspace()
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_null',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'Asia/Shanghai' },
      modelId: 'Qwen3',
      thinkingLevel: 'medium',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'Asia/Shanghai' },
      modelId: 'Qwen3',
      thinkingLevel: 'medium',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.equal(update, null)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('USER.md changes produce current effective content without mutating snapshot system text', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    await writeFile(paths.userFile, userMd('kira 正在开发 Lecquy。', '偏好 SQLite。'), 'utf8')
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_user',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'Asia/Shanghai' },
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    const frozenText = snapshot.systemText

    await writeFile(paths.userFile, userMd('kira 正在开发 Lecquy 后端。', '偏好 SQLite over PostgreSQL。'), 'utf8')
    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'Asia/Shanghai' },
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.equal(snapshot.systemText, frozenText)
    assert.ok(update)
    assert.match(update.serializedText, /USER\.md current effective content/)
    assert.match(update.serializedText, /Profile: kira 正在开发 Lecquy 后端/)
    assert.match(update.serializedText, /Preference: 偏好 SQLite over PostgreSQL/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('USER.md update is cumulative since snapshot, not delta since previous update', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    await writeFile(paths.userFile, userMd('初始画像。'), 'utf8')
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_cumulative',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    await writeFile(paths.userFile, userMd('X：正在实现 P2。'), 'utf8')
    const firstUpdate = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    await writeFile(paths.userFile, userMd('X：正在实现 P2。\nY：需要保持 snapshot 稳定。'), 'utf8')
    const secondUpdate = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.match(firstUpdate?.serializedText ?? '', /X：正在实现 P2/)
    assert.match(secondUpdate?.serializedText ?? '', /X：正在实现 P2/)
    assert.match(secondUpdate?.serializedText ?? '', /Y：需要保持 snapshot 稳定/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('USER.md deletion removes stale content from latest cumulative update', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    await writeFile(paths.userFile, userMd('初始画像。'), 'utf8')
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_delete',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    await writeFile(paths.userFile, userMd('X：临时内容。'), 'utf8')
    assert.match((await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    }))?.serializedText ?? '', /X：临时内容/)

    await writeFile(paths.userFile, '', 'utf8')
    const latestUpdate = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.ok(latestUpdate)
    assert.doesNotMatch(latestUpdate.serializedText, /X：临时内容/)
    assert.match(latestUpdate.serializedText, /Current effective content cleared/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('cross-day update reports current date while snapshot system text stays frozen', async () => {
  const workspaceDir = await createWorkspace()
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_date',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'UTC' },
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T23:30:00.000Z'),
    })
    const frozenText = snapshot.systemText
    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'UTC' },
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-19T00:10:00.000Z'),
    })

    assert.equal(snapshot.systemText, frozenText)
    assert.match(update?.serializedText ?? '', /Current date: 2026-05-19/)
    assert.match(update?.serializedText ?? '', /Time zone: UTC/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('timezone update is emitted when snapshot had no timezone and current request provides one', async () => {
  const workspaceDir = await createWorkspace()
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_timezone_late',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      route: { channel: 'webchat', chatType: 'dm', peerId: 'peer', userTimezone: 'Asia/Shanghai' },
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T02:02:03.000Z'),
    })

    assert.ok(update)
    assert.match(update.serializedText, /Current date: 2026-05-18/)
    assert.match(update.serializedText, /Time zone: Asia\/Shanghai/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('runtime mode tools extra instructions and phase changes are serialized', async () => {
  const workspaceDir = await createWorkspace()
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_runtime',
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
    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'plan',
      workspaceDir,
      modelId: 'Qwen3',
      thinkingLevel: 'high',
      tools,
      toolsEnabled: false,
      extraInstructions: '你正在完成 plan 工作流的最终答复阶段。',
      phase: 'plan_final_answer',
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.match(update?.serializedText ?? '', /Runtime updates since snapshot/)
    assert.match(update?.serializedText ?? '', /Current mode: plan/)
    assert.match(update?.serializedText ?? '', /Thinking level: high/)
    assert.match(update?.serializedText ?? '', /Tools enabled: false/)
    assert.match(update?.serializedText ?? '', /Current phase: plan_final_answer/)
    assert.match(update?.serializedText ?? '', /最终答复阶段/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('prompt module and tool inventory changes are blocked source changes only', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_blocked',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    await mkdir(path.join(paths.rootDir, 'system-prompt'), { recursive: true })
    await writeFile(path.join(paths.rootDir, 'system-prompt', 'identity-simple.md'), '新的 identity 模板。', 'utf8')
    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools: [createMockTool('read_file', '读取文件 v2')],
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.match(update?.serializedText ?? '', /Source changes detected but not applied through update/)
    assert.match(update?.serializedText ?? '', /promptModules changed/)
    assert.match(update?.serializedText ?? '', /toolInventory changed/)
    assert.doesNotMatch(update?.serializedText ?? '', /Current mode:/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('serialized update omits empty placeholders', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  try {
    const tools = [createMockTool('read_file', '读取文件')]
    const snapshot = await buildFrozenSystemSnapshot({
      sessionId: 'session_update_placeholders',
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    await writeFile(paths.userFile, userMd('kira 使用 Lecquy。'), 'utf8')
    const update = await buildSystemPromptUpdate({
      snapshot,
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools,
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })

    assert.ok(update)
    assert.doesNotMatch(update.serializedText, /\bnone\b/i)
    assert.doesNotMatch(update.serializedText, /\bnull\b/i)
    assert.equal(update.contentHash.length, 64)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
