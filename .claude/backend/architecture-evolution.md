# WebClaw 架构演进建议文档

## 前置：当前架构的真实问题诊断

在进入演进方案前，先基于源码做精确的问题定位，避免误诊。

### 已确认的严重 Bug

**Bug 1: TODO 全局单例竞争**

```
// backend/src/core/todo/todo-manager.ts 第 111-112 行
export const TODO = new TodoManager()
```

这是进程级单例。当两个 WS 连接同时触发 `todo_write` 时，双方操作的是同一个 `items` 数组，会导致：任务被错误地标记为 completed、另一会话的 todo 被覆盖写入。

**Bug 2: isWaiting 恢复后重新调用 runMainAgent 而非续接 executePendingTodos**

```
// ws/chat-ws.ts 第 217-226 行
if (state.isWaiting) {
  state.resumeHint = userText || undefined
  state.isWaiting = false
}
await runDeepMode(ws, state, parsed.data) // 重新进入主循环
```

恢复后调用 `runDeepMode` 会再次运行完整的 `runMainAgent`（包括 LLM 推理），而不是直接续接 `executePendingTodos`。被标记为 `in_progress` 的 todo 永远不会被清空，形成状态泄漏。

**Bug 3: 内存计数器 `turnCounter` 也是全局单例**

```
// memory/flush.ts 第 7 行
let turnCounter = 0
```

多 WS 会话共用同一个轮次计数器，会导致记忆 flush 时机紊乱。

**Bug 4: SkillLoader 是启动时同步加载的全局单例**

Skill 内容在服务启动时一次性读取。如果运行时修改 Skill 文件，不会热更新。这不是 Bug 但是限制。

### 当前架构的正面价值（不应破坏）

- `agent-runner.ts` 已完全解耦于 Express，接受纯函数参数，可重用性极高
- `vllm-model.ts` 的工厂模式抽象干净，支持运行时切换模型
- `memory/` 模块基于文件系统持久化，无外部依赖，适合个人项目
- `SessionState` 已有正确的并发锁设计（`isRunning`）

**只读单例审查结论：**

以下单例经审查确认为只读，**无需修复**：
- `SKILLS` 单例（`skill-loader.ts:151`）— 只读，启动时加载一次，不涉及并发写入
- `config` 单例（`config/index.ts`）— 只读配置，进程启动后不变

需要修复的单例仅为：
- `TODO`（可写，存在竞争条件）→ Phase 1 修复
- `turnCounter`（可写，多会话共用）→ Phase 1 修复

---

## 1. WebSocket 全面迁移

### 1.1 HTTP Chat 是否保留

**建议：保留 HTTP Chat，但降级为辅助接口，明确职责边界。**

理由如下：

HTTP Chat 当前承担两类工作：
1. `simple` 模式：无状态单轮问答，前端自己维护历史
2. `thinking` 模式（stream=true）：主 Agent + 自动执行子 Agent，但进度不推送

`thinking` 模式通过 HTTP 是明确错误设计——子 Agent 执行过程在 `runPendingTodosWithModel` 内部是黑盒，前端无法感知进度。这个功能点应该完全迁移到 WS。

**精确诊断补充：** `controllers/chat.ts:199` 中 `autoRunTodos: mode !== 'simple'` 说明 HTTP thinking 模式下 **Agent 会自动执行全部 TODO**——这不仅是"进度不推送"的问题，而是"不可观测的自主执行"。Agent 可能执行 bash 命令、修改文件，而前端仅收到最终文本。安全风险比单纯的"进度黑盒"更高，进一步支持必须将 thinking 模式完全迁移到 WS 的结论。

`simple` 模式的 HTTP 形式是合理的：无状态、适合工具调用、适合未来扩展的 CLI 集成或脚本调用场景。强行删掉会失去灵活性。

**最终建议：**
- HTTP POST `/api/v1/chat` 仅保留 `mode: simple`，去除 `mode: thinking` 分支
- WS `/api/v1/chat/ws` 接管全部 `thinking` 模式
- HTTP 层增加请求级别的 `mode: simple` 强制校验，避免误用

**风险：** 前端目前的 `useChat.ts` 已经按 mode 分发路由（`sendSimple` 走 HTTP，`sendThinking` 走 WS），改动量小，但需要同步删除前端对 HTTP thinking 的兼容分支。

