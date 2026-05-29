# System Prompt 重新开发整体审查 Goal 提示词

> 更新日期：2026-05-19
> 类型：审查指令
> 关联：[System Prompt 重新开发阶段收口](./20260519-6-System%20Prompt%20重新开发阶段收口%20报告.md)

本文档用于 Codex CLI `/goal` 审查 Lecquy 后端 system prompt 重新开发 P0-P5 的整体落地效果。执行时要求只审查并落报告文档，不修改业务代码，不自动修复。

## 可直接粘贴到 `/goal` 的提示词

```markdown
审查 Lecquy 后端 system prompt 重新开发 P0-P5 的整体落地效果。先审查代码、测试、文档，再落审查报告文档；不要修改业务代码，不要自动修复。

## 背景

本轮任务依据：
- `AGENTS.md` / `CLAUDE.md`
- `docs/项目级/20260513-7-系统提示词模块再合并与缓存命中优化 决策沉淀.md`
- `docs/backend/System Prompt 重新开发/` 下 P0-P5 开发指导、审查报告、阶段收口文档

已完成阶段：
- P0：入口同步与 prompt 链路审查
- P1：FrozenSystemSnapshot
- P2：SystemPromptUpdate
- P3：Transcript / Replay / Runtime Augmentation 分层
- P4：Compact / Resnapshot
- P5：Provider Adapter

## 必读

先读：
- `AGENTS.md`
- `CLAUDE.md`
- `docs/项目级/20260513-7-系统提示词模块再合并与缓存命中优化 决策沉淀.md`
- `docs/backend/System Prompt 重新开发/README.md`
- `docs/backend/System Prompt 重新开发/20260519-6-System Prompt 重新开发阶段收口 报告.md`

重点代码：
- `backend/src/core/prompts/system-prompt-snapshot.ts`
- `backend/src/core/prompts/system-prompt-update.ts`
- `backend/src/runtime/session-runtime-service.ts`
- `backend/src/runtime/context/runtime-augmentation.ts`
- `backend/src/runtime/context/prompt-frame-builder.ts`
- `backend/src/runtime/pi-session-core/session-manager.ts`
- `backend/src/agent/provider-payload.ts`
- `backend/src/agent/ai-request-logger.ts`
- `backend/src/agent/agent-runner.ts`
- `backend/src/agent/manager-runner.ts`
- `backend/src/agent/worker-runner.ts`
- `backend/src/memory/prompt-injector.ts`

重点测试：
- `backend/src/core/prompts/__tests__/system-prompt-snapshot.test.ts`
- `backend/src/core/prompts/__tests__/system-prompt-update.test.ts`
- `backend/src/runtime/__tests__/system-prompt-snapshot-runtime.test.ts`
- `backend/src/runtime/__tests__/system-prompt-update-runtime.test.ts`
- `backend/src/runtime/context/augmented-context-builder.test.ts`
- `backend/src/runtime/pi-session-core/session-manager.test.ts`
- `backend/src/agent/provider-payload.test.ts`
- `backend/src/agent/ai-request-logger.test.ts`

## 审查重点

请以代码事实为准，不要只复述文档。重点检查：

1. Bug / 行为风险
- snapshot 是否可能被错误复用
- corrupt snapshot / corrupt augmentation 是否会被安全跳过
- compact / branch / hot cache 是否跨分支污染
- update 是否真的是 cumulative since snapshot
- replay frame 是否会丢失 synthetic context
- provider payload mutation 是否污染 core prompt

2. 旧代码与切换
- 是否还有旧 `<LAYER:memory_recall>` 路径
- 是否还有 hidden `custom_message display=false` 注入上下文
- MemoryRecall 是否仍可能进入 system 字段
- `.lecquy/system-prompt/` 旧兼容逻辑是否被错误使用
- legacy 路径是否被无意破坏

3. system prompt 顺序与缓存契约
- FrozenSystemSnapshot layer 顺序是否符合文档
- 同一 snapshot 生命周期内 API `system` 是否字节级稳定
- 日期 / timezone / USER.md / MEMORY.summary.md / active skill 等变化是否只走 `<system_prompt_update>`
- compact 后是否重新吸收最新稳定上下文并让 update 归零

4. Transcript / Replay / Augmentation
- 用户可见 transcript 是否只包含真实用户消息
- `<retrieved_memory>`、`<system_prompt_update>`、`<plan_task_result>` 是否只作为 runtime augmentation / replay frame 出现
- `promptFrameId` 是否能精确解释每次请求
- augmentation restore 校验是否足够强

5. Provider Adapter
- `cache_control` 是否只在 provider adapter / tests
- OpenAI-compatible / vLLM / BigModel 是否没有 Anthropic 专属字段
- 文档是否明确 P5 不等于 Anthropic 端到端 transport

6. 文档一致性
- P0-P5 文档是否准确反映代码事实
- `docs/README.md` 和 system prompt 目录 README 是否更新
- `backend/src` 新增/删除是否同步 `docs/backend/20260618-1-后端代码文件级说明 技术规范.md`
- 阶段收口文档是否遗漏重要边界或后续项

## 建议运行

可以运行：
- `git status --short --untracked-files=all`
- `git diff --stat`
- `rg "cache_control" backend/src`
- `rg "<LAYER:memory_recall>|display=false|task_result|retrieved_memory|system_prompt_update" backend/src`
- `pnpm -F @lecquy/backend typecheck`
- `pnpm -F @lecquy/backend test`
- `git diff --check`

如测试耗时或失败，记录具体结果即可，不要修复。

## 输出与落文档

审查完成后，新增一份文档：

`docs/backend/System Prompt 重新开发/YYYYMMDD-X-System Prompt 重新开发整体审查 报告.md`

并同步更新：
- `docs/backend/System Prompt 重新开发/README.md`
- `docs/README.md`

报告结构：

1. 审查结论
- P0-P5 是否可视为完成
- 是否发现 P0/P1 blocker

2. Findings
- 按 P0 / P1 / P2 / P3 排序
- 每条包含：标题、严重级别、相关文件行号、具体问题、违反的文档契约或风险、建议修复方向

3. 文档一致性
- 准确项
- 过时 / 遗漏 / 易误导项
- 是否需要补新文档

4. 旧代码 / 清洗项
- 残留但不阻塞的旧路径
- 可删除候选
- 不建议删除的兼容路径

5. 测试覆盖缺口
- 已覆盖关键行为
- 建议新增回归测试

6. 后续建议
- 是否进入后续任务
- 后续任务优先级

限制：
- 不要修改业务代码。
- 不要重新设计 system prompt 文件体系。
- 不要提出多用户、gateway、OAuth、通用 provider 平台等方向。
- 不要把 memory.db 熵增混入本轮修复，它是显式延后项。
```
