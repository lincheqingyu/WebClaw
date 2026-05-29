# System Prompt 重新开发整体审查

> 更新日期：2026-05-19
> 类型：审查报告
> 关联：[整体审查 Goal 提示词](./20260519-7-System%20Prompt%20重新开发整体审查%20Goal%20提示词%20审查指令.md)
> 关联：[System Prompt 重新开发阶段收口](./20260519-6-System%20Prompt%20重新开发阶段收口%20报告.md)

## 1. 审查结论

P0-P5 的主要工程能力已经落地：`FrozenSystemSnapshot` 能在同一生命周期内保持 `systemText` 稳定，`<system_prompt_update>` 是 cumulative since snapshot，MemoryRecall / prompt update / plan task result 已从用户可见 transcript 移到 runtime augmentation，compact 后会按当前 branch boundary 重新创建 snapshot，Anthropic `cache_control` 也只停留在 provider payload mutation 层。

但本轮整体审查发现一个 P1 级别缺口：当前实现只在“本轮 prompt frame”展开 runtime augmentation，后续请求的历史 context 不会重新展开前轮 `<retrieved_memory>` / `<system_prompt_update>` / `<plan_task_result>`。这违反 `20260513-7` 中“API replay transcript 必须保留 synthetic context 历史语义”的契约，也会让 P3/P4 的“replay 干净且完整”结论过满。

结论：

- P0-P5 可视为“主链路大体落地”，但不建议标记为“完全闭环”。
- 未发现 P0 blocker。
- 发现 1 个 P1 blocker：历史 runtime augmentation 没有进入后续 API replay projection。
- P1 修复前，不建议继续基于“历史 API replay 完整”做 provider cache 或更强 replay 调试能力。

## 2. Findings

### P1：后续请求的 API replay history 会丢失前轮 synthetic context

严重级别：P1

相关位置：

- `backend/src/runtime/session-runtime-service.ts:1557`
- `backend/src/runtime/session-runtime-service.ts:1672`
- `backend/src/runtime/session-runtime-service.ts:1770`
- `backend/src/runtime/context/prompt-frame-builder.ts:42`
- `backend/src/runtime/pi-session-core/session-manager.ts:260`

具体问题：

`buildRunPromptContext` 会把本轮 memory recall、system prompt update、plan task result 组装成 `RuntimeAugmentationEntryData`，并写入 `runtime_augmentation` custom entry。`buildRuntimePromptFrame` 也会把这些 augmentation 放进本轮 `replayMessages`。但下一轮请求的 `baseContextMessages` 仍来自 `buildBaseContextMessages -> SessionManager.buildSessionContext()`，而 `buildSessionContext` 只输出真实 `message`、`display=true` 的 `custom_message` 和 branch summary，不展开历史 `runtime_augmentation` custom entry。

结果是：

- 第 N 轮模型实际看到过的 `<retrieved_memory>` / `<system_prompt_update>` 只存在于第 N 轮 frame 和 custom 审计记录中。
- 第 N+1 轮的历史上下文只包含第 N 轮真实 user/assistant message，不包含第 N 轮曾经发送给模型的 synthetic context。
- 这不满足 `20260513-7` 要求的“历史 API replay message 的 synthetic context 必须语义完整”。
- 如果未来启用 messages prefix cache，后续请求无法成为前一轮完整 API transcript 的 prefix extension。

建议修复方向：

新增一个专门的 API replay projection，不复用用户可见 transcript projection。它应在构建后续请求 history 时，按当前 branch path 和 compact boundary 收集历史 `runtime_augmentation`，按 `targetMessageId + ordinal` 展开到对应 user message 前，或合并进对应 user message 的前部。用户可见 transcript 仍保持干净。补一条两轮回归测试：第一轮写入 `<retrieved_memory>` / `<system_prompt_update>`，第二轮 `frame.replayMessages` 的历史部分必须能看到第一轮的 synthetic context。

### P2：`<system_prompt_update>` prompt 文本混入 per-call `generated_at`

严重级别：P2

相关位置：

- `backend/src/core/prompts/system-prompt-update.ts:106`
- `backend/src/core/prompts/system-prompt-update.ts:363`

具体问题：

`serializeSystemPromptUpdate` 当前输出：

```text
<system_prompt_update priority="high" source="lecquy" base_snapshot_id="..." generated_at="...">
```

`base_snapshot_id` 和 `generated_at` 是审计元数据，其中 `generated_at` 每次构建都会变化。即使同一个 snapshot 下 USER.md 的 cumulative change 没变，下一轮生成的 update prompt 文本也会因为时间戳不同而改变。