### 1.2 需要修改的核心模块清单

| 模块 | 文件 | 变更性质 |
|------|------|----------|
| WS 服务层 | `ws/chat-ws.ts` | 重构 SessionState、修复 isWaiting 恢复逻辑、引入会话级 TODO 实例 |
| HTTP 控制器 | `controllers/chat.ts` | 删除 thinking 分支，仅保留 simple |
| TODO 管理器 | `core/todo/todo-manager.ts` | 拆除全局单例，改为工厂函数 |
| 子 Agent 运行器 | `agent/sub-agent-runner.ts` | 接收注入的 TodoManager 实例而非直接引用全局 TODO |
| 前端 Hook | `frontend/src/hooks/useChat.ts` | 删除 sendSimple 中的 thinking 模式调用，统一 WS |
| 记忆计数器 | `memory/flush.ts` | 将 `turnCounter` 移入会话级作用域 |

### 1.3 连接生命周期管理方案

**心跳机制**

WS 标准没有内置心跳，需要在应用层实现。建议在 `chat-ws.ts` 中为每个连接启动一个 ping/pong 定时器：

```
每隔 30 秒，服务端向客户端发送 { event: 'ping' }
客户端收到后回复 { event: 'pong' }
服务端在 60 秒内未收到 pong 则主动关闭连接
```

前端 `useChat.ts` 中增加对 `ping` 事件的透明响应，不影响 UI。

**断线重连策略**

当前前端在 `ws.onclose` 时直接将 `wsRef.current = null`，下次发消息时调用 `ensureWebSocket` 会重建连接。这是"懒重连"策略，对个人用户场景足够。

为避免发消息时连接恰好断开，建议增加"预检重连"：每次 `sendThinking` 调用前先 ping 连接状态，若已断开则等待重建完成再发送。当前 `pendingSendRef` 机制已有这个雏形，可以扩展。

### 1.4 前端配置硬编码问题

`useChat.ts:28-29` 硬编码了 `localhost:5000` 作为后端地址，而后端默认端口为 `3000`，存在不匹配风险。此外 `SettingsDrawer.tsx:48` 也硬编码了 `localhost:5000`。

**建议：**
- 前端通过 Vite 环境变量配置 API 地址：`import.meta.env.VITE_API_BASE`
- 在 `frontend/.env` 和 `.env.example` 中添加：
  ```
  VITE_API_BASE=http://localhost:3000
  VITE_WS_BASE=ws://localhost:3000
  ```
- 影响文件：`useChat.ts`、`SettingsDrawer.tsx`

这是一个低成本但高收益的改动，可避免开发/部署时的端口不匹配问题。

**会话保持（断线后恢复状态）**

当前 `SessionState` 在 WS 断线时直接清空（`ws.on('close')` 置空 `contextMessages`）。对于常驻型助手，这意味着断线就丢失全部上下文，体验很差。

解决方案分两层：

**短期断线（< 30 秒）**：在服务端引入会话缓存 Map，key 为客户端生成并在握手时传入的 `sessionId`：

```typescript
// 握手时前端传入 sessionId（存储在 localStorage）
const sessions = new Map<string, SessionState>()

wss.on('connection', (ws, req) => {
  const sessionId = parseSessionId(req.url) ?? generateId()
  const state = sessions.get(sessionId) ?? createFreshSession()
  sessions.set(sessionId, state)

  ws.on('close', () => {
    // 不立即清空，保留 5 分钟后 GC
    scheduleSessionGC(sessionId, 5 * 60 * 1000)
  })
})
```

**长期离线（跨进程重启）**：`contextMessages` 定期序列化到文件（可复用现有 `.memory` 目录），重启时从文件恢复。这个需求与记忆系统高度重合，不需要额外基础设施。

---

## 2. Gateway 层设计

### 2.1 Gateway 职责划分

Gateway 层不是指 API 网关产品，而是在现有 Express 中间件链中插入一个职责明确的协调层。它的边界是：

- **入口侧（Inbound）**：连接验证、认证检查、消息路由、速率限制
- **出口侧（Outbound）**：事件格式化、错误归一化
- **生命周期**：会话创建/恢复、连接注册、会话 GC

具体职责：

