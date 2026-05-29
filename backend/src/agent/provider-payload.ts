// 中文：本文件（provider-payload.ts）位于 backend/src/agent/provider-payload.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (provider-payload.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/provider-payload.ts, wiring upstream callers with downstream runtime logic.

import type { Model } from '@mariozechner/pi-ai'
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core'
import type { AiRequestPromptFrameMeta } from '../runtime/context/prompt-frame-builder.js'
import { logger } from '../utils/logger.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export type ProviderFlavor =
  | 'openai_compatible'
  | 'vllm'
  | 'bigmodel'
  | 'anthropic'

export interface ProviderPromptFrameInput {
  readonly systemPrompt: string
  readonly replayMessages: readonly AgentMessage[]
  readonly tools: readonly AgentTool<any>[]
  readonly promptFrame: AiRequestPromptFrameMeta
}

export interface ProviderPayloadMutationInput {
  readonly model: Model<'openai-completions'>
  readonly payload: unknown
  readonly promptFrame?: AiRequestPromptFrameMeta
}

export interface ProviderPayloadMutationResult {
  readonly providerFlavor: ProviderFlavor
  readonly payloadMutationApplied: boolean
  readonly cacheControlApplied: boolean
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1'
}

function isPrivateIpv4Host(hostname: string): boolean {
  return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

function parseBaseUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl)
  } catch {
    return null
  }
}

export function isBigmodelBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('bigmodel.cn')
}

export function isAnthropicBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('anthropic.com')
}

export function isLikelyVllmBaseUrl(baseUrl: string): boolean {
  const parsed = parseBaseUrl(baseUrl)
  if (!parsed) return false

  const hostname = parsed.hostname.toLowerCase()
  if (hostname.includes('vllm')) return true

  const isLocalOrPrivateHost = isLoopbackHost(hostname) || isPrivateIpv4Host(hostname)
  const usesCanonicalOpenAiPath = parsed.pathname === '/v1' || parsed.pathname === '/v1/'

  return isLocalOrPrivateHost && usesCanonicalOpenAiPath
}

export function inferProviderFlavor(baseUrl: string, provider?: string): ProviderFlavor {
  const normalizedProvider = provider?.toLowerCase()
  if (normalizedProvider === 'anthropic' || normalizedProvider?.includes('anthropic') || isAnthropicBaseUrl(baseUrl)) {
    return 'anthropic'
  }
  if (isBigmodelBaseUrl(baseUrl)) return 'bigmodel'
  if (isLikelyVllmBaseUrl(baseUrl)) return 'vllm'
  return 'openai_compatible'
}

function isMutationInput(value: unknown): value is ProviderPayloadMutationInput {
  return isObject(value) && 'model' in value && 'payload' in value
}

function hasCacheControl(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasCacheControl)
  }
  if (!isObject(value)) {
    return false
  }
  if ('cache_control' in value) {
    return true
  }
  return Object.values(value).some(hasCacheControl)
}

function applyAnthropicSystemCacheControl(payload: Record<string, unknown>): boolean {
  const system = payload.system
  if (typeof system === 'string') {
    payload.system = [{
      type: 'text',
      text: system,
      cache_control: { type: 'ephemeral' },
    }]
    return true
  }

  if (!Array.isArray(system)) {
    return false
  }

  for (const block of system) {
    if (!isObject(block) || block.type !== 'text' || 'cache_control' in block) {
      continue
    }
    block.cache_control = { type: 'ephemeral' }
    return true
  }

  return false
}

export function mutateProviderPayload(input: ProviderPayloadMutationInput): ProviderPayloadMutationResult
export function mutateProviderPayload(
  model: Model<'openai-completions'>,
  payload: unknown,
): ProviderPayloadMutationResult
export function mutateProviderPayload(
  inputOrModel: ProviderPayloadMutationInput | Model<'openai-completions'>,
  maybePayload?: unknown,
): ProviderPayloadMutationResult {
  const input = isMutationInput(inputOrModel)
    ? inputOrModel
    : { model: inputOrModel, payload: maybePayload }
  const providerFlavor = inferProviderFlavor(input.model.baseUrl, input.model.provider)
  let payloadMutationApplied = false

  if (!isObject(input.payload)) {
    return {
      providerFlavor,
      payloadMutationApplied,
      cacheControlApplied: false,
    }
  }

  if (
    (providerFlavor === 'bigmodel' || providerFlavor === 'vllm')
    && Array.isArray(input.payload.tools)
    && input.payload.tools.length > 0
    && input.payload.stream === true
  ) {
    if (input.payload.tool_stream !== true) {
      input.payload.tool_stream = true
      payloadMutationApplied = true
      logger.info('启用 tool_stream 请求兼容参数', {
        modelId: input.model.id,
        baseUrl: input.model.baseUrl,
        providerFlavor,
      })
    }
  }

  if (providerFlavor === 'anthropic') {
    payloadMutationApplied = applyAnthropicSystemCacheControl(input.payload) || payloadMutationApplied
  }

  return {
    providerFlavor,
    payloadMutationApplied,
    cacheControlApplied: providerFlavor === 'anthropic' && hasCacheControl(input.payload.system),
  }
}