违反的契约或风险：

- `20260513-7` 和 P2 指导示例固定为 `<system_prompt_update priority="high" source="lecquy">`。
- per-call 时间戳属于 augmentation / request log 元数据，不应成为模型需要读取的 prompt 内容。
- P1 修复后，一旦历史 update 被纳入 replay，这个字段会增加无意义字节差异和测试噪音。

建议修复方向：

把 `baseSnapshotId`、`generatedAt` 留在 `SystemPromptUpdate` 对象和 `RuntimeAugmentationEntryData.source` / `createdAt` 中；prompt 文本只保留固定 wrapper：

```text
<system_prompt_update priority="high" source="lecquy">
...
</system_prompt_update>
```

补测试断言 wrapper 属性固定，审计字段仍能从 augmentation metadata 查到。

### P3：`toolInventory` hash 仍混入 `toolsEnabled`

严重级别：P3

相关位置：

- `backend/src/core/prompts/system-prompt-snapshot.ts:873`
- `backend/src/core/prompts/system-prompt-update.ts:291`
- `backend/src/core/prompts/__tests__/system-prompt-update.test.ts:343`

具体问题：

`toolInventory` hash 当前包含 `toolsEnabled` 和工具清单。plan final answer 复用 simple snapshot、关闭工具时，update 会同时输出 runtime delta `Tools enabled: false`，以及 blocked source change `toolInventory changed; existing snapshot tool policy remains authoritative until resnapshot.`。这延续了 P2 审查里记录的低风险语义冲突。

风险：

- 对模型来说，一处说当前工具关闭，另一处说旧 tool policy 仍权威，解释空间偏大。
- 这不是当前运行时工具权限的真实风险，因为 API tools 参数仍由 runner 控制，但 prompt 语义不够干净。

建议修复方向：

`toolInventory` hash 只包含工具名称、描述和 schema。`toolsEnabled` 只归入 runtime delta。若继续保留当前 hash，blocked reason 至少要明确“工具清单 prompt 冻结；当前工具开关以 runtime update 与 API tools 参数为准”。

### P3：旧 `.lecquy/system-prompt/` 仍是实际模板 override 路径，阶段文档需要避免误读

严重级别：P3

相关位置：

- `backend/src/core/prompts/prompt-module-files.ts:173`
- `backend/src/core/prompts/system-prompt-snapshot.ts:929`
- `.lecquy/system-prompt/`
- `backend/src/core/prompts/system-prompts.test.ts:145`

具体问题：

代码仍通过 `prompt-module-files.ts` 优先读取 `.lecquy/system-prompt/*.md`，仓库里也实际存在 `.lecquy/system-prompt/` 旧模板目录，测试还覆盖了该 override 行为。这与 `20260513-7` 的终态“删除 `.lecquy/system-prompt/` 整个目录”存在张力。

判断：

这不是 P0-P5 blocker。P0 文档和阶段收口已经把它定义成旧兼容路径，且明确不能顺手删除。但阶段收口中“P0-P5 主线已闭环”的表述容易让后续任务误以为物理文件体系也已经完成迁移。

建议修复方向：

保留兼容路径，单独立项迁移旧模板调用方和测试。迁移前，文档应明确：P0-P5 完成的是 snapshot / update / replay / compact / provider 边界，不等于 `.lecquy/system-prompt/` 已迁移到 BASE/TOOLS 等 8 文件终态。

## 3. 文档一致性

准确项：

- P1/P2 文档对 snapshot 稳定、cumulative update、corrupt snapshot 安全跳过的描述与当前代码和测试一致。
- P3/P4 文档中 hidden `custom_message display=false` 的清理方向已经落地，`buildSessionContext` 现在只接受 `display=true` custom message。
- P4/P5 文档对 branch path、compact boundary、provider payload mutation 的边界描述基本符合当前代码。
- `docs/backend/20260618-1-后端代码文件级说明 技术规范.md` 已包含本轮新增的 `system-prompt-update.ts`、`prompt-frame-builder.ts`、`runtime-augmentation.ts`、`ai-request-logger.test.ts` 等文件说明。

过时 / 遗漏 / 易误导项：

- `20260519-6-System Prompt 重新开发阶段收口 报告.md` 说“API replay transcript 必须保留当轮需要的 augmentation 语义”，但没有指出后续请求不会展开历史 augmentation。建议在修复 P1 后更新该收口结论。
- `20260519-5-P5 Provider Adapter 代码审查 报告.md` 的 Finding 3 说 Anthropic 幂等测试可以后补；当前 `provider-payload.test.ts` 已覆盖已有 `cache_control` 和无 text block 两类分支，该 finding 已过时。
- `20260513-7` 与根规则中“已删除 `.lecquy/system-prompt/`”的终态表述，和当前代码兼容现实并存。后续文档应把“终态目标”和“当前兼容路径”分开写。

