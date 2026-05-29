// 中文：本文件（provider-payload.test.ts）位于 backend/src/agent/provider-payload.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (provider-payload.test.ts) belongs to the backend 测试用例 layer in backend/src/agent/provider-payload.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import test from 'node:test'
import type { Model } from '@mariozechner/pi-ai'
import { inferProviderFlavor, mutateProviderPayload } from './provider-payload.js'

function createModel(baseUrl: string, provider = 'openai'): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'test-model',
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
    compat: {},
  }
}

test('inferProviderFlavor detects bigmodel and local vllm endpoints', () => {
  assert.equal(inferProviderFlavor('https://open.bigmodel.cn/api/paas/v4/'), 'bigmodel')
  assert.equal(inferProviderFlavor('http://127.0.0.1:8000/v1'), 'vllm')
  assert.equal(inferProviderFlavor('https://api.anthropic.com/v1/messages'), 'anthropic')
  assert.equal(inferProviderFlavor('https://example.com/v1', 'anthropic'), 'anthropic')
  assert.equal(inferProviderFlavor('https://example.com/v1'), 'openai_compatible')
})

test('mutateProviderPayload enables tool_stream for bigmodel requests with tools', () => {
  const payload: Record<string, unknown> = {
    stream: true,
    tools: [{ type: 'function' }],
  }

  const result = mutateProviderPayload(createModel('https://open.bigmodel.cn/api/paas/v4/'), payload)

  assert.equal(payload.tool_stream, true)
  assert.deepEqual(result, {
    providerFlavor: 'bigmodel',
    payloadMutationApplied: true,
    cacheControlApplied: false,
  })
})

test('mutateProviderPayload enables tool_stream for local vllm requests with tools', () => {
  const payload: Record<string, unknown> = {
    stream: true,
    tools: [{ type: 'function' }],
  }

  const result = mutateProviderPayload(createModel('http://127.0.0.1:8000/v1'), payload)

  assert.equal(payload.tool_stream, true)
  assert.deepEqual(result, {
    providerFlavor: 'vllm',
    payloadMutationApplied: true,
    cacheControlApplied: false,
  })
})

test('mutateProviderPayload keeps generic openai-compatible requests unchanged', () => {
  const payload: Record<string, unknown> = {
    stream: true,
    tools: [{ type: 'function' }],
  }

  const before = structuredClone(payload)
  const result = mutateProviderPayload(createModel('https://example.com/v1'), payload)

  assert.equal(payload.tool_stream, undefined)
  assert.deepEqual(payload, before)
  assert.deepEqual(result, {
    providerFlavor: 'openai_compatible',
    payloadMutationApplied: false,
    cacheControlApplied: false,
  })
  assert.equal(JSON.stringify(payload).includes('cache_control'), false)
})

test('mutateProviderPayload adds cache_control only for anthropic system payload', () => {
  const messages = [
    { role: 'user', content: '<retrieved_memory>memory</retrieved_memory>' },
    { role: 'user', content: '<system_prompt_update>update</system_prompt_update>' },
    { role: 'user', content: 'current input' },
  ]
  const payload: Record<string, unknown> = {
    system: 'stable system prompt',
    stream: true,
    messages,
  }

  const result = mutateProviderPayload(createModel('https://api.anthropic.com/v1/messages', 'anthropic'), payload)

  assert.deepEqual(result, {
    providerFlavor: 'anthropic',
    payloadMutationApplied: true,
    cacheControlApplied: true,
  })
  assert.deepEqual(payload.system, [{
    type: 'text',
    text: 'stable system prompt',
    cache_control: { type: 'ephemeral' },
  }])
  assert.equal(payload.messages, messages)
  assert.deepEqual(payload.messages, [
    { role: 'user', content: '<retrieved_memory>memory</retrieved_memory>' },
    { role: 'user', content: '<system_prompt_update>update</system_prompt_update>' },
    { role: 'user', content: 'current input' },
  ])
})

test('mutateProviderPayload keeps existing anthropic cache_control idempotent', () => {
  const systemBlock = {
    type: 'text',
    text: 'stable system prompt',
    cache_control: { type: 'ephemeral' },
  }
  const payload: Record<string, unknown> = {
    system: [systemBlock],
    stream: true,
    messages: [{ role: 'user', content: 'current input' }],
  }

  const result = mutateProviderPayload(createModel('https://api.anthropic.com/v1/messages', 'anthropic'), payload)

  assert.deepEqual(result, {
    providerFlavor: 'anthropic',
    payloadMutationApplied: false,
    cacheControlApplied: true,
  })
  assert.deepEqual(payload.system, [systemBlock])
})

test('mutateProviderPayload does not report cache_control when anthropic system has no text block', () => {
  const payload: Record<string, unknown> = {
    system: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }],
    stream: true,
    messages: [{ role: 'user', content: 'current input' }],
  }
  const before = structuredClone(payload)

  const result = mutateProviderPayload(createModel('https://api.anthropic.com/v1/messages', 'anthropic'), payload)

  assert.deepEqual(result, {
    providerFlavor: 'anthropic',
    payloadMutationApplied: false,
    cacheControlApplied: false,
  })
  assert.deepEqual(payload, before)
})
