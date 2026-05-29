// 中文：本文件（system-prompt-snapshot.ts）负责生成和识别会话级 FrozenSystemSnapshot，是 layered prompt 到 runtime 复用链路的快照边界。
// English: This file (system-prompt-snapshot.ts) builds and recognizes session-level FrozenSystemSnapshot objects for layered prompt runtime reuse.
//
// ============================================================
// 文件概览（给不熟悉 TypeScript 的读者）：
// ============================================================
// 这个文件做一件事：把一个会话的"系统提示词"拍一张快照，之后整个会话期间
// 都用这张快照，不再重新生成。目的是保证 system prompt 字节不变，从而让
// AI 模型 API 的 prompt cache 能命中。
//
// 快照（snapshot）记录了：
//   1. 最终的系统提示词文本（systemText）——发给模型的就是它
//   2. 这个文本的 SHA256 指纹（contentHash）——用于校验
//   3. 所有输入来源的 SHA256 指纹（sourceHashes）——用于后续版本对比
//   4. 分层信息（sliceHashes / sliceTokens）——用于调试和诊断
//
// 文件结构（从上到下）：
//   §1 import 导入依赖
//   §2 常量定义
//   §3 类型定义（interface）
//   §4 builder 构建函数 —— 核心：创建快照
//   §5 entry 识别函数 —— 从事件树中找回快照
//   §6 source hash 采集函数 —— 计算所有输入来源的指纹
//   §7 工具函数 —— 字符串稳定化、哈希、冻结等

// ============================================================
// §1 导入依赖（import）
// ============================================================
// TypeScript 中 import { X } from 'Y' 的意思是：从模块 Y 中取出具名导出 X
// import type { X } from 'Y' 的意思是：只导入 X 的类型信息，编译后不产生运行时代码

import { randomUUID } from 'node:crypto'
// randomUUID：Node.js 内置函数，生成 v4 UUID，如 "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

import { promises as fs } from 'node:fs'
// fs：Node.js 文件系统模块的 Promise 版本。如 fs.readFile(path, 'utf8') 返回 Promise<string>

import type { AgentTool } from '@mariozechner/pi-agent-core'
// AgentTool：第三方 agent 框架定义的工具类型，包含 name/description/parameters/execute 等字段

import type { SessionEventEntry, SessionMode, SessionRouteContext } from '@lecquy/shared'
// SessionEventEntry：会话事件树中的一条事件记录，包含 type/customType/data 等字段
// SessionMode：会话模式，取值为 'simple' | 'plan'
// SessionRouteContext：会话路由信息，包含 channel/chatType/peerId/userTimezone

import {
  buildManagedAgentsContent,
  buildManagedToolsContent,
  loadStartupSlices,
  resolvePromptContextPaths,
} from './context-files.js'
// 从同目录的 context-files.ts 导入四个函数：
//   buildManagedAgentsContent() → 生成 AGENTS.md 托管文本（运行时规则/权限分级等）
//   buildManagedToolsContent()  → 生成 TOOLS.md 托管文本（工作区路径/工具约定等）
//   loadStartupSlices()         → 加载启动层切片（SOUL+IDENTITY+USER+MEMORY.summary）
//   resolvePromptContextPaths() → 解析 workspace 下 .lecquy/ 各文件的路径

import { PROMPT_TEMPLATE_NAMES, readPromptModuleTemplate } from './prompt-module-files.js'
// PROMPT_TEMPLATE_NAMES：15 个模板名的数组，如 ['identity-simple','identity-manager',...]
// readPromptModuleTemplate(name, dir) → 读取并返回某个模板文件的内容（优先磁盘，回退默认）

import { buildLayeredSystemPrompt, hashContent } from './prompt-serializer.js'
// buildLayeredSystemPrompt(options, skillSession) → 构建分层 system prompt 的主函数
// hashContent(text) → 返回 text 的 SHA256 十六进制字符串

import type {
  AgentRole,
  BuildLayeredPromptOptions,
  CapabilityBlock,
} from './prompt-layer-types.js'
// AgentRole：'simple' | 'manager' | 'worker'
// BuildLayeredPromptOptions：传给 buildLayeredSystemPrompt 的参数对象类型
// CapabilityBlock：能力块，包含 executor（执行器类型）和 available（可用工具列表）

import { SKILLS } from '../skills/skill-loader.js'
// SKILLS：全局技能注册表单例，提供 listSkillSummaries() 和 getSkillContent() 等方法

import type { SkillSession } from '../skills/skill-session.js'
// SkillSession：技能会话实例，管理当前会话中激活的技能及其冻结切片

import { loadMemorySummary } from '../../memory/store.js'

// ============================================================
// §2 常量定义
// ============================================================

/** 存入 SessionManager 事件树时使用的 custom entry 类型标识。
 *  相当于给 snapshot entry 贴了一个标签，后续扫描事件树时通过这个标签识别。
 *  示例：manager.appendCustomEntry('system_prompt_snapshot', data) */
export const SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE = 'system_prompt_snapshot'

/** 查找事件树中 snapshot 时使用的生命周期边界。
 *  compact / resnapshot 后，边界之前的 snapshot 只保留作审计，不再参与恢复。 */
export interface FindFrozenSystemSnapshotOptions {
  readonly afterEntryId?: string
  readonly afterTimestamp?: string
}

// ============================================================
// §3 类型定义（interface）
// ============================================================
// interface 是 TypeScript 的类型定义语法，用于描述一个对象的"形状"（有哪些字段、各是什么类型）。
// readonly 表示该字段只能在创建时赋值，之后不可修改——编译器会帮你检查。
// 字段名后加 ? 表示可选，可以不存在（值为 undefined）。

/** FrozenSystemSnapshot：一张不可变的系统提示词快照。
 *
 *  生命周期示意：
 *    会话创建 → buildFrozenSystemSnapshot() → 写入事件树 → 整个会话复用
 *                   ↓ (P4 才会做)
 *              compact / resnapshot → 生成新快照，旧快照被取代
 *
 *  "冻结"的含义：一旦创建，所有字段都不再改变。即使磁盘上的 USER.md 被修改、
 *  时钟跨过午夜、模型被切换——当前快照的 systemText 仍然不变。
 *  这些变化由 P2 的 <system_prompt_update> 机制在 user message 层去表达，
 *  不会改写 system 字段，从而保护 prompt cache 命中率。
 */
export interface FrozenSystemSnapshot {
  /** 会话 ID。格式如 "session_abc123..."，由 SessionManager 在创建会话时生成。
   *  同一个会话可以有多个快照（resnapshot 后旧快照仍存在事件树中但不再使用）。 */
  readonly sessionId: string

  /** 快照 ID。每次 buildFrozenSystemSnapshot() 调用 randomUUID() 生成，
   *  格式如 "a1b2c3d4-e5f6-7890-abcd-ef1234567890"。即使同一会话多次快照，snapshotId 也唯一。 */
  readonly snapshotId: string

  /** 快照创建时间，ISO 8601 格式字符串。
   *  例如 "2026-05-18T14:30:00.000Z"。
   *  这个时间在创建时被冻结，不会随实际时钟走动而变化。 */
  readonly createdAt: string

  /** 创建原因：
   *  - session_created：会话首次创建时自动生成（P1 只用这个）
   *  - resnapshot：系统检测到来源变化累积足够，重建快照（P4 实现）
   *  - compact：上下文压缩后重建快照（P4 实现）
   *  - manual：用户通过命令手动触发（P4 实现） */
  readonly createdReason: 'session_created' | 'resnapshot' | 'compact' | 'manual'

  /** 角色。决定 system prompt 的 mode 层内容不同：
   *  - 'simple'：默认助手，直接完成用户请求
   *  - 'manager'：规划器，只拆任务不执行
   *  - 'worker'：执行器，只做单个子任务 */
  readonly role: AgentRole

  /** 会话模式：'simple'（普通对话）或 'plan'（规划模式）。
   *  与 role 不同：mode 影响会话整体行为（是否启动 plan 流程），
   *  role 影响单次 model 请求的 system prompt 身份指令。 */
  readonly mode: SessionMode

  /** 用户时区，如 'Asia/Shanghai'、'UTC'。来自 route.userTimezone。 */
  readonly timeZone?: string

