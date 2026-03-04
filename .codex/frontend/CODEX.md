# WebClaw 前端开发文档（给 Codex）

面向快速扩展与定位，重点是"怎么接入/扩展"。每个模块都给出关键文件路径。

## 1. 技术栈与项目结构

**技术栈**
- React 19 + TypeScript（Strict 模式）
- Vite + Tailwind CSS 4（CSS-first 配置，无 tailwind.config）
- 无路由库、无外部状态管理库
- 图标：lucide-react
- 工具：clsx + tailwind-merge
- 共享类型：`@webclaw/shared`（workspace 引用）

**关键文件路径一览**

```
frontend/
├── index.html                              # SPA 入口，挂载 <div id="root">
├── package.json                            # @webclaw/frontend
├── vite.config.ts                          # Vite + React + Tailwind CSS 4
├── tsconfig.app.json                       # ES2022, bundler moduleResolution, strict
└── src/
    ├── main.tsx                            # createRoot + StrictMode
    ├── App.tsx                             # 根组件 → <HomePage />
    ├── index.css                           # Tailwind 4 @import + @theme 语义 Token
    ├── app/home/
    │   ├── page.tsx                        # HomePage（薄包装）
    │   └── components/
    │       ├── HomePageLayout.tsx           # 主状态容器 + 布局
    │       ├── ConversationArea.tsx         # 聊天列
    │       └── SettingsDrawer.tsx           # 右侧设置面板（1070 行，待拆分）
    ├── components/
    │   ├── chat/
    │   │   ├── MessageList.tsx             # 消息滚动列表
    │   │   └── MessageItem.tsx             # 单条消息渲染（含内联 Markdown）
    │   └── ui/
    │       ├── ChatInput.tsx               # 输入编排（textarea + toolbar + tags）
    │       ├── AutoResizeTextarea.tsx       # 自动高度 textarea
    │       ├── CategoryTags.tsx            # 5 个快捷话题按钮
    │       └── InputToolbar.tsx            # Plus + Send 按钮（当前未使用）
    ├── hooks/
    │   ├── useChat.ts                      # 核心：WebSocket + 消息状态
    │   └── useAutoResize.ts                # textarea 自动高度
    ├── lib/
    │   ├── session.ts                      # SessionId 生成 + localStorage 持久化
    │   └── ws-reconnect.ts                 # ReconnectableWs 重连类
    └── config/
        └── api.ts                          # API_BASE / WS_BASE / API_V1 常量
```

## 2. 入口与组件树

```
index.html <div id="root">
  └── main.tsx → createRoot().render(<StrictMode><App /></StrictMode>)
       └── App.tsx → <HomePage />                        [无路由，单页面]
            └── page.tsx → <HomePageLayout />
                 ├── <ConversationArea ...props />       [左侧/主区域]
                 │    ├── <header> 主题切换 + 设置按钮
                 │    ├── 空状态：欢迎文本 + <ChatInput showSuggestions />
                 │    └── 活跃状态：<MessageList /> + 底部 <ChatInput />
                 │         ├── <MessageItem /> × N
                 │         └── <ChatInput>
                 │              ├── Plus 按钮（附件占位，TODO）
                 │              ├── <AutoResizeTextarea>
                 │              ├── <CategoryTags>（仅 showSuggestions 时）
                 │              └── plan 模式徽章
                 └── <SettingsDrawer ...props />          [从右侧滑入]
```

**无路由**：应用仅有一个页面，导航完全由组件状态驱动（`isSettingsOpen`、面板开关标志）。

## 3. 样式系统（Tailwind CSS 4 + 语义 Token）

**定位文件**
- 主题定义与暗色模式：`frontend/src/index.css`
- 无独立 Tailwind 配置文件（CSS-first 模式：`@import "tailwindcss"` + `@theme {}`）

**@theme 语义变量**

| CSS 变量 | 亮色值 | 用途 |
|---|---|---|
| `--color-surface` | `hsl(0 0% 100%)` | 页面、卡片、抽屉背景 |
| `--color-surface-alt` | `hsl(48 33.3% 97.1%)` | 对话区域背景 |
| `--color-text-primary` | `#0f172a` | 标题、正文 |
| `--color-text-secondary` | `#64748b` | 副标题、描述 |
| `--color-text-muted` | `#94a3b8` | 占位符、禁用态 |
| `--color-border` | `#e2e8f0` | 分割线、边框 |
| `--color-hover` | `#f1f5f9` | 悬浮背景 |
| `--color-accent` | `#3b82f6` | 按钮、链接 |
| `--color-accent-soft` | `#eff6ff` | 标签悬浮背景 |
| `--color-accent-text` | `#2563eb` | 强调文本 |
| `--shadow-input` | `0 2px 8px rgba(0,0,0,0.06)` | 输入框默认阴影 |
| `--shadow-input-hover` | `0 4px 16px rgba(0,0,0,0.1)` | 输入框悬浮/聚焦阴影 |

