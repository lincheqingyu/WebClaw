# P5 Provider Adapter 代码审查

> 更新日期：2026-05-19
> 类型：审查报告
> 前置：[P5 Provider Adapter 开发指导](./20260519-4-P5%20Provider%20Adapter%20开发指导%20技术规范.md)

## 1. 审查结论

P5 主目标已达成：provider 差异被收敛到 `backend/src/agent/provider-payload.ts` 的 payload mutation 层，核心 prompt / runtime context 没有引入 Anthropic 专属字段，AI request log 同时保留 provider-neutral `promptFrame` 和 mutation 后的最终 provider payload。

P4 审查里的 Finding 1 / Finding 2 也已补齐：

- compact boundary、snapshot restore、hot cache 复用已基于当前 branch path，而不是全量事件列表。
- snapshot cache 复用前会确认 snapshot entry 仍在当前 branch 上。
- runtime augmentation restore 会校验 `sourceHashBefore` / `sourceHashNow` 存在时必须是 plain object。

本次审查没有发现需要阻塞合入的 P0/P1 问题。P5 可以视为完成，system prompt 重新开发 P0-P5 主线可以收口。

## 2. 已完成项

代码已落地：

- `backend/src/agent/provider-payload.ts`
- `backend/src/agent/provider-payload.test.ts`
- `backend/src/agent/ai-request-logger.ts`
- `backend/src/agent/ai-request-logger.test.ts`
- `backend/src/agent/agent-runner.ts`
- `backend/src/agent/manager-runner.ts`
- `backend/src/agent/worker-runner.ts`
- `backend/src/runtime/session-runtime-service.ts`
- `backend/src/runtime/pi-session-core/session-manager.ts`
- `backend/src/runtime/__tests__/system-prompt-snapshot-runtime.test.ts`

关键行为：

- `ProviderFlavor` 已区分 `openai_compatible` / `vllm` / `bigmodel` / `anthropic`。
- BigModel / vLLM streaming tools 仍只在 payload 层补 `tool_stream=true`。
- Anthropic `cache_control` 只在 provider payload mutation 中添加，不进入 `FrozenSystemSnapshot` / `SystemPromptUpdate` / `RuntimePromptFrame`。
- simple / manager / worker runner 都在 `onPayload` 中先执行 provider mutation，再把最终 payload 和 mutation metadata 写入 AI request log。
- AI request log 新增 `providerFlavor`、`payloadMutationApplied`、`cacheControlApplied`。

验证由实现方报告通过：

```bash
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
git diff --check
rg "cache_control" backend/src/core/prompts backend/src/runtime/context
```

本次审查未重复跑全量测试。

## 3. Findings

### Finding 1：P5 只完成 provider payload mutation 边界，不等于 Anthropic 端到端 transport

严重级别：低，说明性边界

相关位置：

- `backend/src/agent/provider-payload.ts`
- `backend/src/agent/agent-runner.ts`
- `backend/src/agent/manager-runner.ts`
- `backend/src/agent/worker-runner.ts`

当前 `Model` 仍是 `Model<'openai-completions'>`，runner 仍通过 pi-agent-core 的 `agentLoop` 生成 OpenAI-compatible payload。P5 在 `onPayload` 阶段为 Anthropic baseUrl / provider 增加 `system.cache_control`，这是正确的 adapter 边界示范，但还不是完整 Anthropic request serializer。

因此后续不要把“P5 已支持 Anthropic cache_control”误读成“Anthropic API 已端到端可用”。如果未来真的启用 Anthropic 直连，需要单独设计 transport adapter，包括 request shape、message role、tool result 和 streaming event 的完整映射。

### Finding 2：`ProviderPromptFrameInput` 目前是契约占位，尚未接管 payload 构造

严重级别：低

相关位置：

- `backend/src/agent/provider-payload.ts`

`ProviderPromptFrameInput` 已表达 provider-neutral 输入边界，但当前 mutation 入口仍接收 pi-agent-core 生成后的 `payload`。这符合 P5 规范里的“现阶段可以不真的替换 agentLoop 的 payload 构造”，不是缺陷。

后续如果 adapter 从 mutation 升级为真正 serializer，应把 `systemPrompt` / `replayMessages` / `tools` / `promptFrame` 作为唯一输入，避免一半依赖 core frame、一半依赖已生成 payload。

### Finding 3：Anthropic cache_control 的幂等分支测试可以后补

严重级别：低

相关位置：

- `backend/src/agent/provider-payload.test.ts`

现有测试覆盖了 string system 转 Anthropic text block、OpenAI-compatible 不污染、BigModel / vLLM `tool_stream`。如果 Anthropic 路径后续进入真实使用，建议补两类小测试：

- `system` 已是 text block 且已有 `cache_control` 时不重复 mutation。
- `system` 是数组但没有 text block 时不误报 `cacheControlApplied`。

当前 Anthropic 仅作为 provider adapter 边界验证，这两项不阻塞 P5。

## 4. P5 状态

P5 可以视为完成。

保留的后续项：

- `system-prompt-snapshot.ts` 注释密度维护性整理，按 P4 审查 Finding 3 单独处理。
- Anthropic 端到端 transport adapter，如未来真的需要，再独立立项。
- `.lecquy/system-prompt/` 旧兼容目录的迁移 / 删除仍需另起任务，不能混进本轮收口。
