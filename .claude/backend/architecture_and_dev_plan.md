# WebClaw 后端架构重构与开发计划

> **版本**：v1.0 | **日期**：2026-03-02 | **作者**：架构师

---

## 一、Context：为什么需要这次重构

### 1.1 当前架构痛点

**双协议割裂**：Simple 模式走 HTTP POST + SSE（`controllers/chat.ts`），Thinking 模式走 WebSocket（`ws/chat-ws.ts`）。两套协议导致：
- 前端需要维护两套通信逻辑（`sendSimple` vs `sendThinking`）
- Simple 模式无会话管理、无断线恢复能力
- 工具调用事件在两种协议下的格式不统一

**模式语义不清**：`thinking` 模式命名不够准确，实际上是"规划+执行"模式，而非单纯的"思考"。

**工具集不完整**：Simple 模式缺少 `edit` 和 `write` 工具，无法完成完整的编码任务。当前工具集 `[bash, read_file, skill, todo_write]` 对于独立编码场景不够。

**主子 Agent 架构模糊**：当前 `sub-agent-runner.ts` 中的子 Agent 类型（`query`/`analyze`）是面向数据查询的，不适合通用编码任务。

### 1.2 重构目标

| 目标 | 描述 |
|------|------|
| 通信统一 | 废弃 HTTP 对话接口，所有对话通过 WebSocket |
| 模式重定义 | `simple` + `plan` 取代 `simple` + `thinking` |
| Simple 增强 | 有会话、完整工具集（read, bash, edit, write, skill） |
| Plan 规范化 | Manager（规划）+ Worker（执行）分工明确 |
| 事件协议统一 | 两种模式共用一套 WS 事件协议 |

---

## 二、WebSocket 统一接口设计

### 2.1 连接模型

所有对话共用 **一个 WS 端点**：`/api/v1/chat/ws?sessionId=xxx`

模式通过 `chat` 消息的 `mode` 字段区分，而非连接层面。同一连接可在不同请求中切换模式。

**当前限制移除**：
- 当前 `chat-ws.ts:288-291` 拒绝 simple 模式的 WS 消息 → **删除此限制**
- 当前 `controllers/chat.ts:178-180` 拒绝 thinking 模式的 HTTP 请求 → **废弃整个 HTTP 路由**

### 2.2 客户端 → 服务端 事件

| 事件 | Payload | 说明 |
|------|---------|------|
| `chat` | `{ mode: 'simple'\|'plan', messages, model?, baseUrl?, apiKey?, enableTools?, options? }` | 发起对话 |
| `cancel` | `{}` | 取消当前执行（新增） |
| `pong` | `{ timestamp }` | 心跳回复 |

**变更**：
- `mode` 枚举：`'simple' | 'thinking'` → `'simple' | 'plan'`
- 移除 `stream` 字段（WS 天然流式）
- 新增 `cancel` 事件

### 2.3 服务端 → 客户端 事件

| 事件 | Payload | Simple | Plan | 说明 |
|------|---------|--------|------|------|
| `message_delta` | `{ content }` | Y | Y | 文本流增量 |
| `message_end` | `{}` | Y | Y | 单轮消息结束 |
| `tool_start` | `{ toolName, args }` | Y | Y | 工具开始执行（从 SSE 迁移） |
| `tool_end` | `{ toolName, isError, summary }` | Y | Y | 工具执行完毕 |
| `plan_created` | `{ todos: TodoItem[] }` | - | Y | Manager 创建执行计划 |
| `worker_start` | `{ todoIndex, content, activeForm }` | - | Y | Worker 开始执行 todo |
| `worker_delta` | `{ todoIndex, content }` | - | Y | Worker 输出增量（新增） |
| `worker_end` | `{ todoIndex, result, isError }` | - | Y | Worker 执行完毕 |
| `todo_update` | `{ todos: TodoItem[] }` | - | Y | Todo 列表状态变更 |
| `need_user_input` | `{ prompt }` | - | Y | 需要用户补充信息 |
| `done` | `{}` | Y | Y | 整个请求完成 |
| `error` | `{ message, code? }` | Y | Y | 错误 |
| `ping` | `{ timestamp }` | Y | Y | 心跳 |
| `session_restored` | `{ sessionId, messageCount }` | Y | Y | 会话恢复 |