**暗色模式实现**
- `HomePageLayout` 通过 `useEffect([isDark])` 在 `document.documentElement` 上切换 `.dark` 类。
- `index.css` 中 `.dark` 选择器覆盖所有 `--color-*` 和 `--shadow-*` 变量。
- 触发入口：`ConversationArea` 头部的 Sun/Moon 按钮。

**自定义工具类**
- `.chat-scrollbar`：8px 窄滚动条，使用 `color-mix(oklab)` 做低对比度滑块。

**className 写法规范**
- 使用 `clsx()` + `tailwind-merge` 合并类名。
- 语义 Token 优先：`bg-surface`、`text-text-primary`、`border-border`。
- 禁止直接硬编码颜色值，统一通过 `@theme` 变量。
- 图标按钮（复制/重发/删除/导航等）默认使用透明背景，或与主页面同底色（优先 `bg-transparent`、`bg-surface-alt`）；避免高饱和底色块。

## 4. 状态管理与数据流

**无外部状态库**。所有状态通过 React `useState` / `useRef` + prop drilling 传递。

**HomePageLayout — 主状态持有者**

| 状态 | 类型 | 默认值 | 持久化 |
|---|---|---|---|
| `isSettingsOpen` | `boolean` | `false` | 否 |
| `isDark` | `boolean` | `false` | 否 |
| `systemPrompts` | `SystemPromptItem[]` | localStorage 加载 | `webclaw.systemPrompts` |
| `activePromptId` | `string \| null` | localStorage 加载 | `webclaw.activePromptId` |
| `modelConfig` | `ModelConfig` | localStorage 加载 | `webclaw.modelConfig` |

**useChat — 消息状态**

| 状态 | 类型 |
|---|---|
| `mode` | `'simple' \| 'plan'` |
| `messages` | `ChatMessage[]` |
| `isStreaming` | `boolean` |
| `isWaiting` | `boolean` |
| `connectionStatus` | `ConnectionStatus` |

**localStorage 键清单**

| 键 | 归属 | 内容 |
|---|---|---|
| `webclaw.sessionId` | `lib/session.ts` | WS 会话标识符 |
| `webclaw.systemPrompts` | `HomePageLayout` | `SystemPromptItem[]` JSON |
| `webclaw.activePromptId` | `HomePageLayout` | 当前激活的系统提示词 ID |
| `webclaw.modelConfig` | `HomePageLayout` | `ModelConfig` JSON |
| `webclaw.modelPresets` | `SettingsDrawer` | `ModelPresetItem[]` JSON |
| `webclaw.activeModelPresetId` | `SettingsDrawer` | 当前激活的模型预设 ID |

**数据流模式**
- 消息列表采用不可变模式更新（展开为新数组），streaming 时通过 `id` 匹配替换为新对象。
- 设置变更通过 props 回调从 `SettingsDrawer` → `HomePageLayout` → `ConversationArea` → `useChat`。

## 5. WebSocket 通信（useChat 核心）

**定位文件**
- WebSocket Hook：`frontend/src/hooks/useChat.ts`
- 重连封装：`frontend/src/lib/ws-reconnect.ts`
- 会话管理：`frontend/src/lib/session.ts`
- API 常量：`frontend/src/config/api.ts`

**连接生命周期**
1. 首次调用 `send()` 时通过 `ensureWs()` 惰性初始化 `ReconnectableWs`。
2. WS URL：`${WS_BASE}/api/v1/chat/ws?sessionId={sessionId}`
3. 组件卸载时清理 WS 连接。

**ReconnectableWs 重连机制**
- 指数退避：`delay = 500ms × 2^retryCount`
- 最大重试次数：5（之后状态变为 `'disconnected'`）
- 消息队列：断连期间最多缓冲 10 条消息
- 心跳：自动回复 `ping` 事件为 `{ event: 'pong', payload: { timestamp } }`
- 状态：`'connecting' | 'connected' | 'reconnecting' | 'disconnected'`

**Client → Server 发送结构**

```json
{
  "event": "chat",
  "payload": {
    "mode": "simple | plan",
    "model": "模型名",
    "baseUrl": "API 端点",
    "apiKey": "密钥",
    "enableTools": false,
    "options": { "temperature": 0.7, "maxTokens": 8192 },
    "messages": [
      { "role": "system", "content": "..." },
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ]
  }
}
```

**Server → Client 事件处理映射表**