  /** 使用的模型 ID，如 'Qwen3'、'gpt-4o'。来自配置或请求参数。 */
  readonly modelId?: string

  /** 当前会话已命中的技能名称，如 'code-review'。
   *  来自 skillSession.getActiveSkillName() 或 request.activeSkillName。
   *  注意：loadAndFreeze() 当前未被调用，SkillSession 冻结机制为预留能力。
   *  实际技能加载走 skill 工具 → <skill-loaded> 消息注入链路，无数量限制。
   *  未命中任何技能时为 undefined。 */
  readonly activeSkillName?: string

  /** 所有输入来源的 SHA256 指纹集合。详见 FrozenSystemSourceHashes 的注释。
   *  用途：P2 做 diff 时，对比新旧来源 hash 就能知道"是什么变了"。 */
  readonly sourceHashes: FrozenSystemSourceHashes

  /** 各层的 SHA256 哈希，key 为层标签名，value 为 64 位十六进制字符串。
   *  层标签名来自 LAYER_TAGS：'system' | 'mode' | 'startup' | 'skill' | 'user_preference'
   *  示例：{ "system": "a1b2...", "mode": "c3d4...", "startup": "e5f6..." } */
  readonly sliceHashes: Record<string, string>

  /** 各层的 token 估算数，key 为层标签名，value 为估算 token 数（整数）。
   *  估算公式：token ≈ ceil(字符数 / 3.5)
   *  示例：{ "system": 420, "mode": 85, "startup": 310 } */
  readonly sliceTokens: Record<string, number>

  /** ★ 最核心字段：最终发给 AI 模型的系统提示词文本。
   *  这个字符串由 5 个分层切片按 PromptLayer 数值排序后拼接而成，
   *  格式为 <LAYER:标签名>\n内容\n</LAYER> 的 XML-like 结构。
   *  同一 snapshot 生命周期内，这个字段的每一个字节都不变。 */
  readonly systemText: string

  /** systemText 的 SHA256 哈希，64 位十六进制字符串。
   *  计算公式：hashContent(systemText) = SHA256(systemText).hex()
   *  两个 systemText 相同 ⇔ 它们的 contentHash 相同。 */
  readonly contentHash: string
}

/** FrozenSystemSourceHashes：快照所有输入来源的 SHA256 指纹集合。
 *
 *  设计意图：P2 做 <system_prompt_update> 时，需要回答"上次快照以来什么输入变了？"
 *  如果只保存最终 systemText 的 hash，无法知道是哪个来源变了。
 *  所以这里把 11 类输入来源各自 hash 一遍，P2 逐项对比即可定位变化。
 *
 *  每一类来源的 hash 计算方法：
 *    1. 读取/生成该来源的文本内容
 *    2. 如果不要求稳定排序（如文件内容），直接 SHA256(原始文本)
 *    3. 如果要排序（如工具列表、skills 列表），先 stableStringify() 再 SHA256
 *
 *  示例（实际值均为 64 位十六进制，这里缩写）：
 *  {
 *    promptModules:  { "identity-simple": "a1b2...", "safety": "c3d4...", ...共15个 },
 *    managedAgents:  "e5f678...",    // buildManagedAgentsContent() 输出的 hash
 *    managedTools:   "90ab...",      // buildManagedToolsContent(paths) 输出的 hash
 *    soul:           "cdef...",      // .lecquy/SOUL.md 文件内容的 hash（无文件则为空串hash）
 *    identity:       "0123...",      // .lecquy/IDENTITY.md 文件内容的 hash
 *    user:           "4567...",      // .lecquy/USER.md 文件内容的 hash
 *    memorySummary:  "89ab...",      // .lecquy/MEMORY.summary.md 的 hash
 *    toolInventory:  "cdef...",      // stableStringify({toolsEnabled, tools[...]}) 的 hash
 *    skillsIndex:    "0123...",      // stableStringify([{name,description,...},...]) 的 hash
 *    activeSkill?:   "4567...",      // 激活技能正文的 hash（无激活技能则此字段不存在）
 *    runtimeInputs:  "89ab...",      // stableStringify({role,mode,modelId,...}) 的 hash
 *  }
 */
export interface FrozenSystemSourceHashes {
  /** 15 个 prompt 模板文件的 hash，key 是模板名，value 是 SHA256。
   *  模板名列表：identity-simple, identity-manager, identity-worker, role-simple,
   *  role-manager, role-worker, tooling, tool-call-style, safety, skills, workspace,
   *  documentation, time, runtime, extra-instructions
   *  每个模板先通过 readPromptModuleTemplate() 读取（优先磁盘覆盖，回退默认模板），
   *  再对读取结果做 SHA256。 */
  readonly promptModules: Record<string, string>

  /** buildManagedAgentsContent() 输出的 SHA256。
   *  这是硬编码在 context-files.ts 中的运行时规则文本（权限三档、manager/worker 协议等）。
   *  它不是从磁盘文件读取的，所以这里直接 hash 函数输出而非文件内容。 */
  readonly managedAgents: string

  /** buildManagedToolsContent(paths) 输出的 SHA256。
   *  同上，是硬编码的工具环境说明文本。其中包含工作区路径等动态信息，
   *  所以如果工作区路径变了，这个 hash 也会变。 */
  readonly managedTools: string

  /** .lecquy/SOUL.md 文件内容的 SHA256。文件不存在时 hash 空字符串。 */
  readonly soul: string

  /** .lecquy/IDENTITY.md 文件内容的 SHA256。文件不存在时 hash 空字符串。 */
  readonly identity: string

  /** .lecquy/USER.md 文件内容的 SHA256。文件不存在时 hash 空字符串。 */
  readonly user: string

  /** .lecquy/MEMORY.summary.md 文件内容的 SHA256。文件不存在时 hash 空字符串。
   *  注意：这不是 memory.db 的 hash，只是 frozen summary 文件。 */
  readonly memorySummary: string

  /** 工具清单的稳定序列化 hash。
   *  输入：{ toolsEnabled: true/false, tools: [{name, description}, ...] }
   *  处理：tools 数组按 name 字母排序 → stableStringify → SHA256
   *  这样即使 tools 数组传入顺序不同，只要工具集合一样，hash 就一样。 */
  readonly toolInventory: string

  /** 技能索引的稳定序列化 hash。
   *  来源：SKILLS.listSkillSummaries(workspaceDir) 返回所有已注册 skill 的摘要列表
   *  处理：每个 skill 只取 name/description/displayPath/source → 按 name 排序 → SHA256 */
  readonly skillsIndex: string

  /** 当前激活技能正文的 SHA256。仅在技能已激活时才存在（P1 中通常为 undefined）。
   *  来源：skillSession.getSlice().contentHash 或 SKILLS.getSkillContent() → SHA256 */
  readonly activeSkill?: string

  /** 运行时输入的稳定序列化 hash。
   *  输入字段：role, mode, channel, chatType, peerId, timeZone, modelId,
   *           thinkingLevel, toolsEnabled, extraInstructions, snapshotNow
   *  处理：所有字段按 key 字母排序 → 过滤 undefined → stableStringify → SHA256 */
  readonly runtimeInputs: string
}

/** BuildFrozenSystemSnapshotRequest：调用 buildFrozenSystemSnapshot() 时需要传入的参数对象。
 *
 *  TypeScript 语法说明：
 *  - ReadonlyArray<AgentTool<any>>：只读数组，不能 push/pop/sort 等修改操作
 *  - FrozenSystemSnapshot['createdReason']：引用 FrozenSystemSnapshot.createdReason 的类型，
 *    即 'session_created' | 'resnapshot' | 'compact' | 'manual'
 *
 *  调用示例：
 *  {
 *    sessionId: 'session_abc123',
 *    createdReason: 'session_created',
 *    role: 'simple',
 *    mode: 'simple',
 *    workspaceDir: '/Users/kira/projects/Lecquy',
 *    route: { channel: 'webchat', chatType: 'dm', peerId: 'kira', userTimezone: 'Asia/Shanghai' },
 *    modelId: 'Qwen3',
 *    thinkingLevel: 'medium',
 *    tools: [bashTool, readFileTool, writeFileTool],
 *    toolsEnabled: true,
 *    extraInstructions: '请用中文回复。',
 *    now: new Date('2026-05-18T12:00:00Z')
 *  }
 */
