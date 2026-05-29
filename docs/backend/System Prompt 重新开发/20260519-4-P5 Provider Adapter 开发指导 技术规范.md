# P5 Provider Adapter 开发指导

> 更新日期：2026-05-19
> 类型：技术规范
> 前置：[P4 Compact 与 Resnapshot 代码审查](./20260519-3-P4%20Compact%20与%20Resnapshot%20代码审查%20报告.md)

## 1. P5 目标

P5 的目标是把 provider 差异收敛在 adapter / payload 层，确认 OpenAI-compatible 是默认主路径，并为 Anthropic `cache_control` 留出明确边界。

完成后必须满足：

- 核心 prompt 数据结构仍然 provider-neutral。
- OpenAI-compatible / vLLM / BigModel 路径不出现 Anthropic 专属字段。
- Anthropic `cache_control` 只允许在 Anthropic adapter 内出现。
- `FrozenSystemSnapshot.systemText` 仍是普通字符串。
- `RuntimePromptFrame.replayMessages` 仍是 provider-neutral `AgentMessage[]`。
- AI request log 能同时看见核心 promptFrame 元数据和最终 provider payload。

## 2. 非目标

- 不引入多 provider gateway。
- 不做 OAuth / 鉴权 / 限流 / 租户隔离。
- 不重写 pi-agent-core 的 agent loop。
- 不改 snapshot / update / compact 语义。
- 不为了 Anthropic 重排核心 layer 或修改 system prompt 拼接格式。

## 3. 当前代码事实

当前后端模型请求链路是：

- `SessionRuntimeService.createModel` 创建 `Model<'openai-completions'>`。
- simple / manager / worker runner 调用 `agentLoop(messages, { systemPrompt, messages: contextMessages, tools }, ...)`。
- `provider-payload.ts` 只做 provider payload 小幅 mutation：BigModel / vLLM streaming tools 时补 `tool_stream=true`。
- `ai-request-logger.ts` 记录 `systemPrompt`、`promptMessages`、`contextMessages`、`promptFrame` 和最终 payload。

这意味着 P5 第一优先级不是“新增很多 adapter”，而是把边界固定住，避免未来把 `cache_control`、provider block 格式、特殊 tool result 映射写回核心 prompt builder。

## 4. Provider Flavor

建议扩展 `provider-payload.ts` 的 provider flavor：

```ts
export type ProviderFlavor =
  | 'openai_compatible'
  | 'vllm'
  | 'bigmodel'
  | 'anthropic'
```

识别规则：

- `bigmodel`：baseUrl 包含 `bigmodel.cn`。
- `vllm`：本地 / 私网 `/v1`，或 hostname 包含 `vllm`。
- `anthropic`：baseUrl 包含 `anthropic.com`，或后续 Model.provider 明确为 `anthropic`。
- `openai_compatible`：默认兜底。

不要把 flavor 写进 snapshot source hash；flavor 是发送层行为，不是 system prompt 内容来源。

## 5. Adapter 输入输出

核心层向 adapter 提供 provider-neutral 输入：

```ts
export interface ProviderPromptFrameInput {
  readonly systemPrompt: string
  readonly replayMessages: readonly AgentMessage[]
  readonly tools: readonly AgentTool<any>[]
  readonly promptFrame: AiRequestPromptFrameMeta
}
```

adapter 输出只服务 provider payload：

```ts
export interface ProviderPayloadMutationInput {
  readonly model: Model<'openai-completions'>
  readonly payload: Record<string, unknown>
  readonly promptFrame?: AiRequestPromptFrameMeta
}
```

现阶段可以不真的替换 agentLoop 的 payload 构造，只在 `onPayload` 的 `mutateProviderPayload` 中做 provider-specific mutation。但类型和测试要表达清楚：mutation 是 provider adapter 层，不是 core prompt builder。

## 6. OpenAI-Compatible 默认路径

OpenAI-compatible / vLLM / BigModel 路径必须保持：

- `system` 是普通 string 或 pi-ai 当前生成的 OpenAI-compatible system 字段。
- messages 是普通 user / assistant / toolResult 序列。
- `<retrieved_memory>`、`<system_prompt_update>`、`<plan_task_result>` 都以 synthetic user message 形式存在于 replay messages 中。
- 不出现 `cache_control`。
- 不出现 Anthropic content block。

BigModel / vLLM 特例仍只允许 payload 级兼容参数，例如当前的 `tool_stream=true`。

## 7. Anthropic Adapter 边界

如果 P5 实现 Anthropic adapter，只能在 adapter 层做：

- 把 `systemPrompt` 转为 Anthropic system content block。
- 在 snapshot 边界上添加 `cache_control`。
- 把 provider-neutral tool result 转成 Anthropic 所需格式。

禁止：

- 在 `FrozenSystemSnapshot` 中加入 `cache_control`。
- 在 `SystemPromptUpdate` 中加入 provider 字段。
- 在 prompt layer / serializer 中判断 Anthropic。
- 为 Anthropic 改变 OpenAI-compatible 的 replay message 顺序。

Anthropic cache 建议：

```ts
{
  type: 'text',
  text: frame.systemPrompt,
  cache_control: { type: 'ephemeral' }
}
```

这只是 adapter 输出，不回写 session event tree。

## 8. AI Request Log

`logAiRequestSnapshot` 继续记录：

- core `systemPrompt`
- provider-neutral `promptFrame`
- provider payload

P5 可补充：

- `providerFlavor`
- `payloadMutationApplied`
- `cacheControlApplied`

日志字段是调试信息，不进入 `FrozenSystemSnapshot` / `RuntimePromptFrame`。

## 9. 测试要求

新增或更新测试：

1. OpenAI-compatible payload 不包含 `cache_control`。
2. vLLM / BigModel streaming tools 仍会补 `tool_stream=true`。
3. generic OpenAI-compatible payload 不被额外 mutation。
4. Anthropic adapter 如实现，`cache_control` 只出现在 adapter payload。
5. `rg "cache_control" backend/src/core/prompts backend/src/runtime/context` 无核心 prompt 命中。
6. `FrozenSystemSnapshot`、`SystemPromptUpdate`、`RuntimePromptFrame` 类型不新增 provider 专属字段。
7. AI request log 同时包含 `promptFrame.promptFrameId` 和最终 payload。
8. synthetic user context 的 replay 顺序在 provider mutation 后不变。

## 10. 验收标准

P5 完成后：

- OpenAI-compatible 主路径稳定，不受 Anthropic 设计影响。
- Provider 差异只存在于 `provider-payload.ts` 或明确命名的 adapter 文件。
- `cache_control` 不污染核心 prompt 数据结构。
- system prompt 重做链路从 P1 到 P5 闭环：snapshot 稳定、update 即时、replay 干净、compact 后 resnapshot、provider adapter 独立。

## 11. 明确禁止

- 不为 provider 差异新增 prompt layer。
- 不把 Anthropic block 结构存进 session event tree。
- 不把 `cache_control` 写进 `.lecquy/` 文件。
- 不为了 provider adapter 修改 MemoryRecall / SystemPromptUpdate tag。
- 不新增通用多租户 provider 配置系统。
