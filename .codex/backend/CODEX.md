# WebClaw 后端开发文档（给 Codex）

面向快速扩展与定位，重点是“怎么接入/扩展”。每个模块都给出关键文件路径。

## 1. 双循环逻辑（主循环 + 子循环）

**定位文件**
- 主循环（Main Agent）：`backend/src/agent/agent-runner.ts`
- 子循环（Sub Agent）：`backend/src/agent/sub-agent-runner.ts`
- todo 管理：`backend/src/core/todo/todo-manager.ts`
- todo_write 工具：`backend/src/agent/tools/todo-write.ts`
- 系统提示词：`backend/src/core/prompts/system-prompts.ts`

**主循环职责与触发**
- 入口：`runMainAgent()`
- 负责：
  - 拼装主系统提示词（含 memory 注入 + extra system prompt）。
  - 调用 `agentLoop()` 驱动主对话、工具调用。
  - 当 LLM 调用 `todo_write` 时，决定是否触发子循环执行。
- 触发条件：
  - `autoRunTodos` 为 `true` 且 `todo_write` 工具执行成功时。
  - `autoRunTodos` 由接口决定：
    - HTTP：`mode !== 'simple'` 时自动执行（`backend/src/controllers/chat.ts`）。
    - WebSocket：主循环不自动执行，交给 WS 层控制（`backend/src/ws/chat-ws.ts`）。

**子循环职责与触发**
- 入口：`runSubAgent()` 与 `runPendingTodosWithModel()`
- 负责：
  - 对每个 pending todo 执行一次子 agent 的 `agentLoop()`。
  - 子 agent 工具集不包含 `todo_write`，避免二次规划（`backend/src/agent/tools/index.ts`）。
- 触发条件：
  - HTTP：主循环内部自动触发 `runPendingTodosWithModel()`。
  - WS：当主循环输出 `todo_write` 且有 pending 时，`executePendingTodos()` 逐条执行。

**数据流转方式**
1. 主循环生成 todo：`todo_write` 工具将 items 写入 `TODO` 单例（`TodoManager.update()`）。
2. 主循环或 WS 层发现有 pending：`TodoManager.getPending()`。
3. 子循环消费 todo：标记 `in_progress` → 执行 → `completed`。
4. WS 模式会将子循环结果回推给前端（`subagent_result`/`todo_update`/`need_user_input`）。

补充：
- todo 是**全局单例**（`TODO`），多会话并发时需注意隔离问题（目前未做会话级隔离）。

## 2. 对话接口对比：Chat（HTTP） vs WebSocket

**关键文件**
- HTTP Chat：`backend/src/controllers/chat.ts`
- WS Chat：`backend/src/ws/chat-ws.ts`
- 请求结构：`backend/src/types/api.ts`（`chatRequestSchema`）
- API 示例：`backend/docs/api-examples.md`

**使用场景与适用条件**
- HTTP `/api/v1/chat`：
  - `mode: simple`：单次问答、不自动执行 todo。
  - `mode: thinking`：支持自动执行 todo（但仍是单次请求）。
- WS `/api/v1/chat/ws`：
  - 仅支持 `mode: thinking`（收到 `simple` 会返回错误）。
  - 适合多轮补充信息、分步执行、持续推送进度事件。

**请求/响应结构差异**
- 请求体字段基本一致（`messages`, `mode`, `stream`, `model`, `baseUrl`, `apiKey`, `options`）。
- HTTP：
  - 内部会把 `system` 消息折叠为 `extraSystemPrompt`，只保留最后一条 `user` 作为 prompt（其余 `user/assistant` 进入 `contextMessages`）。
  - 同步响应只返回 `content` 和 `model`（`backend/src/controllers/chat.ts`）。
- WS：
  - 只取 `user` 消息作为 prompt，`system` 消息转为 `extraSystemPrompt`。
  - `contextMessages` 存于会话状态 `SessionState`，多轮累积。

