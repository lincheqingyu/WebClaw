// 中文：本文件验证 AI request log 同时保留 provider-neutral promptFrame 与最终 provider payload。
// English: This file verifies AI request logs keep provider-neutral promptFrame metadata together with final provider payload.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { Model } from '@mariozechner/pi-ai'
import { createRunId } from '@lecquy/shared'
import { logAiRequestSnapshot } from './ai-request-logger.js'

function createModel(): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'test-model',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
    compat: {},
  }
}

test('logAiRequestSnapshot writes promptFrame metadata and final provider payload', async () => {
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const previousAiRequestLog = process.env.AI_REQUEST_LOG
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'lecquy-ai-request-log-'))

  try {
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir
    process.env.AI_REQUEST_LOG = 'true'
    const payload = {
      stream: true,
      tool_stream: true,
      messages: [{ role: 'user', content: 'current input' }],
    }

    logAiRequestSnapshot({
      role: 'simple',
      model: createModel(),
      systemPrompt: 'stable system prompt',
      promptMessages: [{ role: 'user', content: 'current input', timestamp: 1 }],
      contextMessages: [],
      sessionKey: 'session-key',
      sessionId: 'session-id',
      runId: createRunId(),
      promptFrame: {
        promptFrameId: 'frame_test',
        systemSnapshotId: 'snapshot_test',
        systemPromptHash: 'a'.repeat(64),
        replayMessageCount: 1,
        augmentations: [],
      },
      providerPayloadMutation: {
        providerFlavor: 'bigmodel',
        payloadMutationApplied: true,
        cacheControlApplied: false,
      },
    }, payload)

    const logDir = path.join(workspaceDir, '.lecquy', 'logs', 'ai-requests')
    const files = await readdir(logDir)
    assert.equal(files.length, 1)
    const snapshot = JSON.parse(await readFile(path.join(logDir, files[0] ?? ''), 'utf8')) as {
      promptFrame?: { promptFrameId?: string }
      providerFlavor?: string
      payloadMutationApplied?: boolean
      cacheControlApplied?: boolean
      payload?: { tool_stream?: boolean }
    }

    assert.equal(snapshot.promptFrame?.promptFrameId, 'frame_test')
    assert.equal(snapshot.providerFlavor, 'bigmodel')
    assert.equal(snapshot.payloadMutationApplied, true)
    assert.equal(snapshot.cacheControlApplied, false)
    assert.equal(snapshot.payload?.tool_stream, true)
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.LECQUY_WORKSPACE_ROOT
    else process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    if (previousAiRequestLog === undefined) delete process.env.AI_REQUEST_LOG
    else process.env.AI_REQUEST_LOG = previousAiRequestLog
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