| 事件 | 处理方式 |
|---|---|
| `message_delta` | 追加 `payload.content` 到当前 assistant 消息 |
| `worker_delta` | 追加 `payload.content` 到当前 worker 消息 |
| `message_end` | 设置 `isStreaming = false` |
| `worker_start` | 创建 `'event'` 角色消息：`Worker #N: content` |
| `worker_end` | 清除 `lastWorkerIdRef` |
| `need_user_input` | 设置 `isWaiting = true`，追加 `'event'` 消息显示提示 |
| `done` | 设置 `isStreaming = false`，`isWaiting = false` |
| `session_restored` | 追加 `'system'` 消息："会话已恢复 (N 条上下文)" |
| `error` | 追加 `'system'` 消息显示错误，重置 streaming/waiting |
| `ping` | 由 `ReconnectableWs` 自动处理（回 pong），不转发给 Hook |
| 其他（`todo_write`、`subagent_start`、`tool_start`、`tool_end` 等） | 追加为 `'event'` 角色消息，显示 `eventType` 标签 |

## 6. 聊天模式（simple / plan）

**模式切换**
- 键盘快捷键：`Ctrl+P`（在 `AutoResizeTextarea` 中监听）
- 状态：`useChat` 的 `mode: 'simple' | 'plan'`
- UI 指示：`ChatInput` 中当 mode 为 `'plan'` 时显示蓝色徽章

**后端行为差异**
- `simple`：单次问答，不触发 todo 自动执行。
- `plan`：支持双循环（主循环规划 + 子循环执行），WS 推送 todo/worker 事件。

## 7. 设置系统（SettingsDrawer）

**定位文件**
- 主文件：`frontend/src/app/home/components/SettingsDrawer.tsx`（1070 行，超出 800 行建议上限）

**面板架构**
- 抽屉宽 320px，通过 `margin-right: -320px`（关闭）/ `0`（打开）滑动，`transition-transform duration-300` 动画。
- 三个子面板以 `absolute inset-0` 覆盖层渲染在抽屉内部：

| 子面板 | 状态标志 | 功能 |
|---|---|---|
| 系统指令面板 | `isSystemPanelOpen` | 管理多条系统提示词（CRUD + 激活） |
| 模型选择面板 | `isModelPanelOpen` | 管理模型预设（名称/模型/baseUrl/apiKey），获取远程模型列表 |
| 记忆设置面板 | `isMemoryPanelOpen` | 查看/编辑记忆配置与文件（从 REST API 加载） |

**主面板功能**
- 模型选择卡片 → 打开模型面板
- 系统指令卡片 → 打开提示词面板
- 记忆设置卡片 → 打开记忆面板
- Function Calling 开关 → `modelConfig.enableTools`
- Temperature 滑块 → 0–2，步长 0.05
- Max Tokens 下拉 → Low(8192) / Middle(16384) / High(32768)

**自动保存模式**

## 8. Session V2 协议对齐（2026-03）

后端已升级到 Session V2，前端必须按以下约定发送 WS 消息：

1. WS 连接地址不再携带 `sessionId`
- 使用：`/api/v1/chat/ws`
- 不再使用：`/api/v1/chat/ws?sessionId=...`

2. `chat` payload 必须包含 `route`
- 最小 dm 路由示例：

```json
{
  "event": "chat",
  "payload": {
    "route": {
      "channel": "webchat",
      "chatType": "dm",
      "peerId": "peer_xxx",
      "accountId": "default"
    },
    "mode": "simple",
    "messages": [{ "role": "user", "content": "hi" }]
  }
}
```

3. 前端本地标识语义变更
- 原 `webclaw.sessionId` 迁移为 `webclaw.peerId`（用于 route.peerId）
- 会话路由由后端返回 `session_key_resolved` 决定

4. 需要处理的新服务端事件
- `session_key_resolved`: `{ sessionKey, sessionId, kind, channel }`
- `session_tool_result`: 会话工具（`sessions_send/spawn/...`）的异步回执

5. pi-web-ui 复用建议
- 当前项目保持“后端 WS 驱动”架构，不直接接入 `ChatPanel/AgentInterface`
- 可逐步复用 `MessageList` / `MessageEditor`，通过适配层映射当前 `ChatMessage` 结构，且保持现有主题 token

6. 当前适配层与开关
- 适配层目录：`frontend/src/adapters/pi-web-ui/`
  - `PiMessageListAdapter.tsx`
  - `PiChatInputAdapter.tsx`
- 环境开关：`VITE_USE_PI_WEB_UI_PARTIAL=true|false`（默认 false）
- 说明：当前适配层为“无样式变化”的占位入口，后续可在不改业务层的情况下替换为真实 pi-web-ui 组件实现。
- 编辑时 `saveStatus = 'Editing'`，`useEffect` 以 250ms 防抖写入父状态 / localStorage。

