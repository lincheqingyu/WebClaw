# P3 Transcript 与 Replay 代码审查

> 更新日期：2026-05-19
> 类型：审查报告
> 前置：[P3 Transcript 与 Replay 分层开发指导](./20260518-7-P3%20Transcript%20与%20Replay%20分层开发指导%20技术规范.md)

## 1. 审查结论

P3 主目标大部分已达成：`<retrieved_memory>` 与 `<system_prompt_update>` 已从用户可见 transcript 分离，改为 `runtime_augmentation` custom entry，并通过 `RuntimePromptFrame` 在模型请求前重组 replay messages。simple / manager / worker 三条主路径都已接入 promptFrame 元数据，MemoryRecall tag 也已从旧 `<LAYER:memory_recall>` 迁到 `<retrieved_memory priority="low" source="lecquy">`。

但 P3 还留下两个会影响 P4 compact / resnapshot 的边界问题：

1. plan worker 的 `task_result` 仍使用 `custom_message display=false` 注入最终答复上下文。
2. runtime augmentation 以 `targetMessageId` 作为主要回放锚点，在 plan 多 step 场景下会混合 manager / worker / final answer 的 augmentation。

这两个问题不要求回滚 P3，但建议作为 P4.0 前置修复先处理。否则 P4 做 compact / resnapshot 时，hidden context 和 replay 边界会继续不干净。

## 2. 已完成项

代码已落地：

- `backend/src/runtime/context/runtime-augmentation.ts`
- `backend/src/runtime/context/prompt-frame-builder.ts`
- `backend/src/runtime/session-runtime-service.ts`
- `backend/src/runtime/context/augmented-context-builder.ts`
- `backend/src/memory/prompt-injector.ts`
- `backend/src/agent/agent-runner.ts`
- `backend/src/agent/manager-runner.ts`
- `backend/src/agent/worker-runner.ts`
- `backend/src/agent/ai-request-logger.ts`

关键行为：

- `RuntimeAugmentationEntryData` 保存 rendered content、content hash、runId、targetMessageId、ordinal、visible=false。
- `buildRuntimePromptFrame` 组装 `historyMessages → augmentations → currentUserMessage`。
- `SessionRuntimeService` 先写真实 user message，再用该 message id 作为 augmentation target。
- `system_prompt_update` 不再写 `system_prompt_update` custom entry，而是进入统一 `runtime_augmentation`。
- AI request log 增加 `promptFrame` 元数据。
- `buildAugmentedContext` 在 P3 后恢复为 session history 在前，memory recall 不再插到 history 前。

验证由实现方报告通过：

```bash
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
```

本次审查未重复跑全量测试。

## 3. Findings

### Finding 1：plan `task_result` 仍通过 hidden `custom_message` 注入模型上下文

严重级别：中

相关位置：

- `backend/src/runtime/session-runtime-service.ts:2151`
- `backend/src/runtime/session-runtime-service.ts:2154`
- `backend/src/runtime/session-runtime-service.ts:2168`
- `backend/src/runtime/session-runtime-service.ts:2171`
- `backend/src/runtime/pi-session-core/session-manager.ts:266`
- `backend/src/runtime/pi-session-core/session-manager.ts:267`

P3 已把 memory/update 从 hidden context 中抽出来，但 plan worker 结果仍这样写入：

```ts
bound.manager.appendCustomMessageEntry('task_result', ..., false)
```

`display=false` 只影响展示语义，不影响模型上下文。`buildSessionContext` 对所有 `custom_message` 都会执行 `messages.push(createCustomMessage(entry))`。因此 `task_result` 仍是一种 hidden prompt 注入通道，且会进入后续 `buildBaseContextMessages`。

这会带来两个问题：

- P3 的“不用 `custom_message display=false` 承载 hidden runtime context”没有完全闭合。
- P4 compact / resnapshot 很难判断 `task_result` 是 durable transcript、final-answer runtime context，还是需要被 compact 吸收的隐藏材料。

建议：

- 如果 `task_result` 只服务 plan final answer，迁到 `RuntimeAugmentationKind = 'plan_task_result'`，只挂到 final answer prompt frame。
- 如果 `task_result` 是需要长期保留的计划执行事实，改成 `custom` entry 或 workflow event，再由 final answer frame builder 显式选择本 run 的 task results 注入。
- 不再用 `appendCustomMessageEntry(..., false)` 表达任何 hidden runtime context。