```
[ 客户端连接 ]
      |
  [Gateway 层]
  ├── 1. 解析 sessionId（URL 参数）
  ├── 2. 认证检查（本地 token 比对）
  ├── 3. 会话恢复 or 创建（从 SessionRegistry 取 SessionState）
  ├── 4. 消息验证（zod schema 检查）
  ├── 5. 并发控制（isRunning 锁检查）
  └── 6. 分发到 Agent 执行层（runDeepMode / sendSimple）
      |
  [Agent 执行层]（现有 agent-runner.ts）
```

### 2.2 技术选型：独立服务 vs 中间件

**建议：中间件模式，不拆分独立服务。**

理由：

WebClaw 是面向个人用户的单机运行项目，引入独立 Gateway 进程（如 Envoy、Kong、自定义 Go 服务）会带来：
- 部署复杂度从 1 个进程变成 2-3 个
- 进程间通信引入延迟和序列化成本
- 个人项目难以承受运维负担

中间件模式的实现是在现有 Express 应用中增加一个 `gatewayMiddleware`，对 WS 连接在 `upgrade` 事件处理前介入检查。

这是正确的项目规模判断。如果未来用户规模扩展、或者需要多实例部署，再考虑拆分独立 Gateway。

**中间件层结构建议：**

```
backend/src/gateway/
├── session-registry.ts   # 会话注册表（内存 Map + 文件持久化）
├── auth.ts               # 本地 token 鉴权
├── rate-limiter.ts       # 基于滑动窗口的请求限流
└── index.ts              # 统一导出，接入 server.ts
```

### 2.3 与现有双循环逻辑的整合

当前双循环的问题是 `runMainAgent` 和 `executePendingTodos` 是两个独立调用，中间状态（`hasPendingTodos`, `isWaiting`）散落在 `runDeepMode` 函数内。Gateway 层整合后，建议将状态流明确化：

```
Gateway 接收消息
  → 创建/恢复 AgentSession
  → AgentSession.run(message)
      → 内部: runMainAgent()
      → 内部: 若有 pending，executePendingTodos()
      → 内部: 若需等待，挂起并发送 need_user_input 事件
  → 所有事件通过统一的 emit(sessionId, event) 推送到对应 WS 连接
```

关键改进：把 `ws: WebSocket` 直接传入执行函数的方式改为事件总线模式，执行层不直接持有 WS 引用，而是发出事件，Gateway 层负责投递。这样可以支持未来 WS 重连后将事件投递到新连接。

### 2.4 常驻型助手的会话状态存储层

**三层存储架构：**

```
[L1] 进程内 Map（热数据）
     key: sessionId
     value: SessionState（含 contextMessages）
     TTL: 30 分钟无活动后 GC

[L2] 文件系统（温数据，跨进程重启恢复）
     .sessions/{sessionId}.json
     写入时机：每次 Agent 完成一个 turn 后异步写入
     内容：精简的 contextMessages（剔除 toolResult 等大对象）

[L3] .memory 目录（冷数据，长期记忆）
     现有记忆系统，无需改动
```

这三层对个人用户已经足够。不需要引入 Redis 或 SQLite，保持零外部依赖。

**潜在风险：**
- 文件序列化/反序列化可能丢失 `AgentMessage` 中的复杂类型信息（`pi-agent-core` 的 `AssistantMessage` 包含 usage、cost 等字段），需要测试反序列化后是否能正确传入 `agentLoop`
- 如果 `contextMessages` 过长（超过 40 条），序列化文件会很大，需要在写入前截断

---

## 3. Agent 沙箱隔离

### 3.1 隔离方案选型

当前 bash 工具使用 `execSync`，直接在主进程环境中运行 shell 命令，无任何沙箱。这意味着 Agent 可以访问整个文件系统、网络、进程表。

**方案对比：**

| 方案 | 隔离强度 | 实现复杂度 | 适合个人项目 |
|------|----------|----------|------------|
| child_process.fork | 低（同用户权限） | 低 | 是 |
| Worker Threads | 中（共享内存但隔离执行） | 中 | 是 |
| Docker 容器 | 高（完整 OS 隔离） | 高 | 部分是 |
| Node.js VM 模块 | 中（JS 沙箱，非 bash） | 低 | 不适用（工具是 bash） |
| firejail / seccomp | 高（系统调用过滤） | 中 | 是（Linux 限定） |

**建议：面向个人项目，采用 child_process.spawn + 路径白名单 + 超时限制的轻量沙箱，不使用 Docker。**