**与当前协议差异**：
- 新增 `tool_start` / `tool_end`（从 HTTP SSE 迁移）
- `todo_write` → `plan_created`（语义更清晰）
- `subagent_start/result/error` → `worker_start/delta/end`（语义统一）
- 新增 `worker_delta`（Worker 流式输出）
- `todo_update` payload 改为完整列表 `{ todos }` 而非单条 `{ todoIndex, status, summary }`

### 2.4 会话生命周期

```
连接建立 → 解析 sessionId → 恢复/创建 SessionState → 启动心跳
     ↓
chat(mode=simple) → simple-handler → agentLoop → 事件流 → done
chat(mode=plan)   → plan-handler  → Manager → Workers → done
cancel            → AbortController.abort() → 中断执行
     ↓
连接关闭 → 持久化会话 → 清理心跳
```

---

## 三、Simple 模式执行流

### 3.1 Agent Core 调用链路

```
客户端 chat(mode='simple')
  │
  ▼
chat-ws.ts 路由 → simple-handler.ts
  │
  ├─ 从 chat payload 提取消息 → normalizeMessages()
  ├─ 从 SessionState 获取 contextMessages
  ├─ 合并为 agentLoop 输入
  │
  ▼
runSimpleAgent({
  messages,
  contextMessages: state.contextMessages,
  model: createVllmModel(baseUrl, modelId),
  apiKey,
  tools: createSimpleTools(),        ← [read, bash, edit, write, skill, ...extensions]
  onEvent: (event) => {
    // AgentEvent → WS 事件映射
    message_update(text_delta) → sendEvent(ws, 'message_delta', { content })
    tool_execution_start       → sendEvent(ws, 'tool_start', { toolName, args })
    tool_execution_end         → sendEvent(ws, 'tool_end', { toolName, isError, summary })
    message_end                → sendEvent(ws, 'message_end')
  },
  signal: state.abortController.signal
})
  │
  ▼
更新 state.contextMessages
sendEvent(ws, 'done')
```

### 3.2 工具配置

```typescript
/** Simple 模式工具集 */
function createSimpleTools(): AgentTool[] {
  return [
    createReadFileTool(),     // 读取文件
    createBashTool(),         // 执行命令
    createEditFileTool(),     // 精确文本替换（新增）
    createWriteFileTool(),    // 写入/创建文件（新增）
    createSkillTool(),        // 渐进式技能加载
    ...createExtensionTools() // execute_sql, get_ai_archive_data
  ]
}
```

### 3.3 新增工具设计

**edit_file 工具**：
```typescript
{
  name: 'edit_file',
  label: '编辑文件',
  parameters: {
    file_path: string,     // 目标文件路径
    old_string: string,    // 要替换的原文本
    new_string: string,    // 替换后的新文本
  },
  execute: 读取文件 → 验证 old_string 唯一性 → 替换 → 写回文件
}
```

**write_file 工具**：
```typescript
{
  name: 'write_file',
  label: '写入文件',
  parameters: {
    file_path: string,     // 目标文件路径
    content: string,       // 文件内容
  },
  execute: 确保目录存在 → 写入文件（覆盖）
}
```

两个工具都包含 `safePath()` 路径安全校验，防止路径逃逸。

### 3.4 Simple 模式的 System Prompt

保持极简，依赖 `skill` 工具按需加载能力：

```
你是一个编程助手。你拥有以下工具来完成任务：
- read_file: 读取文件
- bash: 执行命令
- edit_file: 编辑文件
- write_file: 写入文件
- skill: 加载技能知识

当需要某领域专业知识时，先用 skill 工具加载相关技能。
直接行动，不要过多解释。
```

---

## 四、Plan 模式执行流

### 4.1 整体流程