export interface BuildFrozenSystemSnapshotRequest {
  readonly sessionId: string
  readonly createdReason: FrozenSystemSnapshot['createdReason']
  readonly role: AgentRole
  readonly mode: SessionMode
  /** 工作区根目录的绝对路径，如 '/Users/kira/projects/Lecquy' */
  readonly workspaceDir: string
  /** 会话路由上下文（channel/chatType/peerId/userTimezone），可选 */
  readonly route?: SessionRouteContext
  /** 模型 ID 字符串，如 'Qwen3' */
  readonly modelId: string
  /** 推理深度等级：'off' | 'low' | 'medium' | 'high'，可选 */
  readonly thinkingLevel?: string
  /** 工具对象数组（只读），每个元素包含 name/description/parameters/execute */
  readonly tools: ReadonlyArray<AgentTool<any>>
  /** 工具总开关：false 时即使 tools 不为空也不启用工具 */
  readonly toolsEnabled: boolean
  /** 兼容层附加指令，出现在 system prompt 末尾，可选 */
  readonly extraInstructions?: string
  /** 期望激活的技能名，可选。最终生效的技能以 skillSession 为准 */
  readonly activeSkillName?: string
  /** 技能会话实例，可选。如果已存在活跃技能会话则传入以复用 */
  readonly skillSession?: SkillSession
  /** 快照创建时间，可选。传入则冻结在此时间，不传则取当前系统时间。
   *  测试用：new Date('2026-05-18T01:02:03.000Z') 保证确定性 */
  readonly now?: Date
}

/** SystemPromptSnapshotEntryData：存入事件树的 snapshot entry 的数据格式。
 *
 *  TypeScript 语法说明：
 *  - typeof SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE 的值是字符串 'system_prompt_snapshot'
 *  - 写 typeof 而非直接写 string，是为了保证类型层面和常量值完全一致
 *
 *  这个对象会作为 SessionManager.appendCustomEntry() 的第二个参数传入。
 *  事件树中的存储形式：
 *  {
 *    type: 'custom',
 *    customType: 'system_prompt_snapshot',
 *    data: {
 *      kind: 'system_prompt_snapshot',
 *      snapshot: { sessionId: '...', snapshotId: '...', systemText: '...', ... }
 *    }
 *  }
 */
export interface SystemPromptSnapshotEntryData {
  readonly kind: typeof SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE
  readonly snapshot: FrozenSystemSnapshot
}

/** ToolSummary：工具摘要，只保留 name 和 description。
 *  这是内部类型（未 export），只在构建快照时用于 hash 工具清单。
 *  不需要完整的 AgentTool（含 parameters/execute），因为工具描述已足够区分版本。
 *
 *  示例转换：
 *  AgentTool { name: 'bash', description: '执行 shell 命令', parameters: {...}, execute: fn }
 *  → ToolSummary { name: 'bash', description: '执行 shell 命令' }
 */
interface ToolSummary {
  readonly name: string
  readonly description: string
}

export interface CurrentSystemPromptSourceState {
  readonly sourceHashes: FrozenSystemSourceHashes
  readonly currentEditableSources: {
    readonly soul: string
    readonly identity: string
    readonly user: string
    readonly memorySummary: string
  }
  readonly currentRuntimeInputs: {
    readonly mode: SessionMode
    readonly modelId: string
    readonly thinkingLevel?: string
    readonly toolsEnabled: boolean
    readonly extraInstructions?: string
    readonly timeZone?: string
    readonly snapshotNow: string
  }
}

const HASH_PATTERN = /^[a-f0-9]{64}$/i
const CREATED_REASON_SET = new Set<FrozenSystemSnapshot['createdReason']>([
  'session_created',
  'resnapshot',
  'compact',
  'manual',
])
const AGENT_ROLE_SET = new Set<AgentRole>(['simple', 'manager', 'worker'])
const SESSION_MODE_SET = new Set<SessionMode>(['simple', 'plan'])

// ============================================================
// §4 Builder 构建函数 —— 核心：创建快照
// ============================================================

/** 从工具列表中提取能力声明块（CapabilityBlock）。
 *
 *  TypeScript 语法说明：
 *  - ReadonlyArray<AgentTool<any>>：元素为 AgentTool<any> 的只读数组
 *  - (tool) => tool.name：箭头函数，等价于 function(tool) { return tool.name }
 *  - tools.map(fn)：数组方法，对每个元素调用 fn，返回新数组
 *  - .sort()：数组方法，默认按字符串 Unicode 排序
 *  - process.platform：Node.js 全局变量，'darwin'/'linux'/'win32'
 *
 *  计算步骤：
 *  1. 如果 toolsEnabled 为 true，提取所有工具的 name 并排序，得到 available 数组
 *     如果 toolsEnabled 为 false，available 为空数组 []
 *  2. 判断 executor：toolsEnabled 为 true 且 available 包含 'bash' 时，
 *     Windows 上为 'powershell'，其余平台为 'shell'；否则为 'none'
 *  3. unavailable 固定为 ['no_browser', 'no_deploy', 'no_external_api']（排序后）
 *
 *  示例 1（工具启用，有 bash）：
 *    输入：tools=[bash工具, read_file工具, write_file工具], toolsEnabled=true
 *    计算：available = ['bash','read_file','write_file']（排序后）
 *          executor = 'shell'（macOS/Linux）
 *    输出：{ executor: 'shell', available: ['bash','read_file','write_file'],
 *            unavailable: ['no_browser','no_deploy','no_external_api'] }
 *
 *  示例 2（工具禁用）：
 *    输入：tools=[bash工具, read_file工具], toolsEnabled=false
 *    计算：available = []（因为 toolsEnabled 为 false）
 *          executor = 'none'（因为 available 不含 'bash'）
 *    输出：{ executor: 'none', available: [], unavailable: [...] }
 */
export function buildPromptCapabilityFromTools(
  tools: ReadonlyArray<AgentTool<any>>,
  toolsEnabled: boolean,
): CapabilityBlock {
  // 步骤1：提取工具名并排序
  // TypeScript 三元表达式：条件 ? 为真时的值 : 为假时的值
  const available = toolsEnabled
    ? tools.map((tool) => tool.name).sort()
    : []

  // 步骤2-3：组装能力块
  return {
    executor: toolsEnabled && available.includes('bash')
      ? (process.platform === 'win32' ? 'powershell' : 'shell')
      : 'none',
    available,
    unavailable: ['no_browser', 'no_deploy', 'no_external_api'].sort(),
  }
}