理由：
- Docker 需要额外安装和运行 Docker daemon，增加用户部署复杂度
- 个人用户的威胁模型：主要防止 LLM 幻觉导致的误操作（如 `rm -rf`），而非恶意攻击者
- 项目运行在本机，用户本身对文件系统有完全权限，过度隔离反而影响 Agent 的有效功能

**轻量沙箱具体设计：**

```typescript
// 在 bash.ts 工具中增加以下限制

// 1. 命令前缀黑名单（阻止最危险的操作）
const FORBIDDEN_PATTERNS = [
  /rm\s+-rf\s+\//, // rm -rf / 或 /xxx
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/, // 写磁盘设备
  /curl.*\|\s*(bash|sh)/, // curl | bash
]

// 2. 工作目录限制（所有命令 cwd 固定为项目根目录）
cwd: PROJECT_ROOT  // 已实现，保持

// 3. 超时限制（已有 120s，合理）

// 4. 环境变量清理（避免泄露 LLM_API_KEY 到子进程）
env: {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  // 不传入 LLM_API_KEY 等敏感变量
}
```

**潜在风险：**
- 黑名单是不完整的安全手段，LLM 可能生成绕过黑名单的等效命令（如用 Python 执行文件删除）
- 如果项目未来允许多用户，必须升级到 Docker 级别隔离

### 3.2 沙箱与主服务通信协议

对于轻量沙箱方案，bash 工具本身就是通信协议：stdin 传入命令，stdout/stderr 传出结果，exit code 表示状态。不需要额外设计。

若未来需要升级到进程隔离的 SubAgent 沙箱，建议使用内部 HTTP（Unix Domain Socket）而非 IPC 消息：

```
主进程 (agentLoop)
  → HTTP POST unix:///tmp/webclaw-sandbox.sock/execute
  → 请求体: { command: string, cwd: string, timeout: number }
  → 响应体: { stdout: string, stderr: string, exitCode: number }
沙箱进程
  → 监听 Unix Socket
  → 执行命令并返回结果
```

Unix Domain Socket 比 TCP 快，且不开放网络端口，安全性更好。

### 3.3 Skill 调用适配

当前 Skill 工具只读取文件内容注入到上下文，不执行外部代码，安全风险低。

如果 Skill 未来需要执行 `scripts/` 目录中的脚本（当前 `getSkillTools` 返回空数组，此功能被注释掉了），则需要：

1. 脚本执行走 bash 工具的沙箱通道，不绕过限制
2. Skill 脚本的工作目录固定为 Skill 自身目录（`skill.dir`），不能跨目录访问

Skill 系统目前不需要为沙箱做特殊适配。

### 3.4 安全边界划定

针对常驻型个人助手的威胁模型，安全边界如下：

**允许：**
- 读写 `PROJECT_ROOT` 目录下的文件
- 执行网络请求（curl/fetch），因为 Skill 需要调用外部 API
- 读取数据库（只读 SQL 查询）

**禁止：**
- 写入 PROJECT_ROOT 之外的路径（通过 cwd 固定和路径检查）
- 执行特权命令（通过黑名单过滤）
- 在子进程中访问 LLM API Key（清理环境变量）
- 进程替换（`exec` 系列命令需要特别审查）

**API Key 安全特别说明：**

当前前端可以通过请求体传入 `apiKey` 字段，且后端不做任何校验。这在个人项目中可以接受（用户自己传自己的 key），但需要确保：
1. CORS 已配置（现在是全域开放，需要至少在生产环境收紧为 `localhost` only）
2. API Key 不进入日志（当前 `logger.debug` 记录了完整 requestContext 包含 apiKey，需要脱敏）

### 3.5 前端 API Key 安全

`HomePageLayout.tsx` 将 `apiKey` 以明文 JSON 存入 `localStorage`（key: `webclaw.modelConfig`），`ModelPresetItem` 中每个预设也包含明文 apiKey。

**风险评估：**
- 个人项目中 `localStorage` 安全性可接受（同源策略保护）
- 但 XSS 漏洞可一次性泄露所有存储的 API Key
- 当前项目无用户输入渲染为 HTML 的场景，XSS 风险较低

