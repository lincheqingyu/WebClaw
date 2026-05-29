# P4 Compact 与 Resnapshot 开发指导

> 更新日期：2026-05-19
> 类型：技术规范
> 前置：[P3 Transcript 与 Replay 代码审查](./20260519-1-P3%20Transcript%20与%20Replay%20代码审查%20报告.md)

## 1. P4 目标

P4 的目标是让 compact 后进入新的 prompt 窗口：旧 `FrozenSystemSnapshot` 不再被复用，旧 `<system_prompt_update>` 不再重复注入，新的 snapshot 能吸收 compact 前最新有效状态。

完成后必须满足：

- compact 前同一 snapshot 生命周期内，system 仍保持字节稳定。
- compact 成功后，下一次模型请求不恢复 compact 前的旧 snapshot。
- compact 后新 snapshot 的 `systemText` 基于当前文件、当前 runtime 输入、当前 active skill 重新生成。
- 如果 compact 前已有 USER / MEMORY.summary / timezone / mode 等 update，compact 后首轮不再重复输出同一 update。
- runtime augmentation 不被写进用户可见 transcript，也不被 compact 摘要写成 kira 真实发言。
- OpenAI-compatible 主路径仍只使用普通 messages，不引入 provider 专属字段。

## 2. 非目标

- 不做 Anthropic `cache_control`；这是 P5。
- 不重新设计 compaction 摘要算法。
- 不改变 memory.db 写入 / 检索策略。
- 不删除 `.lecquy/system-prompt/` 兼容目录。
- 不做前端 UI 改造。

## 3. P4.0 前置修复

P3 审查留下三项必须先收口，否则 compact/resnapshot 会放大边界问题。

### 3.1 迁移 plan `task_result`

当前 plan worker 结果仍通过 `appendCustomMessageEntry('task_result', ..., false)` 注入 final answer 上下文。P4.0 必须移除这条 hidden context 通道。

推荐方案：

- 新增 `RuntimeAugmentationKind = 'plan_task_result'`。
- worker 完成后，把 task result 存为普通 `custom` workflow record，例如 `plan_task_result`，包含 `runId`、`stepId`、`todoId`、`status`、`contentHash`、`content`。
- final answer frame builder 根据当前 `runId` 收集 task results，转成 `runtime_augmentation`，只注入 final answer prompt frame。
- 不再调用 `appendCustomMessageEntry('task_result', ..., false)`。

验收：

- `rg "appendCustomMessageEntry\\(\\s*['\\\"]task_result"` 无命中。
- plan final answer 仍能看到 worker 结果。
- 后续普通 turn 不会自动携带上一次 plan 的 hidden task_result。

### 3.2 增加 promptFrameId

每次模型请求都应有唯一 `promptFrameId`，覆盖 simple / manager / worker / final answer。

建议：

```ts
export interface RuntimeAugmentationEntryData {
  readonly promptFrameId: string
  readonly role: 'simple' | 'manager' | 'worker'
  readonly phase: 'normal' | 'manager' | 'worker' | 'plan_final_answer'
  // existing fields...
}
```

回放 helper 改为：

```ts
getRuntimeAugmentationsForPromptFrame(entries, promptFrameId)
```

`targetMessageId` 继续保留，但只表达“归属于哪个真实用户输入”，不再作为精确 replay 的唯一 key。

验收：

- 同一个 plan run 下 manager / 多个 worker / final answer 的 augmentation 不会互相混入。
- AI request log 的 `promptFrame` 元数据包含 `promptFrameId`。

### 3.3 补强 runtime augmentation 校验

`isRuntimeAugmentationEntryData` 需要补：

- `augmentationKind` 枚举校验。
- `ordinal` 非负整数。
- `createdAt` 合法 ISO 时间。
- `promptFrameId` 非空字符串。
- `role` / `phase` 合法枚举。
- `source.snapshotHash` 等字段如果存在必须是字符串。

损坏 entry 应跳过，不应中断会话。

## 4. Compact Boundary

当前 `findLatestFrozenSystemSnapshot` 会在整个 event tree 中找最新 snapshot。P4 必须引入 compact boundary：compact 之后，不允许恢复 compact 之前创建的 snapshot。

建议规则：

- 找到最新 `compaction` entry。
- 恢复 snapshot 时，只接受 `snapshot.createdAt > latestCompaction.timestamp` 或 snapshot entry 位于 compaction entry 之后的 snapshot。
- 如果 compact 后没有新 snapshot，下一次请求应创建 fresh snapshot。
- 创建 fresh snapshot 时 `createdReason` 使用 `compact` 或 `resnapshot`。