/** ★ 核心函数：构建一张冻结的系统提示词快照。
 *
 *  TypeScript 语法说明：
 *  - async function：异步函数，返回 Promise（承诺），需要用 await 等待结果
 *  - Promise<FrozenSystemSnapshot>：承诺最终会返回一个 FrozenSystemSnapshot 对象
 *  - await：等待一个 Promise 完成并取出其返回值
 *  - request.now ?? new Date()：空值合并运算符，now 不为 null/undefined 时取 now，否则取 new Date()
 *  - const { a, b } = obj：解构赋值，从对象中提取指定字段
 *  - Promise.all([p1, p2])：并行等待多个 Promise 全部完成，返回结果数组
 *
 *  整体流程（5个步骤）：
 *
 *  步骤1：准备冻结时间
 *  ┌──────────────────────────────────────────────────────┐
 *  │ snapshotNow = (request.now ?? new Date()).toISOString() │
 *  │ 如果调用方传了 now，用它；否则取当前系统时间              │
 *  │ .toISOString() 转为 ISO 8601 格式如 "2026-05-18T12:00:00.000Z" │
 *  └──────────────────────────────────────────────────────┘
 *
 *  步骤2：构建能力块 + 加载启动上下文
 *  ┌──────────────────────────────────────────────────────┐
 *  │ capability = buildPromptCapabilityFromTools(tools, enabled) │
 *  │ { startupSlice, preferenceSlice, managedSystemContent } │
 *  │     = await loadStartupSlices({workspaceDir, role, capability}) │
 *  │                                                      │
 *  │ loadStartupSlices 内部做的事：                          │
 *  │   a. 读取 .lecquy/SOUL.md, IDENTITY.md, USER.md       │
 *  │   b. 调用 memory store 读取 MEMORY.summary.md         │
 *  │   c. 解析 USER.md frontmatter（profile/preference 分离）│
 *  │   d. 生成 managedSystemContent（AGENTS+TOOLS 托管文本） │
 *  │   e. 组合为 startupSlice + preferenceSlice           │
 *  │   f. 按 STARTUP_BUDGETS 裁剪超预算内容                │
 *  └──────────────────────────────────────────────────────┘
 *
 *  步骤3：构造分层构建选项
 *  ┌──────────────────────────────────────────────────────┐
 *  │ 将步骤1、2 的结果 + request 中的其他参数，             │
 *  │ 打包成一个 BuildLayeredPromptOptions 对象。            │
 *  │ ★ 关键：snapshotNow 传入此对象，system-prompts.ts     │
 *  │   的 buildTimeSection 会用 snapshotNow 而非 new Date() │
 *  │   来生成时间段落，从而冻结时间。                       │
 *  │                                                      │
 *  │ userSlices/soulContent/identityContent/memorySummary  │
 *  │ 在此处传空字符串——因为启动上下文已经通过 startupSlice   │
 *  │ 和 preferenceSlice 传入，不需要重复传原始文本。        │
 *  └──────────────────────────────────────────────────────┘
 *
 *  步骤4：并行构建 system prompt + 采集 source hash
 *  ┌──────────────────────────────────────────────────────┐
 *  │ const [result, sourceHashes] = await Promise.all([   │
 *  │   buildLayeredSystemPrompt(layeredOptions, skillSession), │
 *  │   collectCurrentSystemPromptSourceState(request, now), │
 *  │ ])                                                   │
 *  │                                                      │
 *  │ 两条线并行执行（互不依赖），加快构建速度：               │
 *  │   线A：buildLayeredSystemPrompt()                     │
 *  │     → 调用 system-prompts.ts 的 5 个 builder          │
 *  │     → serializeSystemPrompt() 序列化为最终文本         │
 *  │     → 返回 { systemPrompt, sliceHashes, sliceTokens } │
 *  │                                                      │
 *  │   线B：collectCurrentSystemPromptSourceState()        │
 *  │     → 并行 hash 6 类来源（见 §6）                     │
 *  │     → 返回 FrozenSystemSourceHashes                   │
 *  └──────────────────────────────────────────────────────┘
 *
 *  步骤5：组装最终 snapshot 对象并冻结
 *  ┌──────────────────────────────────────────────────────┐
 *  │ return deepFreezeSnapshot({                          │
 *  │   sessionId, snapshotId(新UUID), createdAt(冻结时间),  │
 *  │   createdReason, role, mode, timeZone, modelId,       │
 *  │   activeSkillName, sourceHashes,                      │
 *  │   sliceHashes, sliceTokens,                           │
 *  │   systemText: result.systemPrompt,                    │
 *  │   contentHash: hashContent(result.systemPrompt),      │
 *  │ })                                                   │
 *  │                                                      │
 *  │ 最后调用 deepFreezeSnapshot() 做 Object.freeze，      │
 *  │ 确保返回的 snapshot 对象及其嵌套对象都不可修改。       │
 *  └──────────────────────────────────────────────────────┘
 *
 *  完整调用示例：
 *  const snapshot = await buildFrozenSystemSnapshot({
 *    sessionId: 'session_abc123',
 *    createdReason: 'session_created',
 *    role: 'simple',
 *    mode: 'simple',
 *    workspaceDir: '/Users/kira/projects/Lecquy',
 *    route: { channel: 'webchat', chatType: 'dm', peerId: 'kira', userTimezone: 'Asia/Shanghai' },
 *    modelId: 'Qwen3',
 *    thinkingLevel: 'medium',
 *    tools: [bashTool, readFileTool],
 *    toolsEnabled: true,
 *  })
 *  // snapshot.systemText 就是发给模型的 system prompt
 *  // snapshot.contentHash 是它的 SHA256 指纹
 *  // snapshot.sourceHashes.promptModules['identity-simple'] 是 identity-simple 模板的 SHA256
 */
export async function buildFrozenSystemSnapshot(
  request: BuildFrozenSystemSnapshotRequest,
): Promise<FrozenSystemSnapshot> {
  // ---------- 步骤1：准备冻结时间 ----------
  // resolvePromptContextPaths 解析出 .lecquy/ 下各文件的路径
  const workspaceDir = resolvePromptContextPaths(request.workspaceDir).workspaceDir
  // 冻结时间：如果有传入 now 就用它，否则取当前时间，转为 ISO 字符串
  // ?? 是"空值合并运算符"：左边为 null 或 undefined 时取右边
  const sourceState = await collectCurrentSystemPromptSourceState(request, request.now ?? new Date())
  const snapshotNow = sourceState.currentRuntimeInputs.snapshotNow

  // ---------- 步骤2：构建能力块 + 加载启动上下文 ----------
  const capability = buildPromptCapabilityFromTools(request.tools, request.toolsEnabled)
  // 并行加载：startupSlice（启动上下文层）、preferenceSlice（用户偏好层）、
  // managedSystemContent（AGENTS + TOOLS 托管文本）
  const { startupSlice, preferenceSlice, managedSystemContent } = await loadStartupSlices({
    workspaceDir,
    role: request.role,
    capability,
  })

  // ---------- 步骤3：准备工具摘要 + 确定激活技能 ----------
  // 把完整的 AgentTool 对象转为只含 name/description 的轻量摘要，供 hash 和 layer 构建使用
  const toolSummaries = request.tools.map(toToolSummary)
  // 激活技能名：优先取 skillSession 中的活跃技能名，其次取 request.activeSkillName
  // ?. 是"可选链运算符"：左边为 null/undefined 时短路返回 undefined
  // ?? 同理：左边为 null/undefined 时取右边
  // || undefined：空字符串也转为 undefined，让 TypeScript 类型更干净
  const activeSkillName = (request.skillSession?.getActiveSkillName() ?? request.activeSkillName?.trim()) || undefined

  // ---------- 步骤4：组装 layeredOptions ----------
  // BuildLayeredPromptOptions 是传给 buildLayeredSystemPrompt() 的完整参数对象
  const layeredOptions: BuildLayeredPromptOptions = {
    role: request.role,                 // 角色：simple/manager/worker
    mode: request.mode,                 // 模式：simple/plan
    workspaceDir,                       // 工作区根目录
    tools: toolSummaries,               // 工具摘要列表
    toolsEnabled: request.toolsEnabled, // 工具开关
    modelId: request.modelId,           // 模型 ID
    thinkingLevel: request.thinkingLevel, // 推理深度
    channel: request.route?.channel,    // 通道来源（如 'webchat'）
    chatType: request.route?.chatType,  // 会话类型（如 'dm'）
    timeZone: request.route?.userTimezone, // 用户时区
    snapshotNow,                        // ★ 冻结的时间，替代 system-prompts.ts 中的 new Date()
    extraInstructions: request.extraInstructions,  // 附加指令
    activeSkillName,                    // 激活技能名
    managedSystemContent,               // AGENTS+TOOLS 托管文本
    startupSlice,                       // 预构建的启动层切片
    preferenceSlice,                    // 预构建的偏好层切片
    capability,                         // 能力块
    // 以下三个传空——因为 userSlices/soul/identity/memorySummary 的原始内容
    // 已经在上面的 startupSlice 和 preferenceSlice 中体现了。
    // 传空能避免提示词里重复出现相同的正文。
    userSlices: {
      profileSlice: '',
      preferenceSlice: '',
      rejected: false,
    },
    soulContent: '',
    identityContent: '',
    memorySummary: '',
  }

  // ---------- 步骤5：构建 system prompt ----------
  // source hash 已由 collectCurrentSystemPromptSourceState 统一采集，P2 update builder 复用同一入口。
  const result = await buildLayeredSystemPrompt(layeredOptions, request.skillSession)

  // ---------- 步骤6：组装并冻结 ----------
  // deepFreezeSnapshot 对 snapshot 及其嵌套对象做 Object.freeze
  return deepFreezeSnapshot({
    sessionId: request.sessionId,
    snapshotId: randomUUID(),          // 生成唯一 UUID 作为快照 ID
    createdAt: snapshotNow,            // 冻结的时间戳
    createdReason: request.createdReason,
    role: request.role,
    mode: request.mode,
    timeZone: request.route?.userTimezone,
    modelId: request.modelId,
    activeSkillName,
    sourceHashes: sourceState.sourceHashes,  // 11 类输入来源的 SHA256 指纹
    sliceHashes: result.sliceHashes,   // 各层 SHA256（来自线A）
    sliceTokens: result.sliceTokens,   // 各层 token 估算（来自线A）
    systemText: result.systemPrompt,   // ★ 最终 system prompt 文本（来自线A）
    contentHash: hashContent(result.systemPrompt),  // systemText 的 SHA256
  })
}