```
客户端 chat(mode='plan')
  │
  ▼
chat-ws.ts 路由 → plan-handler.ts
  │
  ├──────────── Phase 1: Manager 规划 ────────────
  │
  │ runManagerAgent({
  │   tools: [read_file, skill, todo_write],
  │   systemPrompt: MANAGER_PROMPT
  │ })
  │   → message_delta → ws: message_delta
  │   → tool(todo_write) → ws: plan_created
  │   → message_end → ws: message_end
  │
  ├──────────── Phase 2: Worker 逐条执行 ────────────
  │
  │ for each pending todo:
  │   → ws: worker_start
  │   → runWorkerAgent({
  │       prompt: todo.content,
  │       tools: [read_file, bash, edit_file, write_file, skill, ...extensions]
  │     })
  │     → worker_delta → ws: worker_delta
  │     → tool events → ws: tool_start/tool_end
  │   → todoManager.markCompleted(idx)
  │   → ws: worker_end
  │   → ws: todo_update
  │
  │   ── 如果需要用户输入 ──
  │   → ws: need_user_input
  │   → 等待客户端 chat 事件
  │   → 恢复执行
  │
  ▼
ws: done
```

### 4.2 Manager Agent 设计

**角色**：任务规划与全局调度，**不直接写代码**。

**工具集**：`read_file`, `skill`, `todo_write`

**System Prompt 要点**：
```
你是任务规划管理器 (Manager)。你的职责是：
1. 分析用户需求，理解项目上下文
2. 使用 read_file 阅读相关代码
3. 使用 skill 加载必要的技能知识
4. 使用 todo_write 创建详细的、可执行的任务计划

规则：
- 你不直接写代码、不执行 bash 命令
- 每个 todo item 应是独立、原子化的任务
- todo 的 content 应包含：任务目标、涉及文件、具体步骤
- todo 的 activeForm 应是简短的进行时描述（如 "正在重构路由层..."）
- 计划创建后，系统会自动分配 Worker 执行
```

### 4.3 Worker Agent 设计

**角色**：接收单个 todo item，独立执行具体编码/测试任务。

**工具集**：`read_file`, `bash`, `edit_file`, `write_file`, `skill`, `...extensions`

**System Prompt**：
```
你是任务执行器 (Worker)。你的职责是完成指定的单个任务。

规则：
- 阅读相关代码后再修改
- 使用 edit_file 进行精确编辑，使用 write_file 创建新文件
- 用 bash 验证修改结果（如运行测试、检查编译）
- 需要专业知识时用 skill 加载
- 完成后返回简明的执行摘要
```

**独立上下文**：Worker 不共享 Manager 的对话历史，仅接收 todo item 内容。这确保：
- 每个 Worker 上下文窗口独立可控
- 任务之间互不干扰
- 未来可并行化执行

### 4.4 Todo 状态机

```
        todo_write
           │
           ▼
        pending ────→ in_progress ────→ completed
                         │                  │
                         │           (正常完成 / 失败)
                         │
                      need_user_input → 等待 → 恢复
```

TodoManager 增强：
- 新增 `result?: string` 字段：记录 Worker 执行结果摘要
- 新增 `errorMessage?: string` 字段：记录失败原因
- 保留现有 `MAX_ITEMS = 20` 限制

### 4.5 Manager-Worker 通信

Manager 和 Worker **不直接通信**，通过 `TodoManager` 作为中介：

1. Manager 通过 `todo_write` 写入 todo items
2. `plan-handler.ts` 读取 pending items，逐条分配给 Worker
3. Worker 执行结果写回 TodoManager（`result` 字段）
4. 所有 Worker 完成后，如果 Manager 设置了 followUp，可基于结果调整计划

---