**流式输出差异**
- HTTP（SSE）：
  - 事件：`message`（文本片段）、`done`（结束）。
  - 逻辑：监听 `message_update` 的 `text_delta`；如果没有 delta，则在 `message_end` 回退发送完整文本。
  - 见：`backend/src/controllers/chat.ts` + `backend/docs/api-examples.md`。
- WS（JSON 事件）：
  - 事件：`message_delta`、`todo_write`、`subagent_start`、`subagent_result`、`need_user_input`、`waiting`、`done` 等。
  - 逻辑：主循环推送 `message_delta`，todo 由 WS 层执行并推送子 agent 事件。

**文档与实现不一致提醒**
- `backend/docs/api-examples.md` 中 `GET /health` 响应包含 `providers` 字段，但实际实现 `backend/src/controllers/health.ts` 不返回该字段。
- `api-examples.md` 的 HTTP 响应示例包含 `provider` 和 `usage`，但实际 HTTP 同步响应只返回 `content` 和 `model`（`backend/src/controllers/chat.ts`）。

## 3. 模型供应端 Provider 配置

**关键文件**
- 配置校验：`backend/src/config/env.ts`
- 配置加载：`backend/src/config/index.ts`
- 模型工厂：`backend/src/agent/vllm-model.ts`
- 模型列表代理：`backend/src/controllers/models.ts`

**当前支持的 provider 与配置方式**
- 现状是“OpenAI 兼容 API”统一接入：
  - `createVllmModel()` 固定返回 `provider: 'openai'`、`api: 'openai-completions'`。
  - 通过 `LLM_BASE_URL` 指向不同厂商的 OpenAI 兼容端点（Zhipu/OpenAI/DeepSeek/vLLM）。
- 配置入口：
  - 环境变量（`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS`, `LLM_TEMPERATURE`, `LLM_TIMEOUT`）。
  - 请求体可覆盖：`model`, `baseUrl`, `apiKey`, `options`。

**是否需要单独扩展 vLLM provider？**
- 若 vLLM 提供 **OpenAI 兼容** `/v1` 接口：
  - **无需单独 provider**。直接设置 `LLM_BASE_URL` 指向 vLLM endpoint，或在请求中传 `baseUrl`。
  - 兼容路径：`createVllmModel()` + `Model<'openai-completions'>`。
- 需要单独扩展的情况（建议）：
  - vLLM 仅支持 ChatCompletions 或有特定字段（非 `openai-completions` 兼容）。
  - 需要使用 vLLM 特定参数/功能（如特殊采样字段、工具调用语义差异、流式 usage）。
- 扩展点建议：
  - 新建 `backend/src/agent/<provider>-model.ts`，返回不同 `api/provider/compat`。
  - 在 `chat` 与 `ws` 路由中按 `provider` 或 `baseUrl` 规则选择模型工厂。

## 4. Skill 开发与调用

**关键文件**
- skill 加载：`backend/src/core/skills/skill-loader.ts`
- skill 工具：`backend/src/agent/tools/skill.ts`
- 工具集：`backend/src/agent/tools/index.ts`
- 系统提示词：`backend/src/core/prompts/system-prompts.ts`
- 代理类型配置：`backend/src/core/agent/agent-config.ts`

**Skill 定义规范**
- 每个 skill 放在 `skills/<skill_name>/SKILL.md`。
- `SKILL.md` 需包含 YAML frontmatter：
  - `name`（必填）
  - `description`（必填）
  - `direct_return`（可选，true/false）
- 内容正文为技能说明与执行步骤。
- 可选资源目录：`scripts/`、`references/`、`assets/` 会被列到技能内容中。

**Skill 注册/加载方式**
- 启动时 `SkillLoader` 扫描 `skills/` 目录并加载 `SKILL.md`。
- `SKILLS.getDescriptions()` 生成技能列表注入系统提示词。
- `skill` 工具在运行时加载并注入技能内容：
  - `createSkillTool().execute()` 读取 `SKILLS.getSkillContent()`。
  - 返回内容被包裹为 `<skill-loaded>` 标签。