// ============================================================
// §5 Entry 识别函数 —— 从事件树中找回快照
// ============================================================

/** 类型守卫（Type Guard）：判断一个未知类型的值是否是合法的 snapshot entry data。
 *
 *  TypeScript 语法说明：
 *  - input is SystemPromptSnapshotEntryData：类型谓词（type predicate）
 *    如果函数返回 true，TypeScript 编译器会将 input 的类型从 unknown 收窄为
 *    SystemPromptSnapshotEntryData，后续可以安全访问 input.snapshot 等字段
 *  - Partial<SystemPromptSnapshotEntryData>：所有字段都变为可选的 SystemPromptSnapshotEntryData
 *  - typeof snapshot?.sessionId === 'string'：? 可选链 + typeof 运行时类型检查
 *
 *  检查逻辑（逐层验证）：
 *  ① input 必须是非 null 的 object
 *  ② data.kind 必须等于 'system_prompt_snapshot'
 *  ③ data.snapshot 必须存在（不是 null/undefined）
 *  ④ snapshot.sessionId 必须是 string 类型
 *  ⑤ snapshot.snapshotId 必须是 string 类型
 *  ⑥ snapshot.systemText 必须是 string 类型
 *  ⑦ snapshot.contentHash 必须是 string 类型
 *
 *  为什么不用 try-catch 或 JSON Schema？因为这个函数在热路径上
 *  （每次从事件树恢复都要调），手写检查比 schema 验证快得多。
 *
 *  示例：
 *  合法输入 → true:
 *    isSystemPromptSnapshotEntryData({
 *      kind: 'system_prompt_snapshot',
 *      snapshot: { sessionId: 's1', snapshotId: 'u1', systemText: '你是...', contentHash: 'a1b2...' }
 *    })
 *
 *  非法输入 → false:
 *    isSystemPromptSnapshotEntryData(null)                       // 不是 object
 *    isSystemPromptSnapshotEntryData({ kind: 'other', ... })     // kind 不匹配
 *    isSystemPromptSnapshotEntryData({ kind: '...', snapshot: {} })  // snapshot 缺少必要字段
 */
export function isSystemPromptSnapshotEntryData(input: unknown): input is SystemPromptSnapshotEntryData {
  // ① 排除 null 和非 object：typeof null === 'object' 是 JS 的历史 bug，需要额外判空
  if (!input || typeof input !== 'object') return false

  // ② 断言为 Partial 类型以便逐字段检查
  const data = input as Partial<SystemPromptSnapshotEntryData>

  // ③~⑦ 逐字段验证：kind 匹配 + snapshot 存在 + 四个关键字段都是 string
  // && 是短路运算符：左边为 false 时直接返回 false，不再计算右边
  return data.kind === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE
    && validateFrozenSystemSnapshot(data.snapshot)
}

export function validateFrozenSystemSnapshot(input: unknown): input is FrozenSystemSnapshot {
  if (!isRecord(input)) {
    return false
  }

  const snapshot = input as Partial<FrozenSystemSnapshot>
  if (
    !isNonEmptyString(snapshot.sessionId)
    || !isNonEmptyString(snapshot.snapshotId)
    || !isIsoTimestamp(snapshot.createdAt)
    || !CREATED_REASON_SET.has(snapshot.createdReason as FrozenSystemSnapshot['createdReason'])
    || !AGENT_ROLE_SET.has(snapshot.role as AgentRole)
    || !SESSION_MODE_SET.has(snapshot.mode as SessionMode)
    || !isOptionalString(snapshot.timeZone)
    || !isOptionalString(snapshot.modelId)
    || !isOptionalString(snapshot.activeSkillName)
    || typeof snapshot.systemText !== 'string'
    || !isHash(snapshot.contentHash)
    || snapshot.contentHash !== hashContent(snapshot.systemText)
    || !isFrozenSystemSourceHashes(snapshot.sourceHashes)
    || !isHashRecord(snapshot.sliceHashes)
    || !isTokenRecord(snapshot.sliceTokens)
  ) {
    return false
  }

  return true
}

/** 从事件树中找到当前会话+角色的最新快照。
 *
 *  TypeScript 语法说明：
 *  - ReadonlyArray<SessionEventEntry>：SessionEventEntry 的只读数组
 *  - FrozenSystemSnapshot | null：返回值要么是 FrozenSystemSnapshot，要么是 null
 *  - [...entries].reverse()：展开运算符复制数组，再反转（不修改原数组）
 *  - entry.type !== 'custom' → continue：跳过非 custom 类型的事件，继续下一次循环
 *
 *  查找策略：从最新到最旧扫描（反转数组），取第一个匹配的。
 *  因为同一个 sessionId+role 可能有多个 snapshot（resnapshot 后旧的不删除），
 *  最新的那个才是当前有效的。
 *
 *  匹配条件（三个同时满足）：
 *  ① entry.type === 'custom' 且 entry.customType === 'system_prompt_snapshot'
 *  ② entry.data 通过 isSystemPromptSnapshotEntryData 校验
 *  ③ snapshot.sessionId === sessionId 且 snapshot.role === role
 *
 *  为什么按 role 过滤？同一个会话可能有 simple 和 worker 两个 role 各自的快照，
 *  必须区分。例如 plan 模式下，manager 用 'manager' role 的快照，
 *  worker 用 'worker' role 的快照，两者 systemText 不同。
 *
 *  示例：
 *    事件树中有：
 *      entry#1: snapshot(sessionId='s1', role='simple')  ← 最早
 *      entry#2: snapshot(sessionId='s1', role='worker')
 *      entry#3: snapshot(sessionId='s1', role='simple')  ← 最新（resnapshot 产物）
 *
 *    findLatestFrozenSystemSnapshot(entries, 's1', 'simple')
 *    → 反转后先看到 entry#3 → sessionId 匹配 + role 匹配 → 返回 entry#3 的 snapshot
 */
export function findLatestFrozenSystemSnapshot(
  entries: ReadonlyArray<SessionEventEntry>,
  sessionId: string,
  role: AgentRole,
  options: FindFrozenSystemSnapshotOptions = {},
): FrozenSystemSnapshot | null {
  const afterEntryIndex = options.afterEntryId
    ? entries.findIndex((entry) => entry.id === options.afterEntryId)
    : -1

  // 从最新到最旧遍历；如果有 compact 边界，只扫描边界之后的 entry。
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (afterEntryIndex >= 0 && index <= afterEntryIndex) {
      continue
    }

    const entry = entries[index]
    if (!entry) {
      continue
    }
    // 条件①：必须是 custom entry 且 customType 为 'system_prompt_snapshot'
    if (entry.type !== 'custom' || entry.customType !== SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE) {
      continue  // 跳过这条，继续下一条
    }
    // 条件②：entry.data 必须通过类型守卫验证
    if (!isSystemPromptSnapshotEntryData(entry.data)) {
      continue
    }
    // 条件③：sessionId 和 role 都必须匹配
    const { snapshot } = entry.data
    if (afterEntryIndex < 0 && options.afterTimestamp) {
      const entryAfterBoundary = entry.timestamp > options.afterTimestamp
      const snapshotAfterBoundary = snapshot.createdAt > options.afterTimestamp
      if (!entryAfterBoundary && !snapshotAfterBoundary) {
        continue
      }
    }
    if (snapshot.sessionId === sessionId && snapshot.role === role) {
      return snapshot  // 找到了，直接返回
    }
  }

  return null  // 遍历完都没找到，返回 null
}

// ============================================================
// §6 Source Hash 采集函数 —— 计算所有输入来源的指纹
// ============================================================

