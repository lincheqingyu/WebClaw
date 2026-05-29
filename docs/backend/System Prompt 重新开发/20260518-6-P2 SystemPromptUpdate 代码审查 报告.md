# P2 SystemPromptUpdate 代码审查

> 更新日期：2026-05-18
> 类型：审查报告
> 前置：[P2 SystemPromptUpdate Builder 开发指导](./20260518-5-P2%20SystemPromptUpdate%20Builder%20开发指导%20技术规范.md)

## 1. 审查结论

P2 主目标已达成：`FrozenSystemSnapshot.systemText` 在 snapshot 生命周期内保持稳定，运行期变化通过 cumulative `<system_prompt_update>` 进入当前用户问题前的 synthetic context，plan final answer 不再依赖重写 system 注入阶段指令。

P1 审查中要求立即修的 restore 校验也已补齐：坏 hash / 非法 role / 损坏 snapshot entry 会被拒绝，runtime 会重建 fresh snapshot。

本次审查不要求回滚 P2。可以进入 P3，但建议在 P3 开始前或 P3.0 里补一个很小的 timezone 回归修复，避免“snapshot 创建时无 timezone，后续请求带 timezone”的状态被静默吃掉。

## 2. 已完成项

代码已落地：

- `backend/src/core/prompts/system-prompt-update.ts`
- `backend/src/core/prompts/system-prompt-snapshot.ts`
- `backend/src/runtime/session-runtime-service.ts`
- `backend/src/agent/worker-runner.ts`
- `backend/src/core/prompts/__tests__/system-prompt-update.test.ts`
- `backend/src/runtime/__tests__/system-prompt-update-runtime.test.ts`

关键行为：

- `buildSystemPromptUpdate` 基于 snapshot source hash 与当前 source state 生成 cumulative update。
- `collectCurrentSystemPromptSourceState` 被 P1 snapshot 与 P2 update 共用，避免 hash 逻辑分叉。
- update 使用 `role=user` 的 synthetic context message，不使用 tool role，也不写入 `custom_message`。
- runtime 用 `appendCustomEntry('system_prompt_update', ...)` 记录审计信息。
- simple / manager / worker 均已接入，worker 的 update 位于 `todoSnapshot` 前。
- plan final answer 复用 `simple` snapshot，并通过 update 携带 `mode=plan`、`toolsEnabled=false`、`phase=plan_final_answer` 与最终答复阶段指令。

验证由实现方报告通过：

```bash
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
```

本次审查未重复跑全量测试。

## 3. Findings

### Finding 1：snapshot 无 timezone 时，后续 timezone 补入可能不会生成日期/时区 update

严重级别：低，建议 P3 前修

相关位置：

- `backend/src/core/prompts/system-prompt-update.ts:155`
- `backend/src/core/prompts/system-prompt-update.ts:156`
- `backend/src/core/prompts/system-prompt-update.ts:160`

当前逻辑：

```ts
const currentTimeZone = request.route?.userTimezone ?? request.snapshot.timeZone ?? 'UTC'
const snapshotTimeZone = request.snapshot.timeZone ?? currentTimeZone
```

如果 snapshot 创建时 `route.userTimezone` 为空，`buildTimeSection` 不会在 frozen system 里注入当前日期/时区。后续同一会话的请求带上 `Asia/Shanghai` 时，`snapshotTimeZone` 会被回填成 `currentTimeZone`，只要本地日期相同，`buildCurrentDateChange` 会返回 `undefined`。

结果是：当前请求已经有可用 timezone，但 update 不会明确告诉模型当前时区/日期。`runtimeInputs` hash 可能仍会变化，但序列化出来的 runtime 段只会出现 `toolsEnabled` / `thinkingLevel` 等字段，无法表达 timezone。

建议修复：

- 保留 snapshot timezone 是否缺失这个事实，不要用 current timezone 回填后再比较。
- snapshot local date 可用 `request.snapshot.timeZone ?? 'UTC'` 计算。
- 只要 `request.snapshot.timeZone !== currentTimeZone`，就输出 date/timezone update。
- 增加回归：snapshot 无 timezone，当前请求有 `Asia/Shanghai`，同一天也应输出 `Time zone: Asia/Shanghai`。

### Finding 2：`toolInventory` hash 混入 `toolsEnabled`，会让 runtime delta 与 blocked source 文案同时出现

严重级别：低

相关位置：

- `backend/src/core/prompts/system-prompt-snapshot.ts:848`
- `backend/src/core/prompts/system-prompt-snapshot.ts:849`
- `backend/src/core/prompts/system-prompt-update.ts:298`
- `backend/src/core/prompts/system-prompt-update.ts:301`

`toolInventory` 当前把 `toolsEnabled` 和工具清单一起 hash。plan final answer 从普通 simple snapshot 复用时，`toolsEnabled=true → false` 会同时触发两段内容：

- runtime update：`Tools enabled: false`
- blocked source changes：`toolInventory changed; existing snapshot tool policy remains authoritative until resnapshot.`

这不破坏 P2 主流程，因为真实工具可用性仍由请求里的 tools 数组控制；但对模型来说，这两句有轻微语义冲突：前者说当前工具关闭，后者说旧 tool policy 仍权威。

建议后续微调：

- 把 `toolInventory` hash 限定为真实工具名称 / 描述 / schema，不包含 `toolsEnabled`。
- `toolsEnabled` 只归入 runtime delta。
- 或者保留当前 hash，但 blocked reason 明确说明“工具清单 prompt 仍冻结；当前工具开关以 runtime update 与 API tools 参数为准”。

### Finding 3：update 审计 entry 还不能作为 P3 的 replay 事实源

严重级别：低，P3 设计输入

相关位置：

- `backend/src/runtime/session-runtime-service.ts:1546`
- `backend/src/runtime/session-runtime-service.ts:1549`
- `backend/src/runtime/session-runtime-service.ts:1551`
- `backend/src/runtime/session-runtime-service.ts:1556`

P2 当前写入的 custom entry 包含 `baseSnapshotId`、`contentHash`、`generatedAt`、`changes`，但不包含：

- `serializedText`
- 插入锚点，例如 current user message id / runId / ordinal
- 该 synthetic message 在 API replay transcript 中的准确位置

这对 P2 审计足够，但 P3 不能直接把它当作完整 replay transcript。否则重放会依赖“当前版本 serializer + 当前事件遍历顺序”重新推导历史 update，无法保证字节级或语义级可解释。

P3 应改成统一的 runtime augmentation 记录：至少保存 rendered content / contentHash / target user message id / insertBefore / ordinal。AI request logger 仍可继续作为调试快照，但 session event tree 需要有足够信息解释“本轮究竟注入了什么”。

## 4. P3 交接项

P3 不需要重新设计 snapshot/update。它应专注三件事：

1. 明确分离用户可见 transcript、API replay transcript、runtime augmentation 记录。
2. 把 MemoryRecall 从旧 `<LAYER:memory_recall>` 改成 `<retrieved_memory priority="low">`，并保证不进入用户可见历史。
3. 统一 prompt frame 组装顺序：history / compaction context → retrieved memory → system prompt update → current user。

当前 `buildContextMessages` 在 layered 路径仍是 `memory recall → session context`，这是 P2 留给 P3 的已知边界，不应在 P2 里混修。

## 5. P2 状态

P2 可以视为完成。建议把 Finding 1 作为 P3.0 小修先处理；Finding 2/3 放进 P3 设计与验收，不阻塞继续推进。
