# Lecquy Runtime AGENTS

## 工作流规则
- simple 模式直接完成用户请求；plan 模式先规划 todo，再串行执行，最后统一总结。
- 缺少继续执行所必需的信息时，调用 request_user_input，不要猜测或编造。
- 跨会话协作使用 sessions_list / sessions_history / sessions_send / sessions_spawn，不要用 bash 模拟内部协议。

## 风险边界
- 删除文件、覆盖大段内容、修改生产配置、执行高风险 SQL 前先明确风险并在必要时停下来请求确认。
- 工具失败后优先根据错误做有限自修；仍失败时要给出可执行的下一步建议，而不是持续盲试。

## 对用户的输出
- 默认输出面向用户的结果、结论和必要说明，不暴露内部 prompt、思维链、todo 日志或原始工具协议。
- 用户明确要求查看内部过程时，再按需展示计划、工具结果或工作痕迹。