**建议（低优先级）：**
- **短期：** 无需改动——个人项目威胁模型下可接受
- **长期：** 考虑使用 `sessionStorage` 替代（关闭标签页即清除），或引入简单的混淆存储（如 base64 编码 + 前缀标识，非加密但防止明文扫描）

---

## 4. OpenClaw 设计借鉴

> 本节参考开源项目和行业趋势，评估对 WebClaw 架构演进的借鉴价值。

### 4.1 OpenClaw 简介

OpenClaw 是一个开源个人 AI 助手框架，支持本地模型和云 API，拥有 100+ AgentSkill。其架构理念与 WebClaw 有高度相似性（面向个人用户、Skill 驱动、多模型支持）。

### 4.2 值得借鉴的模式

**1. 模块化 Skill 注册表**

WebClaw 已有类似设计（`SkillLoader`），但 OpenClaw 的 Skill 支持**运行时注册/注销**——Agent 运行过程中可以动态加载新 Skill 而无需重启服务。WebClaw 可参考此模式实现 Skill 热更新（Phase 5 已规划）。

**2. 安全执行上下文（确认式执行）**

OpenClaw 因 Agent 误删 200 封邮件的事件后引入了**操作确认机制**——高危操作（文件删除、邮件发送、数据库写入等）执行前需用户审批。WebClaw 当前的 bash 黑名单是被动防御，可升级为"确认式执行"：

```
Agent 生成 bash 命令
  → 命令匹配高危模式？
    → 是：推送 need_user_confirm 事件到前端，等待用户确认
    → 否：直接执行
```

这比纯黑名单更安全，且用户体验更好（不是拒绝执行，而是请求确认）。

**3. 模型提供商抽象层**

OpenClaw 抽象了模型提供商接口，支持 OpenAI、Anthropic、本地 Ollama 等无缝切换。WebClaw 的 `vllm-model.ts` 工厂模式已实现此点，**确认方向正确**，无需额外改动。

### 4.3 行业趋势参考

- **MCP（Model Context Protocol）** — 正在成为 Agent 连接工具/数据的标准协议。Anthropic 主导，已有大量 MCP Server 实现，允许 Agent 通过统一协议调用外部工具（文件系统、数据库、API 等）
- **A2A（Agent2Agent Protocol）** — Google 主导的 Agent 间通信标准，定义了 Agent 发现、任务委派、状态同步的协议。适合多 Agent 协作场景
- **LangGraph 的状态图模式** — 将 Agent 工作流建模为有向图，节点是操作、边是状态转换。适合复杂多步工作流，但引入较重的框架依赖

### 4.4 对 WebClaw 的建议

当前架构已覆盖核心需求，**不建议引入重型框架**（如 LangGraph、AutoGen）。理由：
- 个人项目的灵活性优先于标准化
- 当前 `agent-runner.ts` + `sub-agent-runner.ts` 的双循环模式足以覆盖主 Agent + 子 Agent 场景
- 引入框架会增加学习成本和调试难度

**可关注的方向：**
- MCP 协议兼容性作为后续扩展方向——当 MCP 生态成熟后，WebClaw 可以通过 MCP 协议接入外部工具，替代当前 bash 直接调用的方式
- 确认式执行机制可在 Phase 4（bash 安全加固）中一并实现

---

## 5. 演进路线图

### Phase 1：修复核心 Bug（立即，高优先级）

**目标：消除当前 100% 确定会触发的 Bug，不引入新架构。**

**前置依赖：** 无

**任务清单：**

1. **[P0] 修复 TODO 全局单例**
   - 将 `TodoManager` 改为工厂函数 `createTodoManager()`
   - 在 `ws/chat-ws.ts` 的每个 `SessionState` 中持有独立的 `TodoManager` 实例
   - `runMainAgent` 和 `runSubAgent` 接收 `todoManager` 作为参数（依赖注入）
   - 影响文件：`core/todo/todo-manager.ts`, `agent/tools/todo-write.ts`, `agent/sub-agent-runner.ts`, `agent/agent-runner.ts`, `ws/chat-ws.ts`

2. **[P0] 修复 isWaiting 恢复逻辑**
   - 检测到 `isWaiting` 恢复时，直接调用 `executePendingTodos` 而非重新调用 `runDeepMode`
   - 影响文件：`ws/chat-ws.ts`