/** 将 AgentTool 转为轻量摘要 ToolSummary。
 *
 *  为什么需要这个转换？AgentTool 对象包含 execute 函数和 parameters schema，
 *  这些东西不能安全地序列化（函数无法 JSON.stringify）且与 prompt 内容无关。
 *  只取 name + description 足以区分工具版本。
 *
 *  description 的取值优先级：
 *  1. tool.description?.trim() —— 工具的描述字段（去除首尾空白）
 *  2. tool.label?.trim()       —— 工具的标签字段
 *  3. '可用工具'               —— 兜底默认值
 *  || 运算符：左边为 falsy（空字符串/null/undefined）时取右边
 *
 *  示例：
 *    toToolSummary({ name: 'bash', description: '执行shell命令', label: 'Bash', ... })
 *    → { name: 'bash', description: '执行shell命令' }
 *
 *    toToolSummary({ name: 'read_file', description: '', label: '读文件', ... })
 *    → { name: 'read_file', description: '读文件' }  （description 为空，用 label）
 *
 *    toToolSummary({ name: 'unknown', description: '', label: '', ... })
 *    → { name: 'unknown', description: '可用工具' }  （都为空，用兜底值）
 */
function toToolSummary(tool: AgentTool<any>): ToolSummary {
  return {
    name: tool.name,
    // 三级兜底：description → label → '可用工具'
    description: tool.description?.trim() || tool.label?.trim() || '可用工具',
  }
}

/** 并行采集所有 6 类输入来源的 SHA256 指纹，汇总为一个 FrozenSystemSourceHashes 对象。
 *
 *  采集策略：6 条线全部并行（Promise.all），每条线独立计算一类来源的 hash。
 *  因为各类来源之间没有依赖关系，并行可以最大化利用 IO 等待时间。
 *
 *  6 条线的对应关系：
 *  线① hashPromptModuleTemplates(workspaceDir)
 *      → 读取 15 个 prompt 模板文件 → 每个做 SHA256 → 返回 Record<string,string>
 *  线② readCurrentEditableSources(workspaceDir)
 *      → 读取 SOUL/IDENTITY/USER/MEMORY.summary 当前有效内容
 *  线③ hashManagedSources(workspaceDir)
 *      → 执行 buildManagedAgentsContent() + buildManagedToolsContent() → SHA256
 *  线④ hashSkillsIndex(workspaceDir)
 *      → 列出所有已注册 skill 摘要 → 排序 → stableStringify → SHA256
 *  线⑤ hashActiveSkill(activeSkillName, workspaceDir, skillSession)
 *      → 取激活 skill 的正文 → SHA256（可能返回 undefined）
 *
 *  线①~⑤ 的结果由 Promise.all 收集后，线⑥（toolInventory 和 runtimeInputs）
 *  在主线程同步计算（不需要读文件）。
 */
export async function collectCurrentSystemPromptSourceState(
  request: BuildFrozenSystemSnapshotRequest,
  now: Date,
): Promise<CurrentSystemPromptSourceState> {
  const workspaceDir = resolvePromptContextPaths(request.workspaceDir).workspaceDir
  const snapshotNow = now.toISOString()
  const toolSummaries = request.tools.map(toToolSummary)
  const activeSkillName = (request.skillSession?.getActiveSkillName() ?? request.activeSkillName?.trim()) || undefined

  // Promise.all 并行启动线①~⑤，等待全部完成后解构取出结果
  const [
    promptModules,      // 线①：Record<string, string>，15 个模板的 hash
    contextSources,     // 线②：{ soul, identity, user, memorySummary }
    managedSources,     // 线③：{ managedAgents, managedTools }
    skillsIndex,        // 线④：string，skill 索引的 hash
    activeSkill,        // 线⑤：string | undefined，激活 skill 的 hash
  ] = await Promise.all([
    hashPromptModuleTemplates(workspaceDir),
    readCurrentEditableSources(workspaceDir),
    hashManagedSources(workspaceDir),
    hashSkillsIndex(workspaceDir),
    hashActiveSkill(activeSkillName, workspaceDir, request.skillSession),
  ])

  const currentRuntimeInputs = {
    mode: request.mode,
    modelId: request.modelId,
    thinkingLevel: request.thinkingLevel,
    toolsEnabled: request.toolsEnabled,
    extraInstructions: request.extraInstructions,
    timeZone: request.route?.userTimezone,
    snapshotNow,
  } satisfies CurrentSystemPromptSourceState['currentRuntimeInputs']

  // 汇总：线①~⑤ 的结果 + 同步计算的 toolInventory + runtimeInputs
  const sourceHashes: FrozenSystemSourceHashes = {
    promptModules,                              // 线①
    managedAgents: managedSources.managedAgents,// 线③ → 取 managedAgents 字段
    managedTools: managedSources.managedTools,  // 线③ → 取 managedTools 字段
    soul: hashContent(contextSources.soul),                  // 线② → 取 soul 字段
    identity: hashContent(contextSources.identity),          // 线② → 取 identity 字段
    user: hashContent(contextSources.user),                  // 线② → 取 user 字段
    memorySummary: hashContent(contextSources.memorySummary),// 线② → 取 memorySummary 字段

    // 线⑥-A：工具清单 hash
    // 先排序再 stableStringify，保证同一工具集合不管传入顺序如何都产生同一 hash
    toolInventory: hashStableValue({
      toolsEnabled: request.toolsEnabled,
      tools: [...toolSummaries].sort((left, right) => left.name.localeCompare(right.name)),
    }),

    skillsIndex,  // 线④

    // 展开运算符：如果 activeSkill 不是 undefined，则展开 { activeSkill } 合并到返回对象中
    // 如果 activeSkill 是 undefined，展开 {} 不添加任何字段
    ...(activeSkill ? { activeSkill } : {}),

    // 线⑥-B：运行时输入 hash
    // 包含所有可能影响 system prompt 的运行时参数
    runtimeInputs: hashSystemPromptRuntimeInputs(request, snapshotNow),
  }

  return {
    sourceHashes,
    currentEditableSources: contextSources,
    currentRuntimeInputs,
  }
}

/** 线①：读取全部 15 个 prompt 模板文件，计算每个的 SHA256。
 *
 *  计算步骤（每个模板都一样）：
 *  对于 PROMPT_TEMPLATE_NAMES 中的每个模板名 name：
 *    1. readPromptModuleTemplate(name, workspaceDir) 读取模板
 *       → 优先从 .lecquy/system-prompt/{name}.md 读磁盘文件
 *       → 文件不存在或为空则回退到 DEFAULT_TEMPLATES[name]
 *    2. hashContent(模板内容) 计算 SHA256
 *    3. 产出键值对 [name, sha256Hash]
 *  最后 Object.fromEntries() 将 [[k1,v1],[k2,v2],...] 转为 {k1:v1, k2:v2, ...}
 *
 *  示例（缩写 hash 值）：
 *    PROMPT_TEMPLATE_NAMES = ['identity-simple', 'identity-manager', ...15个]
 *    对于 'identity-simple'：
 *      → readPromptModuleTemplate('identity-simple', '/Users/kira/.../Lecquy')
 *      → 返回 "你是运行在 Lecquy 中的个人助手，负责直接完成用户请求...\n"
 *      → hashContent("你是运行在...") → "a1b2c3d4e5f6..."
 *    ...（其余 14 个同理）
 *    最终返回：
 *    {
 *      "identity-simple":   "a1b2c3d4...",
 *      "identity-manager":  "e5f6a7b8...",
 *      "identity-worker":   "c9d0e1f2...",
 *      ...
 *    }
 *
 *  TypeScript 语法说明：
 *  - Promise.all(arr.map(async (x) => ...))：对数组中每个元素执行异步操作，并行等待全部完成
 *  - as const：告诉 TypeScript 这是一个不可变的 const 断言
 *  - Object.fromEntries([...])：将 [key,value][] 转为 {key: value}
 */
