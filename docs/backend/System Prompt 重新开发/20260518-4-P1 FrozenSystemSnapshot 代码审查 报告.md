# P1 FrozenSystemSnapshot 代码审查

> 更新日期：2026-05-18
> 类型：审查报告
> 前置：[P1 FrozenSystemSnapshot Builder 开发指导](./20260518-3-P1%20FrozenSystemSnapshot%20Builder%20开发指导%20技术规范.md)

## 1. 审查结论

P1 主目标已达成：layered prompt 路径下已有 `FrozenSystemSnapshot`，并通过 runtime 内存 cache 与 session event tree custom entry 复用，legacy 路径不受影响。

本次审查没有要求回滚 P1。P2 可以继续推进，但需要把下面两个风险作为 P2 前置约束处理：

1. `simple` role 的 snapshot 复用会覆盖 normal simple / plan final answer 两种运行态差异，P2 必须把 mode、toolsEnabled、extraInstructions 等 runtime delta 写进 `<system_prompt_update>`。
2. snapshot event 恢复目前只做弱结构校验，P2 依赖 event tree 时应补 content hash 校验或至少在读取失败时重建 snapshot。

## 2. 已完成项

代码已落地：

- `backend/src/core/prompts/system-prompt-snapshot.ts`
- `backend/src/core/prompts/__tests__/system-prompt-snapshot.test.ts`
- `backend/src/runtime/__tests__/system-prompt-snapshot-runtime.test.ts`

关键接入点：

- `SessionRuntimeService.systemPromptSnapshots`
- `SessionRuntimeService.ensureFrozenSystemSnapshot`
- `SessionRuntimeService.buildRunSystemPrompt`

验证由实现方报告通过：

```bash
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
```

本次审查未重复跑全量测试。

## 3. Findings

### Finding 1：role-only snapshot cache 会让 simple 角色跨运行阶段复用旧 system

严重级别：中

相关位置：

- `backend/src/runtime/session-runtime-service.ts:781`
- `backend/src/runtime/session-runtime-service.ts:1438`
- `backend/src/runtime/session-runtime-service.ts:1444`
- `backend/src/runtime/session-runtime-service.ts:1982`

当前 snapshot hot cache key 是 `sessionId:role`，事件树恢复也只按 `sessionId + role` 找最新 snapshot。这个设计满足“同一 role 复用稳定 system”的 P1 目标，但它暴露了一个运行态差异：

- 普通 simple 回复使用 `role=simple, mode=simple, toolsEnabled=请求值, extraInstructions=用户附加 systemPrompt`。
- plan 工作流最终答复也调用 `executeSimple`，但使用 `role=simple, mode=plan, toolsEnabled=false, extraInstructions=plan final answer directive`。

如果同一会话先产生了 simple snapshot，后续 plan final answer 会复用旧 simple snapshot，final-answer directive、tools disabled、mode=plan 等差异不会进入 system。P1 为了稳定 system 不应直接重建 snapshot，但 P2 必须通过 `<system_prompt_update>` 表达这些 runtime delta。

P2 必须覆盖的测试：

- 先创建 `role=simple, mode=simple` snapshot，再调用 `role=simple, mode=plan, toolsEnabled=false, extraInstructions=final-answer`。
- `systemText` 不变。
- 最新用户问题前出现 `<system_prompt_update>`，明确包含 current mode / tools disabled / final answer directive。

### Finding 2：snapshot restore 只校验字段类型，不校验内容完整性

严重级别：中低

相关位置：

- `backend/src/core/prompts/system-prompt-snapshot.ts:632`
- `backend/src/core/prompts/system-prompt-snapshot.ts:680`

`isSystemPromptSnapshotEntryData` 目前只检查 `kind`、`sessionId`、`snapshotId`、`systemText`、`contentHash` 是否是字符串，不验证：

- `contentHash === hashContent(systemText)`
- `sourceHashes` 是否存在且形状合理
- `role` / `mode` 是否是合法枚举
- `createdAt` 是否是合法 ISO 时间

如果 session event 文件局部损坏或被手工编辑，runtime 可能恢复一个 hash 不匹配的 snapshot。P1 阶段这不是主流程 blocker，但 P2 会基于 snapshot source hash 生成 update，弱校验会放大错误。

建议：

- P2 前先补 `validateFrozenSystemSnapshot(snapshot)`。
- restore 时发现无效 snapshot，应忽略并重建，不要抛断整个会话。
- 增加 corrupt snapshot test。

### Finding 3：P1 只保存 source hash，不保存 source baseline 内容

严重级别：低，属于 P2 设计约束

相关位置：

- `backend/src/core/prompts/system-prompt-snapshot.ts:176`
- `backend/src/core/prompts/system-prompt-snapshot.ts:808`

P1 的 `sourceHashes` 足够判断“哪个来源变了”，但不足以生成真正的 old-vs-new diff，因为 snapshot 没有保存 `USER.md` / `SOUL.md` / `IDENTITY.md` / `MEMORY.summary.md` 的原始 baseline 文本。

P2 不应假装能生成精确 diff。可选方案：

- P2 直接输出“当前有效内容摘要 / 当前完整小片段”，而不是 old/new diff。
- 后续 P4 resnapshot 时再把当前有效内容吸进新 snapshot。
- 如需精确 diff，另行扩展 snapshot 存 `sourceTextSummaries`，但这不是 P2 必需项。

### Finding 4：测试缺少 mode / phase 复用与 corrupt snapshot 覆盖

严重级别：低

已有测试覆盖：

- 同输入 deterministic。
- 时间冻结。
- role 分离 restore。
- runtime 重复调用复用。
- legacy 不写 snapshot。
- dynamic layer 被 serializer 拒绝。

缺口：

- simple role 跨 `mode=simple` 与 `mode=plan` 的 runtime delta。
- snapshot event 损坏后的恢复行为。
- extraInstructions / toolsEnabled 变化时是否由 update 接管。

这些测试应纳入 P2。

### Finding 5：`system-prompt-snapshot.ts` 注释密度过高

严重级别：低，维护性问题

该文件包含大量面向 TypeScript 初学者的语法教学注释。它不影响功能，但长期会增加 review 噪音，也不符合“只在复杂块前保留短注释”的代码维护风格。

建议不在 P2 混做清理；后续可单独整理为：

- 文件头保留职责说明。
- 复杂算法保留短注释。
- 删除大段语法教学和重复示例。

## 4. P2 前置约束

P2 开发必须遵守：

- 不因 runtime delta 重建 snapshot。
- runtime delta 必须进入 `<system_prompt_update>`。
- update 生成要基于 snapshot 的 `sourceHashes`，但输出当前有效内容，而不是伪造 old/new diff。
- 不使用 `appendCustomMessageEntry` 持久化 update；`SessionManager.buildSessionContext` 会把所有 custom_message 放回 LLM context，即使 `display=false`。
- 如需记录 update，使用 `appendCustomEntry('system_prompt_update', data)` 或 AI request logger，不把 synthetic context 写成用户消息。

## 5. P1 状态

P1 可以视为完成，但不建议在 P2 之前把 `LAYERED_PROMPT=true` 作为 plan 工作流默认生产路径。P2 完成 runtime delta update 后，这个风险才闭合。