3. **[P1] 修复 turnCounter 全局状态**
   - 将 `turnCounter` 从模块级变量改为 `SessionState` 的字段，或传入 `recordMemoryTurnAndMaybeFlush`
   - 影响文件：`memory/flush.ts`

4. **[P1] 脱敏 API Key 日志**
   - `controllers/chat.ts` 的 `requestContext` 中，将 `apiKey` 替换为 `apiKey: reqApiKey ? '[set]' : '[not set]'`
   - 影响文件：`controllers/chat.ts`

5. **[P2] HTTP Chat 去除 thinking 模式**
   - 在 HTTP 路由中强制 `mode: simple`，返回 400 错误引导用户使用 WS
   - 影响文件：`controllers/chat.ts`

**预期工时：** 1-2 天，主要是依赖注入改造。

---

### Phase 2：会话持久化 + 连接生命周期（中期，高优先级）

**目标：实现断线重连后会话恢复，支持常驻型使用模式。**

**前置依赖：** Phase 1 完成（需要干净的 SessionState 结构）

**任务清单：**

1. **新建 `SessionRegistry`**
   - `backend/src/gateway/session-registry.ts`
   - 内存 Map 存储活跃会话
   - 文件序列化到 `.sessions/{sessionId}.json`（仅存 contextMessages 精简版）
   - 实现 GC 定时器（30 分钟无活动销毁）

2. **WS 握手时传递 sessionId**
   - 前端：`localStorage` 生成并存储 `sessionId`，在 WS URL 中携带 `?sessionId=xxx`
   - 后端：在 `upgrade` 事件中解析 sessionId，从 SessionRegistry 恢复状态
   - 影响文件：`ws/chat-ws.ts`, `frontend/src/hooks/useChat.ts`

3. **心跳机制**
   - 服务端每 30 秒发送 `{ event: 'ping' }`
   - 前端透明回复 `{ event: 'pong' }`
   - 60 秒无 pong 则关闭连接

4. **前端断线自动重连**
   - `useChat.ts` 增加指数退避重连逻辑（500ms -> 1s -> 2s -> 4s，最多 5 次）
   - 重连成功后携带相同 `sessionId`，触发服务端状态恢复
   - **消息队列设计：** 当前 `pendingSendRef` 只缓存一条消息（`useRef<string | null>`），改为消息队列（`useRef<string[]>`），断线期间积累的消息在重连后按序发送。队列上限设为 10 条，超出时丢弃最旧的消息并提示用户

5. **前后端共享 WS 事件类型**
   - 在 monorepo 根目录新建 `shared/ws-events.ts`（或 `packages/shared/`）
   - 定义所有 WS 事件类型枚举和 payload 接口
   - 当前后端发送 10 种事件，前端只处理 6 种，存在协议漂移
   - 事件清单：`message_delta`, `message_end`, `todo_write`, `subagent_start`, `subagent_result`, `need_user_input`, `waiting`, `todo_update`, `subagent_error`, `error`, `done`, `ping`, `pong`
   - 后端 `sendEvent()` 和前端 `ws.onmessage` 均引用此共享定义
   - 影响文件：新建 `shared/ws-events.ts`，修改 `ws/chat-ws.ts`、`useChat.ts`

**预期工时：** 3-4 天。

**潜在风险：**
- `AgentMessage` 类型中的 `AssistantMessage` 包含 `cost`、`usage` 等 `pi-ai` 内部字段，序列化后反序列化可能无法恢复为正确的类型实例。需要先写序列化测试用例验证。

---

### Phase 3：Gateway 层内聚 + 鉴权 + 限流（中期，中优先级）

**目标：将分散在 WS 处理函数中的横切关注点提取到独立 Gateway 层，加入基本安全防护。**

**前置依赖：** Phase 2 完成（SessionRegistry 是 Gateway 的核心依赖）

**任务清单：**

1. **新建 `backend/src/gateway/` 目录**

2. **本地 Token 鉴权**
   - 在 `.env` 中增加 `ACCESS_TOKEN` 配置项（用户自己设置密码）
   - WS 握手时验证 URL 参数中的 token
   - HTTP 请求验证 `Authorization: Bearer <token>` header
   - 影响文件：`config/env.ts`, `gateway/auth.ts`, `ws/chat-ws.ts`, `app.ts`

3. **请求级限流**
   - 基于滑动窗口（内存计数器）：单连接每分钟不超过 20 条消息
   - 无需 Redis，纯内存实现
   - 影响文件：`gateway/rate-limiter.ts`