async function hashPromptModuleTemplates(workspaceDir: string): Promise<Record<string, string>> {
  // PROMPT_TEMPLATE_NAMES 是 15 个模板名的数组（已排序，来自 prompt-module-files.ts）
  // .map 为每个模板创建一个异步任务：读取 → hash → 返回 [name, hash] 键值对
  const entries = await Promise.all(
    PROMPT_TEMPLATE_NAMES.map(async (name) => [
      name,                                               // 键：模板名
      hashContent(await readPromptModuleTemplate(name, workspaceDir)),  // 值：SHA256
    ] as const),  // as const 确保 TypeScript 将类型推断为 readonly 元组
  )

  // 将 [[k1,v1],[k2,v2],...] 转为 {k1:v1, k2:v2, ...}
  return Object.fromEntries(entries)
}

/** 线②：读取 4 个可进入 update 的上下文来源。
 *
 *  计算步骤（4 个文件并行读取）：
 *    1. resolvePromptContextPaths(workspaceDir) 解析文件路径
 *       → soulFile:  .lecquy/SOUL.md
 *       → identityFile: .lecquy/IDENTITY.md
 *       → userFile: .lecquy/USER.md
 *       → memorySummaryFile: .lecquy/MEMORY.summary.md
 *    2. 并行读取 SOUL/IDENTITY/USER，MEMORY.summary 走 loadMemorySummary 的预算裁剪
 *    3. 组装返回 { soul, identity, user, memorySummary }
 *
 *  示例：
 *    假设 SOUL.md 内容为 "沉稳、直接、先给结论。\n"
 *    → readTextIfExists('.lecquy/SOUL.md') → "沉稳、直接、先给结论。\n"
 *    假设 MEMORY.summary.md 不存在
 *    → loadMemorySummary(workspaceDir) → ""
 */
async function readCurrentEditableSources(workspaceDir: string): Promise<{
  readonly soul: string
  readonly identity: string
  readonly user: string
  readonly memorySummary: string
}> {
  // 步骤1：解析文件路径
  const paths = resolvePromptContextPaths(workspaceDir)
  // 步骤2：并行读取 4 个文件
  // Promise.all + 解构赋值，4 个文件同时读，等全部完成
  const [soul, identity, user, memorySummary] = await Promise.all([
    readTextIfExists(paths.soulFile),          // .lecquy/SOUL.md
    readTextIfExists(paths.identityFile),      // .lecquy/IDENTITY.md
    readTextIfExists(paths.userFile),          // .lecquy/USER.md
    loadMemorySummary(workspaceDir),           // .lecquy/MEMORY.summary.md，有预算裁剪
  ])

  // 步骤3-4：返回当前有效内容，hash 由统一 source state helper 负责。
  return {
    soul,
    identity,
    user,
    memorySummary,
  }
}

/** 线③：hash 两段托管内容的输出。
 *
 *  不读磁盘——直接调用函数获取运行时生成的托管文本。
 *  托管内容来自 context-files.ts 中硬编码的规则：
 *  - buildManagedAgentsContent()：权限三档、manager/worker 协议、worker 上下文隔离等
 *  - buildManagedToolsContent(paths)：工作区路径、工具约定、skill 冻结契约等
 *
 *  示例：
 *    buildManagedAgentsContent()
 *    → "# Lecquy Runtime AGENTS\n\n## 工作流规则\n- simple 模式直接完成..."
 *    → hashContent("...") → "c3d4..."
 *
 *    buildManagedToolsContent(paths)
 *    → "# Lecquy Runtime TOOLS\n\n## 工作区\n- 项目根目录：/Users/kira/...\n..."
 *    → hashContent("...") → "e5f6..."
 */
async function hashManagedSources(workspaceDir: string): Promise<{
  readonly managedAgents: string
  readonly managedTools: string
}> {
  const paths = resolvePromptContextPaths(workspaceDir)
  return {
    managedAgents: hashContent(buildManagedAgentsContent()),
    // buildManagedToolsContent 需要 paths 参数，因为其中包含 workspaceDir 等动态路径
    managedTools: hashContent(buildManagedToolsContent(paths)),
  }
}

/** 线④：hash 技能索引。
 *
 *  计算步骤：
 *    1. SKILLS.listSkillSummaries(workspaceDir) 列出所有已注册 skill 的摘要
 *       → 返回 SkillSummary[]，每个包含 name/description/displayPath/source 等字段
 *    2. .map 提取每个 skill 的 4 个关键字段（忽略不需要 hash 的内部状态）
 *    3. .sort 按 name 字母排序，保证同一 skill 集合不管 listSkillSummaries 返回什么顺序
 *       都产出同一 hash
 *    4. hashStableValue() 稳定序列化 → SHA256
 *
 *  示例：
 *    listSkillSummaries 返回：
 *    [
 *      { name: 'code-review', description: '审查代码', displayPath: '...', source: 'builtin', ... },
 *      { name: 'tdd', description: '测试驱动', displayPath: '...', source: 'builtin', ... },
 *    ]
 *
 *    提取 + 排序后：
 *    [
 *      { name: 'code-review', description: '审查代码', displayPath: '...', source: 'builtin' },
 *      { name: 'tdd', description: '测试驱动', displayPath: '...', source: 'builtin' },
 *    ]
 *    → stableStringify → "{...}" → SHA256
 */
function hashSkillsIndex(workspaceDir: string): string {
  const skills = SKILLS.listSkillSummaries(workspaceDir)
    // 步骤2：只取 4 个关键字段
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      displayPath: skill.displayPath,
      source: skill.source,
    }))
    // 步骤3：按 name 排序
    // localeCompare：本地化字符串比较，比直接 >< 更可靠
    .sort((left, right) => left.name.localeCompare(right.name))

  // 步骤4：稳定序列化 → SHA256
  return hashStableValue(skills)
}

export function hashSystemPromptRuntimeInputs(
  request: Pick<BuildFrozenSystemSnapshotRequest, 'role' | 'mode' | 'route' | 'modelId' | 'thinkingLevel' | 'toolsEnabled' | 'extraInstructions'>,
  snapshotNow: string,
): string {
  return hashStableValue({
    role: request.role,
    mode: request.mode,
    channel: request.route?.channel,
    chatType: request.route?.chatType,
    peerId: request.route?.peerId,
    timeZone: request.route?.userTimezone,
    modelId: request.modelId,
    thinkingLevel: request.thinkingLevel,
    toolsEnabled: request.toolsEnabled,
    extraInstructions: request.extraInstructions,
    snapshotNow,
  })
}

/** 线⑤：hash 当前激活技能的正文。
 *
 *  技能正文来源（优先级）：
 *  1. skillSession.hasActiveSkill() 为 true → skillSession.getSlice().contentHash
 *     会话中已有冻结的技能切片，直接复用其 contentHash（不再重复计算）
 *  2. activeSkillName 不为空 → SKILLS.getSkillContent(name, dir) 读取磁盘 SKILL.md
 *     → hashContent(内容)；找不到则 hash 空串
 *  3. 都没有 → 返回 undefined（不设置 activeSkill 字段）
 *
 *  示例：
 *    技能已激活（skillSession 方式）：
 *      skillSession.hasActiveSkill() → true
 *      skillSession.getSlice().contentHash → "a1b2..."
 *      返回 "a1b2..."（不做额外 IO）
 *
 *    技能未激活但有名称：
 *      activeSkillName = 'code-review'
 *      SKILLS.getSkillContent('code-review', '/Users/kira/...') → "# Code Review Skill\n..."
 *      hashContent("# Code Review Skill\n...") → "c3d4..."
 *      返回 "c3d4..."
 *
 *    无激活技能：
 *      activeSkillName = undefined, skillSession 无活跃技能
 *      返回 undefined
 */
function hashActiveSkill(activeSkillName: string | undefined, workspaceDir: string, skillSession?: SkillSession): string | undefined {
  // 情况1：会话中已有激活的技能 → 直接复用冻结切片的 contentHash
  if (skillSession?.hasActiveSkill()) {
    return skillSession.getSlice().contentHash
  }

  // 情况2：没有 skillSession 但传了技能名 → 读磁盘文件再做 hash
  if (!activeSkillName) {
    return undefined
  }

  // 读取磁盘的 SKILL.md 内容（找不到返回空串），做 hash
  return hashContent(SKILLS.getSkillContent(activeSkillName, workspaceDir) ?? '')
}

// ============================================================
// §7 工具函数 —— 字符串稳定化、哈希、冻结
// ============================================================