实现选项：

1. 改造 `findLatestFrozenSystemSnapshot(entries, sessionId, role, options)`，支持 `afterEntryId` / `afterTimestamp`。
2. 或新增 `findLatestFrozenSystemSnapshotAfterBoundary`，避免破坏 P1 测试。

不要只清内存 cache。只清 cache 后，下一次 `ensureFrozenSystemSnapshot` 仍会从 event tree 恢复旧 snapshot。

## 5. SessionRuntimeService 接入

当前 compact 在 `executeRun` 的 `finally` 中调用：

```ts
if (await applyCompactionIfNeeded(manager, options)) {
  await this.refreshProjection(sessionKey)
}
```

P4 需要在 compact 成功后：

1. 记录 compaction entry id 或读取最新 compaction entry。
2. 清理当前 session 的 `systemPromptSnapshots` hot cache。
3. 后续 `ensureFrozenSystemSnapshot` 恢复 snapshot 时应用 compact boundary。
4. 下一次请求如没有 compact 后 snapshot，则用当前请求参数创建 fresh snapshot。

建议新增 helper：

```ts
private clearSystemPromptSnapshotsForSession(sessionId: string): void
```

只删除 `${sessionId}:*`，不影响其他会话。

## 6. Resnapshot 语义

P4 不要求 compact 发生时立刻为所有 role 生成 snapshot。更稳的方式是 lazy resnapshot：

- compact 成功：旧 snapshot 失效。
- 下一次 simple 请求：创建 simple fresh snapshot。
- 下一次 manager 请求：创建 manager fresh snapshot。
- 下一次 worker 请求：创建 worker fresh snapshot。

这样可以用下一次真实请求的 model / tools / route / timezone 构建正确 snapshot，避免 compact 时猜测未来 role 的 runtime 输入。

新 snapshot 必须：

- 读取当前 `.lecquy` 可编辑文件。
- 使用当前 active skill。
- 使用当前 route timezone 和创建时刻。
- 使用当前 request 的 mode / model / toolsEnabled / tools inventory。
- 写入 `SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE` custom entry。

## 7. Update 归零规则

compact 后首轮请求应满足：

- 如果没有 compact 后新变化，`buildSystemPromptUpdate` 返回 `null`。
- 如果 compact 后又修改 `USER.md`，update 只表达 compact 后 snapshot 以来的新变化。
- 旧 runtime augmentation entry 仍可审计，但不参与新 prompt frame。

不要删除旧 augmentation entry。event tree 是审计来源；“归零”指逻辑影响归零，不是物理删除。

## 8. Compact 与 Runtime Augmentation

compact 摘要输入必须只来自 durable visible messages 和必要的 plan result record，不得直接摘要：

- `<retrieved_memory>`
- `<system_prompt_update>`
- hidden runtime augmentation
- AI request payload

如果需要把 plan task result 纳入 final answer，必须通过当前 run 的 prompt frame 注入；是否进入长期 compact 摘要，应由它是否已转化成 assistant 可见结论决定。

## 9. 测试要求

新增或更新测试：

1. compact 后旧 snapshot 不再恢复：旧 snapshot entry 在 compaction 前，新请求应创建新 snapshot。
2. compact 后清理 hot cache：同一进程内也不能继续使用旧 snapshot。
3. compact 前修改 `USER.md` 并生成 update，compact 后下一轮新 snapshot 吸收该 USER 内容，且不再输出同一 update。
4. compact 后再次修改 `USER.md`，只输出 compact 后的新变化。
5. plan 模式下 manager / worker / final answer 的 augmentation 通过不同 `promptFrameId` 精确回放。
6. `task_result` 不再是 `custom_message`，final answer 仍能收到当前 run task result。
7. corrupt runtime augmentation entry 被跳过，不影响 replay frame。
8. compact 摘要不包含 `<retrieved_memory>` / `<system_prompt_update>` 原文。

## 10. 验收标准

P4 完成后：

- compact 是 snapshot 生命周期边界。
- compact 后不会复用 compact 前 snapshot。
- compact 后首轮请求没有旧 update 残留。
- runtime augmentation 可以按 promptFrame 精确 replay。
- hidden `custom_message display=false` 不再承担 runtime context 注入职责。
- P5 可以在 provider adapter 层处理 OpenAI-compatible / Anthropic 差异，而不再回头修核心 prompt 边界。
