# System Prompt 重新开发阶段收口

> 更新日期：2026-05-19
> 类型：审查报告
> 关联：[P5 Provider Adapter 代码审查](./20260519-5-P5%20Provider%20Adapter%20代码审查%20报告.md)

## 1. 收口结论

本轮 system prompt 重新开发 P0-P5 主线已闭环。落地结果与 `20260513-7` 的方向一致：会话级 `FrozenSystemSnapshot` 保持 system 字段稳定，运行期变化通过 cumulative `<system_prompt_update>` 注入，MemoryRecall / task result / prompt update 作为 runtime augmentation 参与 API replay，不污染用户可见 transcript，compact 后重新生成 snapshot，provider 差异只停留在 payload adapter 层。

这轮不再继续追加 P6。后续只保留独立维护项和真实需求触发的 adapter / 旧兼容清理任务。

## 2. 已闭环能力

### P0：入口同步与链路审查

- 已确认 system prompt 主装配入口、模块文件加载、运行时上下文读取、user layer 解析、capability block、layer 类型和 serializer 的现状。
- 已落 P1 开发指导。

### P1：FrozenSystemSnapshot

- 新会话创建一次 snapshot。
- snapshot 包含 `systemText`、content hash、source hash、slice hash、slice token、冻结时间和 created reason。
- restore 时校验内容 hash、role / mode / createdAt、source / slice 形状。
- 损坏 snapshot entry 会被跳过并重建 fresh snapshot。

### P2：SystemPromptUpdate

- 会话中途日期 / 时区、runtime delta、可编辑上下文、active skill、blocked source changes 通过 `<system_prompt_update>` 注入。
- update 是 cumulative since snapshot，不是 delta since previous。
- snapshot 缺 timezone 时，后续 timezone 补入会明确输出 update。

### P3：Transcript / Replay / Augmentation 分层

- 用户可见 transcript 只保存真实 user message。
- `<retrieved_memory>`、`<system_prompt_update>`、`<plan_task_result>` 只作为 runtime augmentation 和 replay frame 的 synthetic context。
- 每次请求有独立 `promptFrameId`，AI request log 记录 `promptFrame` 元数据。
- hidden `custom_message display=false` 不再进入 session context。

### P4：Compact / Resnapshot

- compact 是 snapshot 生命周期边界。
- compact 后旧 snapshot hot cache 失效，下一轮懒创建 `createdReason: 'compact'` 的 fresh snapshot。
- restore 只接受当前 branch compact boundary 之后的 snapshot。
- branch sibling snapshot 不会污染当前 branch。

### P5：Provider Adapter

- `cache_control` 只出现在 `backend/src/agent/provider-payload.ts` 和对应测试。
- OpenAI-compatible / vLLM / BigModel 主路径不引入 Anthropic 字段。
- AI request log 同时记录 provider-neutral `promptFrame` 和最终 provider payload。

## 3. 当前不变量

- 同一个 `FrozenSystemSnapshot` 生命周期内，API `system` 字段保持字节级稳定。
- 日期、timezone、mode、model、USER.md、MEMORY.summary.md、active skill 等即时变化只能通过 `<system_prompt_update>` 表达。
- update block 必须 cumulative since snapshot，不能只表达上轮之后的增量。
- MemoryRecall 不进 system 字段，使用 `<retrieved_memory priority="low" source="lecquy">`。
- 用户可见 transcript 不显示、不导出 synthetic context。
- API replay transcript 必须保留当轮需要的 augmentation 语义。
- compact 后旧 snapshot 不跨 boundary 恢复。
- provider 专属字段不进入 core prompt / runtime context。

## 4. 保留后续项

### 4.1 注释密度整理

`backend/src/core/prompts/system-prompt-snapshot.ts` 的注释密度偏高。该问题不影响行为，但会增加后续 review 成本。建议单独做维护性整理，只删教学式或重复注释，不改逻辑。

### 4.2 Anthropic 端到端 adapter

P5 只固定 provider payload mutation 边界，不代表 Anthropic 直连已经端到端完成。未来如需真正接 Anthropic，需要独立设计 request serializer、tool result、stream event 与 error 映射。

### 4.3 旧 `.lecquy/system-prompt/` 兼容清理

旧模板兼容目录的迁移 / 删除不能作为“顺手清理”处理。只有在确认调用方和测试全部迁移后，才能单独立项删除。

### 4.4 更长周期的 memory 熵增问题

本轮只处理 prompt / replay / compact 链路，不处理 memory.db 的遗忘、衰减、矛盾合并。该问题仍按根规则 §8.1 延后，等 memory 写入链路稳定且出现真实污染案例后再立项。

## 5. 最新验证

实现方报告最新验证通过：

```bash
pnpm -F @lecquy/backend typecheck
pnpm -F @lecquy/backend test
git diff --check
rg "cache_control" backend/src/core/prompts backend/src/runtime/context
```

本收口报告未重新执行全量测试。
