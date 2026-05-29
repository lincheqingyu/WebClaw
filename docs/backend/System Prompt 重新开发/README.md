# System Prompt 重新开发

> 更新日期：2026-05-19
> 类型：导航
> 关联：[系统提示词模块再合并与缓存命中优化 决策沉淀](../../项目级/20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md)

本目录用于收敛 Lecquy 后端 system prompt 重新开发的设计、执行指导、验收记录和复盘。

## 当前文档

- [20260518-1-System Prompt 重新开发指导 技术规范](./20260518-1-System%20Prompt%20重新开发指导%20技术规范.md)：定义本轮重做的目标、边界、数据契约、阶段拆解和验收标准。
- [20260518-2-P0 入口同步与 Prompt 链路审查 报告](./20260518-2-P0%20入口同步与%20Prompt%20链路审查%20报告.md)：记录入口同步、现有 prompt 构建链路、当前 system/messages 序列和 P1 切入点。
- [20260518-3-P1 FrozenSystemSnapshot Builder 开发指导 技术规范](./20260518-3-P1%20FrozenSystemSnapshot%20Builder%20开发指导%20技术规范.md)：定义 P1 snapshot builder 的类型、source hash、存储、runtime 接入和验收测试。
- [20260518-4-P1 FrozenSystemSnapshot 代码审查 报告](./20260518-4-P1%20FrozenSystemSnapshot%20代码审查%20报告.md)：审查 P1 落地结果，记录 role-only snapshot cache、弱 restore 校验、P2 设计约束和测试缺口。
- [20260518-5-P2 SystemPromptUpdate Builder 开发指导 技术规范](./20260518-5-P2%20SystemPromptUpdate%20Builder%20开发指导%20技术规范.md)：定义 P2 update builder、变化分类、序列化格式、runtime 接入和验收测试。
- [20260518-6-P2 SystemPromptUpdate 代码审查 报告](./20260518-6-P2%20SystemPromptUpdate%20代码审查%20报告.md)：审查 P2 落地结果，记录 timezone 补入、toolInventory hash 与 replay 审计交接问题。
- [20260518-7-P3 Transcript 与 Replay 分层开发指导 技术规范](./20260518-7-P3%20Transcript%20与%20Replay%20分层开发指导%20技术规范.md)：定义 P3 用户可见 transcript、API replay transcript、runtime augmentation 的分层契约和验收测试。
- [20260519-1-P3 Transcript 与 Replay 代码审查 报告](./20260519-1-P3%20Transcript%20与%20Replay%20代码审查%20报告.md)：审查 P3 落地结果，记录 hidden `task_result`、promptFrame 精确回放和 augmentation restore 校验遗留。
- [20260519-2-P4 Compact 与 Resnapshot 开发指导 技术规范](./20260519-2-P4%20Compact%20与%20Resnapshot%20开发指导%20技术规范.md)：定义 P4 compact boundary、lazy resnapshot、update 归零和 P4.0 前置修复。
- [20260519-3-P4 Compact 与 Resnapshot 代码审查 报告](./20260519-3-P4%20Compact%20与%20Resnapshot%20代码审查%20报告.md)：审查 P4 落地结果，确认 compact boundary / lazy resnapshot / P4.0 前置修复，并记录 branch 边界遗留。
- [20260519-4-P5 Provider Adapter 开发指导 技术规范](./20260519-4-P5%20Provider%20Adapter%20开发指导%20技术规范.md)：定义 P5 provider adapter 边界，固定 OpenAI-compatible 主路径和 Anthropic `cache_control` 的 adapter-only 约束。
- [20260519-5-P5 Provider Adapter 代码审查 报告](./20260519-5-P5%20Provider%20Adapter%20代码审查%20报告.md)：审查 P5 落地结果，确认 provider payload mutation 边界完成，并记录 Anthropic transport 非目标。
- [20260519-6-System Prompt 重新开发阶段收口 报告](./20260519-6-System%20Prompt%20重新开发阶段收口%20报告.md)：汇总 P0-P5 已闭环能力、当前不变量和后续独立维护项。
- [20260519-7-System Prompt 重新开发整体审查 Goal 提示词 审查指令](./20260519-7-System%20Prompt%20重新开发整体审查%20Goal%20提示词%20审查指令.md)：用于 Codex CLI `/goal` 的整体审查提示词，要求审查 P0-P5 效果并落整体审查报告。
- [20260519-8-System Prompt 重新开发整体审查 报告](./20260519-8-System%20Prompt%20重新开发整体审查%20报告.md)：整体审查 P0-P5 代码、测试与文档一致性，记录历史 runtime augmentation 未进入后续 API replay projection 的 P1 缺口。

## 关联入口

- [项目级 / 20260513-7-系统提示词模块再合并与缓存命中优化 决策沉淀](../../项目级/20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md)
- [后端 / Prompt 与运行时](../Prompt%20与运行时/)