## 五、关键文件变更清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `backend/src/agent/tools/edit-file.ts` | edit_file 工具 |
| `backend/src/agent/tools/write-file.ts` | write_file 工具 |
| `backend/src/agent/manager-runner.ts` | Manager Agent 运行器 |
| `backend/src/agent/worker-runner.ts` | Worker Agent 运行器 |
| `backend/src/agent/message-utils.ts` | 消息规范化共享函数（从 chat.ts 提取） |
| `backend/src/ws/simple-handler.ts` | WS Simple 模式处理器 |
| `backend/src/ws/plan-handler.ts` | WS Plan 模式处理器 |
| `backend/src/ws/event-sender.ts` | WS 事件发送辅助函数 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `shared/src/ws-events.ts` | 新事件类型、payload 更新 |
| `shared/src/session.ts` | Mode 类型 `'thinking'` → `'plan'` |
| `backend/src/session/session-state.ts` | Mode 类型更新、新增 `abortController` |
| `backend/src/agent/tools/index.ts` | 新增 `createSimpleTools`, `createManagerTools`, `createWorkerTools` |
| `backend/src/agent/types.ts` | 新增 Manager/Worker 常量 |
| `backend/src/core/prompts/system-prompts.ts` | 新增 Manager/Worker prompt |
| `backend/src/core/agent/agent-config.ts` | 新增 manager/worker 角色配置 |
| `backend/src/core/todo/todo-manager.ts` | TodoItem 新增 `result`, `errorMessage` |
| `backend/src/ws/chat-ws.ts` | 简化为纯路由层 |
| `backend/src/types/api.ts` | mode 枚举更新 |

### 废弃文件

| 文件 | 处理方式 |
|------|---------|
| `backend/src/controllers/chat.ts` | 返回 410 Gone 提示使用 WS |
| `backend/src/utils/stream.ts` | 删除（SSE 不再需要） |
| `backend/src/agent/sub-agent-runner.ts` | 由 `worker-runner.ts` 替代 |

### 前端变更

| 文件 | 变更内容 |
|------|---------|
| `frontend/src/hooks/useChat.ts` | `ChatMode = 'simple' \| 'plan'`，移除 HTTP 逻辑，统一 WS |
| `frontend/src/components/ui/ChatInput.tsx` | `thinking` 标签改为 `plan` |
| `frontend/src/app/home/components/SettingsDrawer.tsx` | 模式选项更新 |

---

## 六、重构 To-Do List

### Phase 0：类型定义更新（基础层）

- [ ] **0.1** 更新 `shared/src/ws-events.ts`：新增事件类型，更新 payload
- [ ] **0.2** 更新 `shared/src/session.ts`：`Mode = 'simple' | 'plan'`
- [ ] **0.3** 更新 `backend/src/session/session-state.ts`：Mode 类型、新增 `abortController`、更新 `createSessionState` 默认 mode
- [ ] **0.4** 更新 `backend/src/types/api.ts`：mode 枚举更新
- [ ] **0.5** 更新 `backend/src/core/todo/todo-manager.ts`：TodoItem 新增 `result`, `errorMessage` 字段

### Phase 1：新增工具（工具层）

- [ ] **1.1** 新建 `backend/src/agent/tools/edit-file.ts`：路径校验、唯一性检查、精确替换
- [ ] **1.2** 新建 `backend/src/agent/tools/write-file.ts`：路径校验、目录创建、文件写入
- [ ] **1.3** 更新 `backend/src/agent/tools/index.ts`：新增 `createSimpleTools()`, `createManagerTools()`, `createWorkerTools()`

### Phase 2：Agent Runner 层重构（执行层）

- [ ] **2.1** 新建 `backend/src/agent/message-utils.ts`：从 `controllers/chat.ts` 提取 `normalizeMessages()` 等共享函数
- [ ] **2.2** 重构 `backend/src/agent/agent-runner.ts`：适配 Simple 模式完整工具集，提取公共 loop 封装
- [ ] **2.3** 新建 `backend/src/agent/manager-runner.ts`：Manager Agent（read, skill, todo）
- [ ] **2.4** 新建 `backend/src/agent/worker-runner.ts`：Worker Agent（read, bash, edit, write, skill）
- [ ] **2.5** 更新 `backend/src/core/prompts/system-prompts.ts`：新增 Simple/Manager/Worker 专用 prompt
- [ ] **2.6** 更新 `backend/src/core/agent/agent-config.ts`：新增 manager/worker 角色配置

### Phase 3：WebSocket 层重构（通信层）⭐ 核心

- [ ] **3.1** 新建 `backend/src/ws/event-sender.ts`：提取 `sendEvent()` 和 AgentEvent → WS 事件映射
- [ ] **3.2** 新建 `backend/src/ws/simple-handler.ts`：Simple 模式 WS 处理器
- [ ] **3.3** 新建 `backend/src/ws/plan-handler.ts`：Plan 模式 WS 处理器（Manager → Workers 流程）
- [ ] **3.4** 重构 `backend/src/ws/chat-ws.ts`：简化为路由层，按 mode 分发到 handler
- [ ] **3.5** 实现 `cancel` 事件：AbortController 集成，中断正在执行的 Agent

