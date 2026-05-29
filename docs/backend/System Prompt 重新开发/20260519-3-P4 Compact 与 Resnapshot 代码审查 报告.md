# P4 Compact 与 Resnapshot 代码审查

> 更新日期：2026-05-19
> 类型：审查报告
> 前置：[P4 Compact 与 Resnapshot 开发指导](./20260519-2-P4%20Compact%20与%20Resnapshot%20开发指导%20技术规范.md)

## 1. 审查结论

P4 主目标已达成：compact 现在成为 `FrozenSystemSnapshot` 的生命周期边界；compact 后同一进程内的 snapshot hot cache 会失效，事件树恢复也只接受 compact boundary 之后的 snapshot；下一轮请求会懒创建 `createdReason: 'compact'` 的 fresh snapshot，并把 compact 前的最新可编辑上下文吸收进去。

P4.0 前置项也已补齐：

- plan `task_result` 不再通过 `custom_message display=false` 注入上下文，改为 final answer frame 的 `plan_task_result` runtime augmentation。
- 每次模型请求都有独立 `promptFrameId`，可以按 frame 精确恢复 augmentation。
- `RuntimePromptFrame.visibleMessages` 已改为 `currentVisibleMessage`。
- runtime augmentation restore 校验已补强。
- `buildSessionContext` 已跳过 `display=false custom_message`。

本次审查不要求回滚 P4。可以进入 P5 provider adapter。下面的 findings 都是边界与维护性问题，不阻塞 P5。

## 2. 已完成项

代码已落地：

- `backend/src/core/prompts/system-prompt-snapshot.ts`
- `backend/src/runtime/session-runtime-service.ts`
- `backend/src/runtime/context/runtime-augmentation.ts`
- `backend/src/runtime/context/prompt-frame-builder.ts`
- `backend/src/runtime/pi-session-core/session-manager.ts`
- `backend/src/memory/compact.test.ts`
- `backend/src/runtime/__tests__/system-prompt-snapshot-runtime.test.ts`
- `backend/src/runtime/__tests__/system-prompt-update-runtime.test.ts`

关键行为：

- `findLatestFrozenSystemSnapshot` 支持 `afterEntryId` / `afterTimestamp` compact boundary。
- `SessionRuntimeService.ensureFrozenSystemSnapshot` 会根据最新 compaction entry 过滤恢复范围。
- snapshot cache entry 绑定 `compactBoundaryEntryId`，避免旧缓存跨 compact 复用。
- compact 成功后调用 `deleteSystemPromptSnapshots(sessionId)` 清理当前 session 的 snapshot hot cache。
- compact 后 fresh snapshot 使用 `createdReason: 'compact'`。
- compact history 不包含 `<retrieved_memory>` / `<system_prompt_update>` synthetic 内容。

验证由实现方报告通过：

```bash
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
git diff --check
```

本次审查未重复跑全量测试。

## 3. Findings

### Finding 1：compact boundary 与 snapshot restore 仍按全事件列表扫描，未限制当前 branch path

严重级别：低

相关位置：

- `backend/src/runtime/session-runtime-service.ts:916`
- `backend/src/runtime/session-runtime-service.ts:920`
- `backend/src/core/prompts/system-prompt-snapshot.ts:730`
- `backend/src/core/prompts/system-prompt-snapshot.ts:740`

`SessionManager.buildSessionContext` 会基于当前 `leafId` 构造 branch path，但 P4 的 compact boundary 查找和 snapshot restore 都扫描 `manager.getEntries()` 的全量事件列表。

常规单分支会话没有问题。但如果后续启用或频繁使用 branch：

- 非当前 branch 上的最新 compaction 可能让当前 branch 的 snapshot cache 被不必要地失效。
- 非当前 branch 上 compact 之后的 snapshot 也可能被 `findLatestFrozenSystemSnapshot` 选中。

建议后续修复：

- 在 `SessionManager` 增加 `getCurrentBranchEntries()` 或暴露 `getBranch()` 的当前 leaf 便捷封装。
- `getLatestCompactionBoundary` 与 `findLatestFrozenSystemSnapshot` 均基于当前 branch path，而不是全量 entries。
- 增加测试：同一 session 两条 branch，另一条 branch compact 后不影响当前 branch snapshot。

这不是 P5 blocker，因为当前系统主路径仍是单 branch。

### Finding 2：runtime augmentation source 校验没有覆盖 `sourceHashBefore/sourceHashNow` 形状

严重级别：低

相关位置：

- `backend/src/runtime/context/runtime-augmentation.ts:120`
- `backend/src/runtime/context/runtime-augmentation.ts:126`

`isRuntimeAugmentationEntryData` 已校验 kind、promptFrameId、role、phase、ordinal、createdAt 和 `contentHash`，核心安全性已足够。`source` 校验目前只检查 `snapshotId` / `snapshotHash` 是否为字符串，未校验 `sourceHashBefore` / `sourceHashNow` 是否为对象或符合 `FrozenSystemSourceHashes` 的形状。

这不会影响当前 replay，因为 replay 使用 rendered `content` 和 `contentHash`。但后续如果调试面板或 provider adapter 想依赖 `sourceHashBefore/sourceHashNow` 做解释，坏 entry 仍可能混入。

建议：

- 最少校验 `sourceHashBefore/sourceHashNow` 若存在必须是 plain object。
- 更严格时复用 snapshot source hash validator。

### Finding 3：`system-prompt-snapshot.ts` 注释密度继续升高

严重级别：低，维护性问题

相关位置：

- `backend/src/core/prompts/system-prompt-snapshot.ts`

P1 审查已经记录该文件注释密度过高。P4 后文件头和类型段又增加了大量 TypeScript 教学式注释。功能上不影响，但后续 review 这个文件会更困难，真实逻辑变化更难从 diff 里看出来。

建议不要混进 P5；单独开一个维护性整理：

- 保留文件头职责说明。
- 保留 snapshot 生命周期、compact boundary 这类复杂语义注释。
- 删除语法教学、重复示例和过长 ASCII 说明。

## 4. P5 交接项

P5 不需要再改 snapshot / update / replay / compact 的核心数据结构。P5 应只做 provider adapter 边界：

- OpenAI-compatible 仍是默认主路径。
- Anthropic `cache_control` 只能出现在 Anthropic adapter 或 provider payload 层。
- 核心 `FrozenSystemSnapshot` / `SystemPromptUpdate` / `RuntimePromptFrame` 不新增 provider 专属字段。
- AI request log 可以记录 adapter 后 payload，但不能反向污染核心 prompt frame。

## 5. P4 状态

P4 可以视为完成。建议把 Finding 1 记录为 branch support 的后续边界，把 Finding 2/3 作为非阻塞维护项。