**REST API 调用**

| 端点 | 方法 | 用途 |
|---|---|---|
| `${API_V1}/models/list` | POST | 获取可用模型 ID 列表，body：`{baseUrl, apiKey}` |
| `${API_V1}/memory/config` | GET | 打开面板时加载记忆配置 |
| `${API_V1}/memory/files` | GET | 列出记忆文件元数据 |
| `${API_V1}/memory/config` | PUT | 保存更新的 MemoryConfig（250ms 防抖） |
| `${API_V1}/memory/file?name=...` | GET | 读取指定记忆文件内容 |

## 8. 共享类型（@webclaw/shared）

**定位文件**
- 入口：`shared/src/index.ts`
- WebSocket 事件：`shared/src/ws-events.ts`
- 会话类型：`shared/src/session.ts`

**WebSocket 事件契约**

```typescript
// Server → Client
type ServerEventType =
  | 'message_delta' | 'message_end' | 'tool_start' | 'tool_end'
  | 'plan_created' | 'worker_start' | 'worker_delta' | 'worker_end'
  | 'todo_update' | 'need_user_input' | 'done' | 'error' | 'ping'
  | 'session_restored' | 'session_key_resolved' | 'session_tool_result'

// Client → Server
type ClientEventType = 'chat' | 'cancel' | 'pong'
```

**Session 类型**

```typescript
type SessionId = string & { readonly __brand: 'SessionId' }
type SessionKey = string & { readonly __brand: 'SessionKey' }
type SessionKind = 'main' | 'group' | 'channel' | 'thread' | 'cron' | 'hook' | 'node' | 'other'
type SessionChannel = 'webchat' | 'internal' | 'telegram' | 'discord' | 'whatsapp' | 'unknown'
```

**前端本地类型定义**

```typescript
// useChat.ts
type ChatMode = 'simple' | 'plan'
type MessageRole = 'user' | 'assistant' | 'system' | 'event'
interface ChatMessage { id, role, content, timestamp, eventType? }
interface ModelConfig { model, temperature, maxTokens, baseUrl, apiKey, enableTools }

// HomePageLayout.tsx / SettingsDrawer.tsx
interface SystemPromptItem { id, title, prompt }
interface ModelPresetItem { id, title, model, baseUrl, apiKey }
interface MemoryConfig { flushTurns, embeddingBaseUrl }
interface MemoryFileMeta { name, size, updatedAt }
```

## 9. 扩展指南

### 添加新组件

1. 根据功能归属放置：
   - 页面级组件 → `src/app/<page>/components/`
   - 通用 UI 组件 → `src/components/ui/`
   - 聊天相关 → `src/components/chat/`
2. 使用语义 Token（`bg-surface`、`text-text-primary`）而非硬编码颜色。
3. 使用 `clsx()` + `tailwind-merge` 合并类名。
4. 保持文件 200–400 行，不超过 800 行。

### 添加新 Hook

1. 放置在 `src/hooks/` 下，文件名与 Hook 同名（`useXxx.ts`）。
2. 返回不可变状态 + 操作函数。
3. 参考 `useChat` 的模式：惰性初始化资源 + 组件卸载时清理。

### 添加新页面/路由

当前无路由系统。如需多页面：
1. 引入 `react-router-dom`。
2. 在 `App.tsx` 中配置路由。
3. 页面组件放在 `src/app/<page>/page.tsx`。

### 添加新 localStorage 键

1. 键名统一使用 `webclaw.` 前缀。
2. 在本文档"localStorage 键清单"中登记。
3. 读写时做 `try/catch`，兜底处理 localStorage 不可用的情况（参考 `lib/session.ts`）。

## 10. 已知问题与 TODO

| 问题 | 位置 | 说明 |
|---|---|---|
| `InputToolbar` 未使用 | `components/ui/InputToolbar.tsx` | 已定义但 `ChatInput` 未引用，可清理或接入 |
| `SettingsDrawer` 超 800 行 | `app/home/components/SettingsDrawer.tsx` | 1070 行，建议拆分为子组件 |
| 无测试文件 | 整个前端 | 未配置测试框架，无单元/集成/E2E 测试 |
| 暗色模式未持久化 | `HomePageLayout` | `isDark` 状态未写入 localStorage，刷新后重置 |
| 附件按钮为占位 | `ChatInput` Plus 按钮 | 仅 UI 展示，无实际功能 |
| `route` 字段未传递 | `useChat.ts` | shared 定义了 `route: SessionRouteContext`，但前端未发送 |
