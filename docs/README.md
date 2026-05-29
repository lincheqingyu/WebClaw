# Lecquy Docs

项目文档统一收敛在根目录 `docs/` 下，并按“项目级 / 环境配置 / 前端 / 后端”分组维护。

## 目录导航

- [项目级](./项目级/)：项目总览、Monorepo 使用、产品方向等跨前后端文档
- [环境与配置](./环境与配置/)：环境变量、运行参数、本地配置说明
- [前端文档](./frontend/)：前端规范、网络资源、Markdown 渲染排障
- [后端文档](./backend/README.md)：后端架构、接口、记忆检索、Prompt 与运行时、专题探索

## 当前主线

- [项目级 / 20260408-1-Monorepo 使用指南 技术规范.md](./项目级/20260408-1-Monorepo%20使用指南%20技术规范.md)：了解 workspace 结构和常用命令
- [项目级 / 20260408-2-个人强 Agent 路线 开发规划.md](./项目级/20260408-2-个人强%20Agent%20路线%20开发规划.md)：记录 Lecquy 从 AI Web 向"个人强 Agent"演进的方向
- [项目级 / 20260508-1-个人强 Agent 路线 代码现状审查指令.md](./项目级/20260508-1-个人强%20Agent%20路线%20代码现状审查指令.md)：用 JARVIS / hermes-agent 锚点重审代码、由外部 LLM 出事实清单的审查模板
- [项目级 / 20260508-2-个人强 Agent 路线 代码现状审查报告.md](./项目级/20260508-2-个人强%20Agent%20路线%20代码现状审查报告.md)：DeepSeek 跑出的事实清单——记忆/上下文/循环/压缩/进化接口/沙箱/通用框架占比的现状定级 + 总览表
- [项目级 / 20260508-3-清理通用框架代码 执行指令.md](./项目级/20260508-3-清理通用框架代码%20执行指令.md)：第一周第 1 件——删 HTTP 旧路由 / 旧 Session 模块 / 多 Session 协作工具，喂给 codex 直接执行
- [项目级 / 20260508-4-bash 接入 ChildProcessSandbox 执行指令.md](./项目级/20260508-4-bash%20接入%20ChildProcessSandbox%20执行指令.md)：第一周第 2 件——bash 工具切换沙箱，环境变量隔离 + cwd 锁定 + AbortSignal 集成
- [项目级 / 20260508-5-人格基线 USER SOUL MEMORY 撰写指引.md](./项目级/20260508-5-人格基线%20USER%20SOUL%20MEMORY%20撰写指引.md)：第一周第 3 件——kira 本人手写 .lecquy/USER.md / SOUL.md / MEMORY.md，立刻让 agent "认识你"
- [项目级 / 20260508-6-第二周第 1 件 SQLite 记忆落地 执行指令.md](./项目级/20260508-6-第二周第%201%20件%20SQLite%20记忆落地%20执行指令.md)：第二周第 1 件——`better-sqlite3` + FTS5 替代 PG，extraction-runner 同步改造，project_id 维度 tag 落地
- [项目级 / 20260508-7-第二周第 2 件 召回切换到 SQLite 执行指令.md](./项目级/20260508-7-第二周第%202%20件%20召回切换到%20SQLite%20执行指令.md)：第二周第 2 件——prompt-injector 切到 SQLite 召回，合成排序公式（BM25 + importance + 时间衰减 + 项目软优先）
- [项目级 / 20260508-8-SQLite 记忆冒烟回归修复 执行指令.md](./项目级/20260508-8-SQLite%20记忆冒烟回归修复%20执行指令.md)：第 1 件冒烟暴露的"重复提取"修复——新增 watermark 表 + 提取水位机制 + dedupe.sql 清理脏数据
- [项目级 / 20260508-9-上下文爆炸事故 排查与修复 执行指令.md](./项目级/20260508-9-上下文爆炸事故%20排查与修复%20执行指令.md)：第二件冒烟时触发 1.25M tokens 超 1M 上下文上限事故——诊断日志注入 + 6 类候选根因 + 分支修复策略（已被第 10 份取代，保留作排查方法论）
- [项目级 / 20260508-10-上下文爆炸 根因定位与修复 执行指令.md](./项目级/20260508-10-上下文爆炸%20根因定位与修复%20执行指令.md)：根因锁定 sessions_history 工具——加默认 limit + 输出截断 + 'current' 关键字处理；同类工具 sessions_list / sessions_send 同等防御
- [项目级 / 20260509-11-上下文爆炸 精准排查报告.md](./项目级/20260509-11-上下文爆炸%20精准排查报告.md)：codex 基于第 10 份指令的精准排查产物——发现单条消息 5.3MB base64 图片是真凶，4 个 session-tools 全部缺 TOOL_OUTPUT_LIMIT 截断；纠正了第 10 份指令中 runtime.ts 修改的判断错误
- [项目级 / 20260509-1-上下文架构修复 in-loop 压缩 执行指令.md](./项目级/20260509-1-上下文架构修复%20in-loop%20压缩%20执行指令.md)：上下文管理结构层修复——在三个 runner 注册 `transformContext` 钩子接入 in-loop 压缩、按 Phase 2 落地 token-aware 触发、上传层加体积上限（双层校验+静默截断）；附带"跨 turn 工具失忆是有意设计"等三条决策记录
- [项目级 / 20260510-1-会话连续性修复 peerId 与 UI 状态同步 执行指令.md](./项目级/20260510-1-会话连续性修复%20peerId%20与%20UI%20状态同步%20执行指令.md)：修复"关浏览器再开 → UI 显新会话但消息进旧会话"的撕裂 bug——纯前端最小修复（新增 `lecquy.lastActiveSessionKey` 持久化 + 冷启动反查恢复 + 残留 peerId 清理），明确放弃 DeepSeek 方案 A，且不动后端 dm 路由（peerId → sessionId 重命名留待后续结构性重构）
- [项目级 / 20260512-1-开源项目 system prompt 构成对比分析 审查指令.md](./项目级/20260512-1-开源项目%20system%20prompt%20构成对比分析%20审查指令.md)：喂给 Codex 执行的审查指令——对照 hermes-agent / Kuberwastaken-src / openclaw / opencode / system-prompts-and-models-of-ai-tools 5 个仓库，分析各自 system prompt 的组成、顺序、静态 / 动态分层、设计意图，映射回 Lecquy 6 文件设计的 5 个待决问题（soul/identity 是否合并 / user.md 是否拆 / memory 是否打 tag / tools 纪律是否独立 / agents.md 是否需要）；附借鉴 / 不借鉴清单格式约束 + 严禁建议清单（不引入鉴权 / OAuth / 多租户 / MCP 完整协议）
- [项目级 / 20260512-2-系统提示词上下文工程最终取舍 技术规范.md](./项目级/20260512-2-系统提示词上下文工程最终取舍%20技术规范.md)：**【已废弃 2026-05-13，被 20260513-7 取代】** 原作为后续 system prompt 结构落地的权威技术方向，锁定 7 层 36 子项 + `.lecquy/system-prompt/` 14 模板的结构。落地时暴露两类工程问题（动态片段混入 system 破坏 prompt cache + 26 子项对单人开发者认知负荷过载），结构被 20260513-7 收敛。正文保留作历史归档，§9 记忆 schema / §10 信任分级仍被新文引用
- [项目级 / 20260512-3-system-prompt 最终架构落地 执行指令.md](./项目级/20260512-3-system-prompt%20最终架构落地%20执行指令.md)：喂给 Codex 的落地执行指令——把 20260512-2 锁定的最终架构落到 `.lecquy/` 真实目录 + backend 代码。分 4 个 Phase（0 现状勘察 / 1 文件骨架 / 2 prompt builder 7 层重构 / 3 memory schema 9 维标签迁移 / 4 验收），**本指令只覆盖 Phase 0 + 1**。**【2026-05-13 更新】** Phase 0 / 1 在新结构下仍可继续执行（`.lecquy/` 主要文件骨架保留）；**Phase 2/3/4 已冻结**，新执行指令须基于 20260513-7 重写。强约束：不重新设计文件体系、不引入 `core.md` / `tools-discipline.md` / `context-loader.md` / `agent.yaml`、不主动改写用户已有人格文件内容、每个 Phase 完成必须停等 kira review、git commit 单文件颗粒度便于回滚
- [项目级 / 20260513-7-系统提示词模块再合并与缓存命中优化 决策沉淀.md](./项目级/20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md)：取代 20260512-2，作为 system prompt 当前权威架构。采用会话级 `FrozenSystemSnapshot` + 用户问题前 `<system_prompt_update>` 的缓存友好方案：同一会话内 API `system` 字段保持字节级稳定，可变核心文件、日期、mode、active skill 等通过 cumulative since snapshot 的 update block 即时生效，并在 compact 时吸收到新 snapshot；当前主路线优先适配 OpenAI-compatible API，Anthropic `cache_control` 只属于 Anthropic adapter；MemoryRecall 移出 system 字段，挂在当轮 API user message 内用 `<retrieved_memory priority="low">` 包裹，同时区分用户可见 transcript / API replay transcript / augmentation 记录；删除 `.lecquy/system-prompt/` 前必须先迁移旧 loader 与测试。
- [项目级 / 20260525-1-记忆与上下文设计理念 决策沉淀.md](./项目级/20260525-1-记忆与上下文设计理念%20决策沉淀.md)：把散落各处的记忆 / 上下文 / compact 规范压成一张"当前理念地图"，给 kira 回顾路线、做后续决策用（非执行指令）。以当前定论为主、旧路线作简短背景，覆盖三条主线：记忆（SQLite+FTS5、文件分层、9 维 schema、晋升防熵增、召回下沉、三份数据分离）、上下文（FrozenSystemSnapshot 冻结 + cumulative `<system_prompt_update>` + 信任分级 + provider 边界）、compact（in-loop / 事件树投影 / 事后 LLM 摘要三层 + compact 即 snapshot 生命周期边界）；附旧→新演进时间线速查与"哪份旧文档已被哪份取代"的对照
- [项目级 / 20260529-2-全量移除 PG 回到 SQLite 纯净状态 执行指令.md](./项目级/20260529-2-全量移除%20PG%20回到%20SQLite%20纯净状态%20执行指令.md)：执行 CLAUDE.md 已定的 PG 物理删除决策，移除 `backend/src/db`、旧 RAG、foresight-sync、PG dev 冒烟脚本和 PG 环境变量，让记忆与会话主线回到 SQLite + JSONL 文件。
- [backend / System Prompt 重新开发 / 20260518-1-System Prompt 重新开发指导 技术规范](./backend/System%20Prompt%20重新开发/20260518-1-System%20Prompt%20重新开发指导%20技术规范.md)：本轮后端 system prompt 重做的执行指导，覆盖 snapshot、update、transcript 分层、provider adapter、阶段拆解与验收用例。
- [backend / System Prompt 重新开发 / 20260518-2-P0 入口同步与 Prompt 链路审查 报告](./backend/System%20Prompt%20重新开发/20260518-2-P0%20入口同步与%20Prompt%20链路审查%20报告.md)：P0 入口同步与现有 prompt 代码链路审查，记录 layered / legacy system 序列、MemoryRecall 现状和 P1 切入点。
- [backend / System Prompt 重新开发 / 20260518-3-P1 FrozenSystemSnapshot Builder 开发指导 技术规范](./backend/System%20Prompt%20重新开发/20260518-3-P1%20FrozenSystemSnapshot%20Builder%20开发指导%20技术规范.md)：P1 snapshot builder 的开发契约，覆盖类型、source hash、时间冻结、session event tree 存储、runtime 接入与验收测试。
- [backend / System Prompt 重新开发 / 20260518-4-P1 FrozenSystemSnapshot 代码审查 报告](./backend/System%20Prompt%20重新开发/20260518-4-P1%20FrozenSystemSnapshot%20代码审查%20报告.md)：P1 落地后的代码审查，指出 role-only snapshot cache、弱 restore 校验和 P2 前置测试缺口。
- [backend / System Prompt 重新开发 / 20260518-5-P2 SystemPromptUpdate Builder 开发指导 技术规范](./backend/System%20Prompt%20重新开发/20260518-5-P2%20SystemPromptUpdate%20Builder%20开发指导%20技术规范.md)：P2 `<system_prompt_update>` 的开发契约，覆盖 cumulative update、runtime delta、editable context、blocked source changes、synthetic message 接入和验收测试。
- [backend / System Prompt 重新开发 / 20260518-6-P2 SystemPromptUpdate 代码审查 报告](./backend/System%20Prompt%20重新开发/20260518-6-P2%20SystemPromptUpdate%20代码审查%20报告.md)：P2 落地后的代码审查，确认 update 主链路完成，并记录 timezone 补入、toolInventory hash 与 P3 replay 审计交接项。
- [backend / System Prompt 重新开发 / 20260518-7-P3 Transcript 与 Replay 分层开发指导 技术规范](./backend/System%20Prompt%20重新开发/20260518-7-P3%20Transcript%20与%20Replay%20分层开发指导%20技术规范.md)：P3 开发契约，明确用户可见 transcript、API replay transcript、runtime augmentation 三条数据线，以及 MemoryRecall tag 迁移和 prompt frame 顺序。
- [backend / System Prompt 重新开发 / 20260519-1-P3 Transcript 与 Replay 代码审查 报告](./backend/System%20Prompt%20重新开发/20260519-1-P3%20Transcript%20与%20Replay%20代码审查%20报告.md)：P3 落地后的代码审查，确认 memory/update 分层完成，并记录 hidden `task_result`、promptFrame 精确回放和 augmentation 校验遗留。
- [backend / System Prompt 重新开发 / 20260519-2-P4 Compact 与 Resnapshot 开发指导 技术规范](./backend/System%20Prompt%20重新开发/20260519-2-P4%20Compact%20与%20Resnapshot%20开发指导%20技术规范.md)：P4 开发契约，定义 compact boundary、lazy resnapshot、update 归零、runtime augmentation 精确 replay 与验收测试。
- [backend / System Prompt 重新开发 / 20260519-3-P4 Compact 与 Resnapshot 代码审查 报告](./backend/System%20Prompt%20重新开发/20260519-3-P4%20Compact%20与%20Resnapshot%20代码审查%20报告.md)：P4 落地后的代码审查，确认 compact boundary、lazy resnapshot、P4.0 前置修复完成，并记录 branch 边界和维护性遗留。
- [backend / System Prompt 重新开发 / 20260519-4-P5 Provider Adapter 开发指导 技术规范](./backend/System%20Prompt%20重新开发/20260519-4-P5%20Provider%20Adapter%20开发指导%20技术规范.md)：P5 开发契约，固定 provider adapter 边界，要求 OpenAI-compatible 主路径不出现 Anthropic `cache_control`，Anthropic 差异只停留在 adapter 层。
- [backend / System Prompt 重新开发 / 20260519-5-P5 Provider Adapter 代码审查 报告](./backend/System%20Prompt%20重新开发/20260519-5-P5%20Provider%20Adapter%20代码审查%20报告.md)：P5 落地后的代码审查，确认 provider payload mutation 边界完成，记录 Anthropic 端到端 transport 仍是非目标。
- [backend / System Prompt 重新开发 / 20260519-6-System Prompt 重新开发阶段收口 报告](./backend/System%20Prompt%20重新开发/20260519-6-System%20Prompt%20重新开发阶段收口%20报告.md)：本轮 P0-P5 阶段收口，汇总 snapshot、update、replay、compact、provider adapter 的已闭环不变量和后续独立维护项。
- [backend / System Prompt 重新开发 / 20260519-7-System Prompt 重新开发整体审查 Goal 提示词 审查指令](./backend/System%20Prompt%20重新开发/20260519-7-System%20Prompt%20重新开发整体审查%20Goal%20提示词%20审查指令.md)：Codex CLI `/goal` 整体审查提示词，要求审查 P0-P5 代码、测试、文档一致性并落整体审查报告。
- [backend / System Prompt 重新开发 / 20260519-8-System Prompt 重新开发整体审查 报告](./backend/System%20Prompt%20重新开发/20260519-8-System%20Prompt%20重新开发整体审查%20报告.md)：Codex 按 `/goal` 指令完成的 P0-P5 整体审查，确认主链路大体落地，同时记录历史 runtime augmentation 未进入后续 API replay projection 的 P1 缺口。
- [项目级 / 20260513-6-代码文件头双语摘要补齐 执行指令.md](./项目级/20260513-6-代码文件头双语摘要补齐%20执行指令.md)：为后续 GPT-5.3 批量补齐全仓代码文件头注释准备的执行指令；要求所有项目自有代码文件开头有简洁中英双语文件级摘要，明确跳过生成文件、lockfile、纯数据文件和第三方代码，且禁止夹带逻辑修改、重构或格式化。
- [环境与配置 / 20260408-8-环境参数配置 技术规范.md](./环境与配置/20260408-8-环境参数配置%20技术规范.md)：统一本地环境变量与配置入口
- [后端 / 记忆与检索 / 20260408-3-Runtime Memory Compact 决策沉淀 技术规范.md](./backend/记忆与检索/20260408-3-Runtime%20Memory%20Compact%20决策沉淀%20技术规范.md)：后端记忆 / compact 决策基线
- [后端 / Claude 上下文压缩复刻 / 20260430-14-Phase 1 codex 审查报告.md](./backend/Claude%20上下文压缩复刻/20260430-14-Phase%201%20codex%20审查报告.md)：Phase 1 LLM 摘要升级的 codex 审查与分诊结论
- [后端 / Claude 上下文压缩复刻 / 20260430-15-Phase 2 token-aware 触发策略 技术规范.md](./backend/Claude%20上下文压缩复刻/20260430-15-Phase%202%20token-aware%20触发策略%20技术规范.md)：Phase 2 token-aware 压缩触发策略、recent tail token budget 与验收口径
- [后端 / 沙箱权限与命令拦截 / 20260424-1-Codex 风格权限审批协议 技术规范.md](./backend/沙箱权限与命令拦截/20260424-1-Codex%20风格权限审批协议%20技术规范.md)：确认权限审批采用 WS 传输 + Codex-style server request 协议
- [前端 / 20260417-1-Markdown 渲染排障 技术规范.md](./frontend/20260417-1-Markdown%20渲染排障%20技术规范.md)：前端 Markdown 渲染问题排障入口
- [前端 / 20260422-1-消息时间线与工具动作呈现 技术规范.md](./frontend/20260422-1-消息时间线与工具动作呈现%20技术规范.md)：统一思考、tool 与文件动作在消息时间线中的展示口径
- [前端 / 20260423-1-消息时间线视觉收敛 技术规范.md](./frontend/20260423-1-消息时间线视觉收敛%20技术规范.md)：时间线事件原语 `TimelineEvent` 收敛 + `ArtifactPanel` 流式跟随（替代 20260422-2，后者已归档）
- [前端 / 20260429-1-上下文占比圆圈指示器 技术规范.md](./frontend/20260429-1-上下文占比圆圈指示器%20技术规范.md)：ProgressCircle SVG 实现、token 计算链路、本地/API 模型有效性分析
- [前端 / 20260509-2-流式渲染卡顿排查 审查报告.md](./frontend/20260509-2-流式渲染卡顿排查%20审查报告.md)：全链路排查流式渲染卡顿，定位 5 个前端瓶颈点（MessageItem 缺 memo、StreamdownMarkdown 重解析、thinking 计时器等），附修复方案按投入产出比排序
- [前端 / 20260509-3-流式渲染卡顿 第二轮排查 审查报告.md](./frontend/20260509-3-流式渲染卡顿%20第二轮排查%20审查报告.md)：第二轮在第一轮"组件层"基础上挖出渲染管线 / 副作用层结构性问题——MessageList 每帧双重布局回弹（layout thrashing）、createBlocksSignature/summarizeBlocks 在 debug 关闭时仍全量序列化、N 个 MutationObserver、StreamdownMarkdown hooks 违例等；附与第一轮合并后的 P0-P3 优先级表
- [前端 / 20260509-4-流式渲染卡顿 治本修复 执行指令.md](./frontend/20260509-4-流式渲染卡顿%20治本修复%20执行指令.md)：取代前两份审查报告里的修复建议；按"治本 + 删代码 + 长对话不复现"三条标准把方案分三阶段——阶段一（删 chat-stream-debug 整套 / 删死代码 / overflow-anchor 替手写贴底 / 修 hooks 顺序，约 250 行净减）、阶段二（memo 一族 + dark-mode 提全局，实测后决定）、阶段三（虚拟化 + 流式消息脱离 React，仅长对话不达标时启动）；含明确拒绝清单（rAF throttle / 引入状态管理库 / 上游 fork）
- [前端 / 20260513-1-设置栏极简重设计 技术规范.md](./frontend/20260513-1-设置栏极简重设计%20技术规范.md)：Runtime mode 信息架构与字段映射规范。**v0.2（2026-05-13 晚）已对齐 RightRail 落地后的 4 卡片合并**：Agent Runtime（含 AGENT / SAMPLING / TOOLS / REASONING 四子区）/ Role Context / Kernel / Memory Runtime，默认全部折叠；§3 视觉语言已被 20260513-2 §7 + 20260513-3 §14 覆盖，本规范当前仅 §4 / §5 / §7 / §8 有效。附 §5 字段到 pi-agent-core 参数映射表、§8 验收口径、Kernel markdown 编辑"未来方向：表单 + 对话式录入"占位
- [前端 / 20260513-2-右侧工作区设计 技术规范.md](./frontend/20260513-2-右侧工作区设计%20技术规范.md)：把右侧从独立 Settings 抽屉提升为统一 RightRail 工作区；定义 Context / Progress / Artifact / Memory / Runtime / Approval 六个 mode、优先级、视觉语言、响应式策略和迁移路径，作为后续右侧重构方向备份
- [前端 / 20260513-3-右侧工作区人机交互逻辑 技术规范.md](./frontend/20260513-3-右侧工作区人机交互逻辑%20技术规范.md)：以 Claude Code 的伴随式右侧工作区为主要参考，从真实编码/等待/查看文件/审批/调整 runtime/追溯记忆场景反推 RightRail 的 HCI 逻辑；定义用户显式优先、弱自动打开、Approval 阻塞置顶、Esc/focus、响应式、会话级持久化，以及“严格模仿 Claude Code UI、禁止在旧 UI 上反复补丁、允许从头重构”的实现硬规则
- [前端 / 20260513-4-RightRail 状态机落地 技术规范.md](./frontend/20260513-4-RightRail%20状态机落地%20技术规范.md)：RightRail 第二阶段第 1 步——把 20260513-3 §6-§7 的状态机契约从纸面落到 reducer。审计现有 `rightRailState.ts` 已具备 / 缺失项，补齐 11 项 action（含 `request-approval` / `resolve-approval` / `progress-event` / `artifact-draft-detected`）、16 条 transition 表、§3.5 五条不变量、§3.4 Esc 的 mode 分级子表、§5 vitest 契约用例清单；并要求收敛 `HomePageLayout` 的 `openDocument` 旧状态到 `artifactRef`、把弱自动打开 useEffect 改成 dispatch action，消除 20260513-3 §14.7 "两套互斥状态"红线。本规范只覆盖状态机本身，不实现各 mode 内容
- [前端 / 20260513-5-RightRail 状态机落地 执行指令.md](./frontend/20260513-5-RightRail%20状态机落地%20执行指令.md)：20260513-4 技术规范的可执行版本，喂给 Codex 分 5 Phase 落地：Phase 0 现状勘察（确认 5 个 anchor）/ Phase 1 先写 vitest 测试跑红 / Phase 2 补 reducer 实现到 16 条 transition + `assertInvariants` / Phase 3 删除 `openDocument` useState 并改用 `artifactRef` 派生 + draft auto-open 改 dispatch / Phase 4 全局 Esc 监听 + 齿轮收敛 / Phase 5 对照 §8 验收口径打勾。每 Phase 一个 commit、强制停等 kira review，禁止跳 Phase；附 §7 偏差记录追加段，遇到与预期不符时由 Codex 写入由 kira 决策

## 归档说明

- 旧的图表渲染问题交接文档已移入 [frontend/历史归档](./frontend/历史归档/)；正式排障请优先查看当前前端文档。