是否需要补新文档：

需要。建议新增一份短技术规范或修复指令，专门处理“API replay projection 如何展开历史 runtime augmentation”。不要把它和 `.lecquy/system-prompt/` 迁移混在一起。

## 4. 旧代码 / 清洗项

残留但不阻塞的旧路径：

- `.lecquy/system-prompt/*.md` 旧模板 override。
- `buildSystemPromptLegacy` 非 layered fallback。
- `buildMemoryRecallBlockLegacy` PG legacy recall fallback。
- `appendCustomMessageEntry` API 本身仍存在，但当前模型上下文只读取 `display=true`。

可删除候选：

- 旧 `.lecquy/system-prompt/` 模板文件和 `prompt-module-files.ts` 的磁盘 override 逻辑，前提是先完成 BASE/TOOLS/AGENTS 等新文件体系迁移，并改完测试。
- `toolInventory` hash 中的 `toolsEnabled` 字段。

不建议删除的兼容路径：

- 当前不要删除 `buildSystemPromptLegacy`。它仍是非 `LAYERED_PROMPT=true` 路径 fallback。
- 当前不要删除 `appendCustomMessageEntry`。它仍可用于 visible custom context 和旧 session 文件读取。
- 当前不要删除 `.lecquy/system-prompt/` 目录。删除前必须有独立迁移任务和回归测试。

## 5. 测试覆盖缺口

已覆盖关键行为：

- `FrozenSystemSnapshot` 确定性、时间冻结、compact 后重建、current branch restore、corrupt snapshot 跳过。
- `<system_prompt_update>` 的 USER.md cumulative、删除后清空、跨日、timezone 后补、runtime delta、空占位省略。
- runtime prompt frame 当前轮顺序：history -> memory -> update -> current user；worker 路径 memory/update 在 todo snapshot 前。
- `display=false custom_message` 不进入 session context。
- provider payload：OpenAI-compatible 不含 `cache_control`，BigModel / vLLM 只补 `tool_stream`，Anthropic `cache_control` 只在 payload 层。

建议新增回归测试：

- 两轮 replay 测试：第一轮有 memory/update augmentation，第二轮 history 必须展开第一轮 augmentation，且 UI visible transcript 仍不包含这些内容。
- compact boundary 测试：compact 前的历史 augmentation 不重复注入，compact 后保留尾部对应的 augmentation 是否按策略展开或明确丢弃。
- `system_prompt_update` wrapper 固定属性测试：prompt 文本不包含 `generated_at`，审计数据仍有 `createdAt`。
- `toolInventory` 与 `toolsEnabled` 分离测试：关闭工具只触发 runtime delta，不触发 blocked source change。

## 6. 后续建议

优先级建议：

1. 先做 P1 修复：实现 API replay projection，展开历史 runtime augmentation，并补两轮 replay 回归测试。
2. 再做 P2 微调：从 prompt 文本中移除 `generated_at` / `base_snapshot_id`，保留在审计 metadata。
3. 再做 P3 微调：拆分 `toolInventory` 和 `toolsEnabled` 的 hash 语义。
4. 最后单独规划 `.lecquy/system-prompt/` 旧模板迁移，不和 replay 修复混做。

进入后续任务判断：

- 不建议直接进入 provider cache 或 Anthropic transport 端到端任务。
- 可以进入一个聚焦的“P3 replay projection 补洞”任务。
- memory.db 熵增问题仍按根规则延后，不纳入本轮修复。

## 7. 本次验证

本次审查实际执行：

```bash
git status --short --untracked-files=all
git diff --stat
rg "cache_control" backend/src
rg "<LAYER:memory_recall>|display=false|task_result|retrieved_memory|system_prompt_update" backend/src
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
git diff --check
```

结果：

- `pnpm -F @lecquy/backend typecheck` 通过。
- `pnpm -F @lecquy/backend test` 通过，输出 `tests 264 / pass 264 / fail 0`。
- `git diff --check` 通过。
- `rg "cache_control" backend/src` 只命中 `backend/src/agent/provider-payload.ts` 和 `backend/src/agent/provider-payload.test.ts`。
- 旧 `<LAYER:memory_recall>` 未在运行时代码路径命中；仅测试中保留“不应出现”的断言。
- 工作树在审查开始前已有大量 P0-P5 实现与文档改动，本报告未修改业务代码。