### Phase 4：HTTP 层清理（清理层）

- [ ] **4.1** 简化 `backend/src/controllers/chat.ts`：返回 410 Gone + 迁移提示
- [ ] **4.2** 删除 `backend/src/utils/stream.ts`
- [ ] **4.3** 更新 `backend/src/app.ts`：移除 chat 路由注册（保留 health、models、memory）
- [ ] **4.4** 删除 `backend/src/agent/sub-agent-runner.ts`（被 worker-runner.ts 替代）

### Phase 5：前端适配

- [ ] **5.1** `useChat.ts`：`ChatMode = 'simple' | 'plan'`，移除 `sendSimple` 中的 HTTP fetch
- [ ] **5.2** `useChat.ts`：`ensureWs()` 在所有模式下创建 WS，`send()` 统一走 WS
- [ ] **5.3** `useChat.ts`：`handleWsEvent()` 适配新事件（tool_start/end, worker_start/delta/end, plan_created）
- [ ] **5.4** `ChatInput.tsx`：`thinking` → `plan` 标签
- [ ] **5.5** `SettingsDrawer.tsx`：模式选项文案更新
- [ ] **5.6** 移除 `mode === 'simple'` 时关闭 WS 的 useEffect

### Phase 6：验证与文档

- [ ] **6.1** 手动验证 Simple 模式：WS 连接 → 发送消息 → 工具调用 → 流式响应 → done
- [ ] **6.2** 手动验证 Plan 模式：WS 连接 → 发送消息 → Manager 规划 → Worker 执行 → done
- [ ] **6.3** 验证 cancel 事件：执行中发送 cancel → 中断执行
- [ ] **6.4** 验证断线恢复：WS 断开 → 重连 → session_restored
- [ ] **6.5** 更新 `backend/CLAUDE.md` 架构文档
- [ ] **6.6** 更新 `frontend/CLAUDE.md` 架构文档

---

## 七、关键设计决策

### Q: 为什么 Simple 模式也用 WS？

统一协议减少维护成本。Simple 模式引入完整工具集后，工具执行可能耗时较长，WS 天然支持双向通信和取消。且统一会话管理后，Simple 模式也能享受断线恢复能力。

### Q: Manager 和 Worker 是否共享上下文？

**不共享**。Worker 每次独立创建，仅接收 todo item 内容。原因：Worker 独立执行更安全、上下文窗口更可控、未来可并行化。

### Q: Todo 执行失败怎么处理？

Worker 失败时，todo 标记为 completed + isError，`worker_end` 事件携带错误信息。Manager 可在 followUp 循环中根据结果调整。

### Q: 渐进式迁移还是一次性切换？

建议渐进式：Phase 0-2 完成核心逻辑 → Phase 3 新增 WS handler（与旧代码并行） → Phase 5 前端切换 → Phase 4 清理旧代码。

---

## 八、验证方案

### Simple 模式端到端验证

1. 启动后端 `pnpm dev:backend`
2. 前端连接 WS，发送 `{ event: 'chat', payload: { mode: 'simple', messages: [...] } }`
3. 验证收到 `message_delta` → `tool_start` → `tool_end` → `message_end` → `done`
4. 断开 WS，重连同一 sessionId，验证 `session_restored`

### Plan 模式端到端验证

1. 发送 `{ event: 'chat', payload: { mode: 'plan', messages: [...] } }`
2. 验证 Manager 阶段：`message_delta` → `plan_created`
3. 验证 Worker 阶段：`worker_start` → `worker_delta` → `tool_start/end` → `worker_end` → `todo_update`
4. 验证 `done` 事件
5. 测试 `cancel` 事件中断执行

### 回归验证

- 心跳机制正常（ping/pong）
- 会话 GC 正常（30min TTL）
- 技能加载正常（skill 工具）
- 扩展工具正常（execute_sql, get_ai_archive_data）
- 内存系统正常（刷新周期）