4. **CORS 收紧**
   - `app.ts` 中将 CORS 从 `*` 收紧为 `localhost` + 可配置白名单
   - 影响文件：`app.ts`, `config/env.ts`

5. **事件总线解耦**
   - 将 `sendEvent(ws, ...)` 替换为 `session.emit(event)`
   - 由 Gateway 层负责将 session event 路由到当前绑定的 WS 连接
   - 这是为 Phase 2 断线重连时事件重放做铺垫

**预期工时：** 2-3 天。

---

### Phase 4：bash 工具安全加固（后期，中优先级）

**目标：防止 LLM 幻觉触发危险 shell 命令，对个人助手场景实现最小化安全保证。**

**前置依赖：** Phase 1（沙箱加固应在稳定的基础上进行）

**任务清单：**

1. **命令黑名单过滤**
   - 在 `bash.ts` 的 `execute` 函数中，命令执行前进行正则匹配检查
   - 黑名单规则：`rm -rf /`、`mkfs`、`dd if=`、`curl | bash/sh`

2. **环境变量清理**
   - `execSync` 的 `env` 选项中显式传入精简环境，不传 `LLM_API_KEY` 等敏感变量

3. **输出长度限制加强**
   - 当前已有 `TOOL_OUTPUT_LIMIT = 50_000`，合理，保持

4. **命令审计日志**
   - 每次 bash 工具调用记录到独立日志（命令内容、执行用户、时间戳），便于事后审查

**预期工时：** 0.5-1 天。

**风险提示：**
- 黑名单是不完整防护，不要对此产生过度信任。如果未来需要强安全，必须引入容器级隔离。

---

### Phase 5：HTTP 接口清理 + Skill 热更新（后期，低优先级）

**目标：收敛接口设计，提升开发体验。**

**前置依赖：** Phase 3 完成

**任务清单：**

1. **HTTP thinking 模式的正式删除**（Phase 1 已标注，此处做收尾）
   - 更新 API 文档，明确 `/api/v1/chat` 只支持 `simple` 模式

2. **Skill 热更新**
   - 在 `SkillLoader` 中增加文件监听（`fs.watch`），目录变动时重新扫描加载
   - 适合开发时频繁修改 Skill 的场景

~~3. **统一 WS 事件协议文档**~~ — 已提前至 Phase 2 第 5 项（前后端共享 WS 事件类型）

---

### 路线图总览

```
优先级   | 阶段         | 关键收益
---------|-------------|----------------------------------
立即     | Phase 1     | 修复并发 Bug（TODO 竞争、isWaiting 卡死）
高       | Phase 2     | 断线重连 + 会话持久化（常驻型体验核心）
中       | Phase 3     | Gateway 层 + 鉴权 + 限流（安全基线）
中       | Phase 4     | bash 工具安全加固（降低意外风险）
低       | Phase 5     | 接口清理 + Skill 热更新（开发体验）
```

每个阶段都可以独立交付和测试，不存在强耦合的跳跃性依赖。Phase 1 是其他所有阶段的必要前提，因为后续的会话级隔离依赖干净的 TodoManager 注入结构。

---

## 补充：关于架构复杂度的提醒

这份文档描述的是完整的演进蓝图。对于个人项目，有一个重要的权衡原则：

**不要为了"架构正确性"而过度工程化。**

Phase 1 是必做的（Bug 级问题）。Phase 2 是建议的（显著改善体验）。Phase 3-5 可以按需选择，而不是全部实施。

具体到代码量，Phase 1 约涉及 7 个文件的修改、新增约 50 行、删除约 20 行，是性价比最高的一次改动。

---

## 关键文件索引

| 文件路径 | 改造重点 |
|---------|---------|
| `backend/src/core/todo/todo-manager.ts` | 拆除全局单例改为工厂函数，Phase 1 核心 |
| `backend/src/ws/chat-ws.ts` | SessionState 管理、isWaiting 修复、心跳、sessionId |
| `backend/src/agent/agent-runner.ts` | 接收注入的 TodoManager，修复内存计数器 |
| `frontend/src/hooks/useChat.ts` | sessionId 管理、WS 重连、心跳响应 |
| `backend/src/agent/sub-agent-runner.ts` | TodoManager 依赖注入 |