**Skill 在对话流程中的调用**
- 主/子 agent 的系统提示词要求：匹配任务时**先调用 `skill` 工具**。
- 工具集：
  - 主 agent：`bash`, `read_file`, `skill`, `todo_write` + 扩展工具（见 `backend/src/extensions/index.ts`）
  - 子 agent：`bash`, `read_file`, `skill` + 扩展工具（无 `todo_write`）
- `direct_return` 目前只在 `SkillLoader.isDirectReturn()` 中读取，未在主流程中强制执行（可作为后续扩展点）。

**Agent 默认工具来源与扩展**
- 工具注册入口：`backend/src/agent/tools/index.ts`
- 主 agent 默认工具（`createAgentTools()`）：
  - 核心：`bash`, `read_file`, `skill`, `todo_write`
  - 扩展：`createExtensionTools()` 追加扩展工具
- 子 agent 默认工具（`createSubAgentTools()`）：
  - 核心：`bash`, `read_file`, `skill`
  - 扩展：`createExtensionTools()` 追加扩展工具（与主 agent 相同）
- 扩展工具清单与加载机制：`backend/src/extensions/index.ts`
  - 当前内置扩展：`execute_sql`、`get_ai_archive_data`（加载失败会被忽略并记录日志）

## 5. 开发参考文档

**文档位置**
- `backend/docs/api-examples.md`

**内容结构概览**
- 基础信息（Base URL、Content-Type、响应格式）
- 健康检查
- HTTP Chat（同步/流式 SSE）
- WebSocket Chat（深度思考）
- 错误码参考
- 环境变量配置参考

**api-examples 未覆盖的关键约定**
- `system` 消息在 HTTP/WS 中会被折叠为 `extraSystemPrompt`，不会作为上下文消息进入模型。
- HTTP 只取最后一条 `user` 作为 prompt，其余 `user/assistant` 进入 `contextMessages`。
- WS 仅使用 `user` 作为 prompt，`contextMessages` 由会话累积。
- `todo_write` 产物会写入全局 `TODO`，当前未做会话级隔离。
- HTTP 同步响应未返回 `provider` / `usage`，与文档示例不一致（若需要请扩展响应结构）。

## 6. Session V2（工业级会话系统）

本仓库已新增 `backend/src/session-v2`，用于替代旧 `session-registry` 的轻量快照机制，核心对齐 OpenClaw 三个设计面：

### 生命周期与键模型
- 入口：`session-v2/session-service.ts` + `session-v2/session-key.ts`
- 新 WS 请求必须携带 `route`（channel/chatType/peerId/groupId/...），由服务端生成规范 `sessionKey`。
- 重置策略：`daily@04:00 + idleMinutes=120`（可通过 env 覆盖），命中策略时自动换新 `sessionId`。

### 存储模型
- 存储目录：`SESSION_STORE_DIR`（默认 `.sessions-v2`）
- 索引：`sessions.json`（`sessionKey -> SessionEntry`）
- 快照：`snapshots/<sessionId>.json`
- 转录：`transcripts/<sessionId>.jsonl`
- 约束：上下文修剪只影响发送给模型的内存上下文，不改 JSONL 历史。

### Context Pruning
- 实现：`session-v2/session-pruner.ts`
- 模式：`off | cache-ttl`（默认 `cache-ttl`）
- 仅裁剪 `toolResult`，且保护最后 N 条 assistant 之后的工具结果。
- 支持软裁剪（截头尾）与硬清除（占位符替换）。

### 会话工具
- 目录：`backend/src/agent/tools/session-tools/`
- 已接入工具：
  - `sessions_list`
  - `sessions_history`
  - `sessions_send`（`accepted/ok/timeout/error`）
  - `sessions_spawn`（异步子会话执行 + 通知）
- 工具运行时通过 `initializeSessionTools()` 绑定 `SessionService`。

### WS 协议变化
- `chatRequestSchema` 新增必填 `route`。
- 服务端新增事件：
  - `session_key_resolved`
  - `session_tool_result`
- 旧 `sessionId` 直连语义已废弃，统一由服务端按路由上下文解析会话。