/** 读取文件内容，文件不存在时返回空字符串。
 *
 *  try { ... } catch { ... } 是 JavaScript 的异常处理：
 *  - 如果 fs.readFile 成功执行，返回文件内容
 *  - 如果抛出异常（文件不存在、权限不足等），catch 块捕获异常并返回 ''
 *
 *  为什么吞掉异常？上下文文件（SOUL/USER 等）是可选的——如果某个文件不存在，
 *  系统应该继续运行而不是崩溃。返回空字符串让上游 hash 得到一个固定的"
 *  空内容 hash"，不影响快照的创建。
 *
 *  示例：
 *    readTextIfExists('.lecquy/SOUL.md')  // 文件存在 → "沉稳、直接。\n"
 *    readTextIfExists('.lecquy/MEMORY.summary.md')  // 文件不存在 → ""
 */
async function readTextIfExists(filePath: string): Promise<string> {
  try {
    // fs.readFile(path, 'utf8') 返回 Promise<string>
    return await fs.readFile(filePath, 'utf8')
  } catch {
    // 任何 IO 异常（ENOENT/EACCES 等）都降级为空串
    return ''
  }
}

/** 对任意 JS 值做稳定序列化 + SHA256。
 *
 *  这是 stableStringify + hashContent 的组合 shortcut。
 *
 *  示例：
 *    hashStableValue({ toolsEnabled: true, tools: [{name:'bash'}] })
 *    → stableStringify(...) → '{"tools":[...],"toolsEnabled":true}'
 *    → hashContent('{"tools":[...],"toolsEnabled":true}') → "a1b2..."
 */
function hashStableValue(value: unknown): string {
  return hashContent(stableStringify(value))
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

function isOptionalString(input: unknown): input is string | undefined {
  return input === undefined || typeof input === 'string'
}

function isHash(input: unknown): input is string {
  return typeof input === 'string' && HASH_PATTERN.test(input)
}

function isIsoTimestamp(input: unknown): input is string {
  if (typeof input !== 'string') {
    return false
  }

  const timestamp = Date.parse(input)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === input
}

function isHashRecord(input: unknown): input is Record<string, string> {
  if (!isRecord(input)) {
    return false
  }

  return Object.values(input).every(isHash)
}

function isTokenRecord(input: unknown): input is Record<string, number> {
  if (!isRecord(input)) {
    return false
  }

  return Object.values(input).every((value) => (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
  ))
}

function isFrozenSystemSourceHashes(input: unknown): input is FrozenSystemSourceHashes {
  if (!isRecord(input)) {
    return false
  }

  return isHashRecord(input.promptModules)
    && isHash(input.managedAgents)
    && isHash(input.managedTools)
    && isHash(input.soul)
    && isHash(input.identity)
    && isHash(input.user)
    && isHash(input.memorySummary)
    && isHash(input.toolInventory)
    && isHash(input.skillsIndex)
    && (input.activeSkill === undefined || isHash(input.activeSkill))
    && isHash(input.runtimeInputs)
}

/** ★ 稳定序列化：将任意 JS 值转为确定性的 JSON-like 字符串。
 *
 *  为什么需要这个函数？
 *  标准 JSON.stringify 有两个问题导致 hash 不稳定：
 *    问题1：对象的 key 遍历顺序取决于插入顺序
 *    问题2：undefined 值可能被省略也可能变成 null
 *    问题3：不同 JS 引擎对数字/字符串的表示可能有微小差异
 *
 *  本函数的三个保证：
 *    保证1：对象 key 按字母排序输出 → 同一组 key-value 不管插入顺序如何，字符串都一样
 *    保证2：值为 undefined 的 key 直接跳过 → 不产生 "key":undefined 或 "key":null
 *    保证3：数组按索引顺序输出，不排序 → 数组的元素顺序是有语义的
 *
 *  递归处理规则：
 *    null 或非 object → 直接用 JSON.stringify（原始值的 JSON.stringify 是稳定的）
 *    数组 → 包裹在 [] 中，每个元素递归 stableStringify，逗号连接
 *    对象 → 包裹在 {} 中，key 字母排序，每个 key-value 对递归处理，逗号连接
 *
 *  示例1：key 顺序不同但内容相同 → 输出相同
 *    stableStringify({ b: 1, a: 2 })
 *    → key 排序：["a", "b"]
 *    → "{"a":2,"b":1}"
 *
 *    stableStringify({ a: 2, b: 1 })
 *    → key 排序：["a", "b"]
 *    → "{"a":2,"b":1}"     （和上面完全一样）
 *
 *  示例2：undefined 被跳过
 *    stableStringify({ a: 1, b: undefined, c: 3 })
 *    → 过滤 b（值为 undefined）
 *    → "{"a":1,"c":3}"
 *
 *  示例3：嵌套对象
 *    stableStringify({ role: 'simple', tools: [{ name: 'bash' }, { name: 'read' }] })
 *    → "{"role":"simple","tools":[{"name":"bash"},{"name":"read"}]}"
 *
 *  示例4：数组不排序（保持原始顺序）
 *    stableStringify(['c', 'a', 'b'])
 *    → "["c","a","b"]"
 *    （如果数组也需要排序，调用方应在传入前自己 sort）
 *
 *  TypeScript 语法说明：
 *  - typeof value !== 'object'：typeof null === 'object' 是 JS 的历史 bug，
 *    所以需要 value === null 单独判断
 *  - Object.keys(record)：返回对象所有自身可枚举属性的 key 数组
 *  - .filter(callback)：保留 callback 返回 true 的元素
 *  - .map(callback)：对每个元素调用 callback，返回新数组
 *  - .join(','): 用逗号连接数组所有元素为字符串
 */
function stableStringify(value: unknown): string {
  // 原始值（null、string、number、boolean）直接用 JSON.stringify 即可
  // 注意：typeof null === 'object' 是 JS 的历史设计缺陷，必须先判 null
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  // 数组：保持索引顺序（不排序），每个元素递归处理
  if (Array.isArray(value)) {
    // value.map(item => stableStringify(item)) 递归处理每个元素
    // .join(',') 用逗号连接
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  // 对象（Record）：key 排序 + 过滤 undefined
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)      // 取出所有 key，如 ['role','mode','timeZone']
    .sort()                                 // 按字母排序：['mode','role','timeZone']
    .filter((key) => record[key] !== undefined)  // 过滤值为 undefined 的 key
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    // 每项变为 '"key":序列化后的值'，如 '"mode":"simple"'

  // 用花括号包裹，逗号连接
  return `{${entries.join(',')}}`
}

/** 深度冻结快照对象及其嵌套对象。
 *
 *  JavaScript 的 Object.freeze() 让对象变为不可变：
 *  - 不能添加新属性
 *  - 不能删除已有属性
 *  - 不能修改已有属性的值
 *  - 不能修改属性的可枚举性/可配置性/可写性
 *  - 在严格模式（TypeScript 默认）下，任何修改尝试都会抛出 TypeError
 *
 *  但 Object.freeze 是浅冻结——它只冻结对象自身，不冻结嵌套对象。
 *  所以这里需要逐层冻结：
 *    1. 先冻结最内层的 promptModules（Record<string,string>）
 *    2. 冻结 sourceHashes（包含 promptModules）
 *    3. 冻结 sliceHashes 和 sliceTokens
 *    4. 最后冻结外层的 snapshot
 *
 *  顺序：先内后外。因为冻结后就不能再改属性值了，
 *  如果先冻结外层，内层对象还没被 freeze 的话理论上仍可被修改。
 *
 *  TypeScript 语法说明：
 *  - Object.freeze() 的返回值类型为 Readonly<T>，与 readonly 修饰符语义一致
 */
function deepFreezeSnapshot(snapshot: FrozenSystemSnapshot): FrozenSystemSnapshot {
  // 最内层：promptModules 的 15 个 key-value 对
  Object.freeze(snapshot.sourceHashes.promptModules)
  // 中层：sourceHashes 对象本身
  Object.freeze(snapshot.sourceHashes)
  // 同层：sliceHashes 和 sliceTokens
  Object.freeze(snapshot.sliceHashes)
  Object.freeze(snapshot.sliceTokens)
  // 最外层：snapshot 对象本身
  return Object.freeze(snapshot)
}