### Finding 2：augmentation 只按 `targetMessageId` 回放，在 plan 多步骤中会混合不同 prompt frame

严重级别：中

相关位置：

- `backend/src/runtime/context/runtime-augmentation.ts:20`
- `backend/src/runtime/context/runtime-augmentation.ts:21`
- `backend/src/runtime/context/runtime-augmentation.ts:22`
- `backend/src/runtime/context/runtime-augmentation.ts:102`
- `backend/src/runtime/context/runtime-augmentation.ts:110`
- `backend/src/runtime/context/runtime-augmentation.ts:111`
- `backend/src/runtime/session-runtime-service.ts:2091`
- `backend/src/runtime/session-runtime-service.ts:2094`

`RuntimeAugmentationEntryData` 有 `runId` / `stepId`，但 `getRuntimeAugmentationsForTarget` 只按 `targetMessageId` 过滤，并只按 `ordinal` 排序。

plan 模式下同一个真实用户消息会派生多个模型请求：

- manager plan prompt
- N 个 worker prompt
- final answer prompt

这些请求当前都可能使用同一个 `targetMessageId`。worker 还会带不同 `stepId`，但回放 helper 不按 `stepId` / prompt frame 过滤。结果是：对同一个 target message 回放时，manager、worker、final answer 的 memory/update 会混在一起，多个 step 的 `ordinal=0/1` 也会互相穿插。

这不影响当前模型调用，因为调用时 frame 是内存中刚组好的；但会影响“从 session event tree 重建某一次 API replay transcript”的 P3 目标。

建议：

- 给每次模型请求生成 `promptFrameId` 或 `promptCallId`。
- augmentation entry 保存 `promptFrameId`、`role`、`phase`。
- 回放 helper 改为按 `promptFrameId` 精确取一组 augmentation；`targetMessageId` 只作为“归属于哪个真实用户输入”的上层锚点。
- AI request log 的 `promptFrame` 元数据也记录同一个 `promptFrameId`。

### Finding 3：`RuntimePromptFrame.visibleMessages` 当前只包含 current user message

严重级别：低

相关位置：

- `backend/src/runtime/session-runtime-service.ts:1641`
- `backend/src/runtime/context/prompt-frame-builder.ts:46`

`RuntimePromptFrame` 里有 `visibleMessages`，但 `buildRunPromptContext` 传入的是：

```ts
visibleMessages: [options.currentUserMessage]
```

这和“visible transcript”命名不完全一致。当前 UI 仍依赖 session projection，不依赖 `RuntimePromptFrame.visibleMessages`，所以不是运行时 bug；但如果后续调试、导出或 replay 页面使用这个字段，会误以为它代表完整用户可见 transcript。

建议二选一：

- 如果只想表达当前可见输入，字段改名为 `currentVisibleMessage`。
- 如果要表达完整 visible transcript，就从 session projection / message path 构造真实 visible history，而不是复用 replay history。

### Finding 4：runtime augmentation restore 校验仍偏弱

严重级别：低

相关位置：

- `backend/src/runtime/context/runtime-augmentation.ts:87`
- `backend/src/runtime/context/runtime-augmentation.ts:88`
- `backend/src/runtime/context/runtime-augmentation.ts:93`
- `backend/src/runtime/context/runtime-augmentation.ts:99`

`isRuntimeAugmentationEntryData` 已校验 `contentHash === hashContent(content)`，这是关键项。但它没有校验：

- `augmentationKind` 是否属于枚举。
- `ordinal` 是否是非负整数。
- `createdAt` 是否是合法 ISO 时间。
- `source` 形状是否合理。

这和 P1 snapshot 早期的弱 restore 校验是同一类风险。短期不会影响主流程，但 P4 做 compact/resnapshot 时会更依赖 event tree，建议补齐。

## 4. P4 前置约束

P4 开发前建议先处理：

1. 迁移 `task_result`，不再使用 hidden `custom_message`。
2. 给 runtime augmentation 增加 `promptFrameId` 并更新 replay helper。
3. 补 runtime augmentation restore 校验回归。

处理完这三项后，再做 compact / resnapshot。否则 compact 后“旧 update 不重复注入”可以做到，但 hidden plan result 与多 step replay 仍会让上下文边界不干净。

## 5. P3 状态

P3 可以进入 P4，但不是“完全无遗留”。memory/update 的 P3 主链路已完成；plan task result 与 promptFrame 精确回放建议作为 P4.0 收口。
