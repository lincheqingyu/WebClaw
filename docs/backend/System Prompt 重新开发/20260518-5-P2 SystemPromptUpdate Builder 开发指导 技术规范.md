# P2 SystemPromptUpdate Builder 开发指导

> 更新日期：2026-05-18
> 类型：技术规范
> 前置：[P1 FrozenSystemSnapshot 代码审查](./20260518-4-P1%20FrozenSystemSnapshot%20代码审查%20报告.md)

## 1. P2 目标

P2 实现 `<system_prompt_update>`：在不改写 `FrozenSystemSnapshot.systemText` 的前提下，让 snapshot 创建后发生的可变信息在下一次模型请求中即时生效。

完成后必须满足：

- 同一 snapshot 生命周期内 `systemText` 字节不变。
- 当前请求前如存在变化，插入一个 synthetic user/context message。
- update 是 `cumulative since snapshot`，不是相对上一轮的 delta。
- 未变化时不生成 update。
- 未变化字段不输出 `none` / `null` / 空占位。
- update 不进入用户可见 transcript。
- update 不使用 tool role，不覆盖 safety / tool permission / BASE / TOOLS / AGENTS。

## 2. 非目标

- 不做 compact / resnapshot。
- 不迁移 `.lecquy/system-prompt/`。
- 不重写 provider adapter。
- 不把 MemoryRecall tag 从 `<LAYER:memory_recall>` 改成 `<retrieved_memory>`；这个留给 P3。
- 不做真正 old/new 文本 diff，除非先扩展 snapshot 存 baseline 内容。

## 3. 数据契约

建议新增文件：

- `backend/src/core/prompts/system-prompt-update.ts`

最小类型：

```ts
export interface SystemPromptUpdate {
  readonly sessionId: string
  readonly baseSnapshotId: string
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly generatedAt: string
  readonly sourceHashBefore: FrozenSystemSourceHashes
  readonly sourceHashNow: FrozenSystemSourceHashes
  readonly changes: SystemPromptUpdateChanges
  readonly serializedText: string
  readonly contentHash: string
}

export interface SystemPromptUpdateChanges {
  readonly currentDate?: {
    readonly snapshotDate: string
    readonly currentDate: string
    readonly timeZone: string
  }
  readonly runtime?: {
    readonly mode?: SessionMode
    readonly modelId?: string
    readonly thinkingLevel?: string
    readonly toolsEnabled?: boolean
    readonly extraInstructions?: string
    readonly phase?: 'normal' | 'plan_final_answer' | 'manager' | 'worker'
  }
  readonly editableContext?: ReadonlyArray<{
    readonly path: 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.summary.md'
    readonly currentSummary: string
  }>
  readonly activeSkill?: {
    readonly name: string
    readonly currentSummary: string
  }
  readonly blockedSourceChanges?: ReadonlyArray<{
    readonly source: 'promptModules' | 'managedAgents' | 'managedTools' | 'toolInventory' | 'skillsIndex'
    readonly reason: string
  }>
}
```

说明：

- `sourceHashBefore` 直接来自 `FrozenSystemSnapshot.sourceHashes`。
- `sourceHashNow` 由 P2 用和 P1 相同的 source hash helper 重新计算。
- `editableContext[].currentSummary` 是当前有效内容摘要，不是 old/new diff。
- `blockedSourceChanges` 只用于日志和 update 中的低风险提示，不允许改写工具权限或 safety。

## 4. Source Hash 复用

P2 不应复制 P1 的 hash 逻辑。需要从 `system-prompt-snapshot.ts` 抽出可复用 helper：

```ts
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

export async function collectCurrentSystemPromptSourceState(
  request: BuildFrozenSystemSnapshotRequest,
  now: Date,
): Promise<CurrentSystemPromptSourceState>
```

P1 的 `buildFrozenSystemSnapshot` 也应调用这个 helper，避免 P1/P2 对同一来源算出不同 hash。

## 5. Update Builder API

建议 API：

```ts
export interface BuildSystemPromptUpdateRequest {
  readonly snapshot: FrozenSystemSnapshot
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly workspaceDir: string
  readonly route?: SessionRouteContext
  readonly modelId: string
  readonly thinkingLevel?: string
  readonly tools: ReadonlyArray<AgentTool<any>>
  readonly toolsEnabled: boolean
  readonly extraInstructions?: string
  readonly activeSkillName?: string
  readonly skillSession?: SkillSession
  readonly phase?: 'normal' | 'plan_final_answer' | 'manager' | 'worker'
  readonly now?: Date
}

export async function buildSystemPromptUpdate(
  request: BuildSystemPromptUpdateRequest,
): Promise<SystemPromptUpdate | null>
```

返回规则：

- 没有任何变化时返回 `null`。
- 有变化时返回完整 `SystemPromptUpdate`。
- `serializedText` 已包含 `<system_prompt_update>` wrapper，可直接放进 synthetic user message。

## 6. 变化分类

### 6.1 Date / Timezone

从 snapshot 的 `createdAt + timeZone` 算 snapshot local date，再从 `now + current timeZone` 算 current local date。

只有 local date 或 timeZone 变化时输出：

```text
Current date: 2026-05-18
Time zone: Asia/Shanghai
```

不需要每分钟输出 current time；分钟级变化会导致 update 每轮变化，破坏稳定性收益。

### 6.2 Runtime Delta

这些字段从 current request 与 snapshot 对比：

- `mode`
- `modelId`
- `thinkingLevel`
- `toolsEnabled`
- `extraInstructions`
- `phase`

输出示例：

```text
Runtime updates since snapshot:
- Current mode: plan
- Tools enabled: false
- Current phase: plan_final_answer
- Additional runtime instruction: 你正在完成 plan 工作流的最终答复阶段...
```

注意：

- `extraInstructions` 只能作为低优先级运行时补充，不得允许它覆盖 safety、tool permission 或 AGENTS/TOOLS。
- 这项必须覆盖 P1 审查发现的 plan final answer 场景。

### 6.3 Editable Context

允许进入 update 的文件：

- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `MEMORY.summary.md`

如果当前 hash 与 snapshot hash 不同，则读取当前内容并生成 current summary。

摘要策略：

- `USER.md` 优先复用 `parseUserMd`，输出当前 profile / preference 的有效摘要。
- `MEMORY.summary.md` 复用 `loadMemorySummary` 的预算裁剪结果。
- `SOUL.md` / `IDENTITY.md` 用确定性裁剪，不调用 LLM。
- 超预算时保留标题和前部有效内容，并加 `...` 截断标记。

输出示例：

```text
Changed stable context since snapshot:
- USER.md current effective content:
  Profile: kira 正在开发 Lecquy...
  Preference: 偏好 SQLite over PostgreSQL...
- MEMORY.summary.md current effective content:
  ...
```

这不是 old/new diff。它表达的是“相对 snapshot 已变化，当前有效内容如下”，仍满足 cumulative since snapshot。

### 6.4 Active Skill

如果 active skill hash 与 snapshot 不同：

- 如果当前有 active skill，输出 skill 名称和当前摘要。
- 如果当前无 active skill，但 snapshot 有 active skill，输出 active skill cleared。

不要在 update 中塞完整 `SKILL.md`。完整 skill runtime 仍属于 snapshot / resnapshot 责任，P2 只提醒当前状态。

### 6.5 Blocked Source Changes

这些变化不直接进入行为覆盖：

- prompt module templates
- managed AGENTS
- managed TOOLS
- tool inventory
- skills index

如果 hash 变化，update 只能输出：

```text
Source changes detected but not applied through update:
- toolInventory changed; existing snapshot tool policy remains authoritative until resnapshot.
```

原因：

- update 不允许覆盖 tools/safety/AGENTS。
- 工具真实可用性由模型请求里的 tools 参数控制，不靠 prompt update 改白名单。
- 这些变化应在 P4 compact / resnapshot 中吸收。

## 7. 序列化格式

固定格式：

```text
<system_prompt_update priority="high" source="lecquy" base_snapshot_id="..." generated_at="...">
Current date: 2026-05-18
Time zone: Asia/Shanghai

Runtime updates since snapshot:
- Current mode: plan
- Tools enabled: false
- Current phase: plan_final_answer

Changed stable context since snapshot:
- USER.md current effective content:
  Profile: ...
  Preference: ...

Source changes detected but not applied through update:
- toolInventory changed; existing snapshot tool policy remains authoritative until resnapshot.
</system_prompt_update>
```

序列化要求：

- section 顺序固定：date/timezone → runtime → editable context → active skill → blocked source changes。
- 空 section 省略。
- 空字段省略。
- 不输出 `none` / `null`。
- XML attribute 需要转义 `&` 和 `"`。
- `contentHash = hashContent(serializedText)`。

## 8. Runtime 接入

当前 `buildContextMessages` 在 `executeRun` 中早于 `buildRunSystemPrompt` 调用；P2 需要调整顺序，否则 update builder 拿不到 snapshot。

推荐改造：

1. 保留历史上下文构造：

```ts
const baseContextMessages = await this.buildBaseContextMessages(...)
```

2. 在每个模型调用前先确保 snapshot：

```ts
const snapshot = await this.ensureFrozenSystemSnapshot(promptRequest)
const update = await buildSystemPromptUpdate({ snapshot, ...currentPromptRequest, phase })
```

3. 组装最终 context：

```text
history / compaction context
memory recall synthetic message
system prompt update synthetic message
current user message
```

简单模式 / manager：

- `runSimpleAgent` 和 `runManagerAgent` 的 `contextMessages` 末尾追加 update message。

worker：

- 给 `WorkerRunOptions` 增加 `runtimeContextMessages?: AgentMessage[]`，或把现有 `memoryRecall` 泛化为 `preUserContextMessages`。
- 顺序必须是 update 在 `todoSnapshot` 前。

plan final answer：

- phase 设置为 `plan_final_answer`。
- `extraInstructions` 中的 final-answer directive 必须出现在 update。
- 这是 P2 必测场景。

## 9. Synthetic Message

新增 helper：

```ts
export function createSystemPromptUpdateMessage(update: SystemPromptUpdate): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: update.serializedText }],
    timestamp: 0,
  }
}
```

禁止：

- 不用 `tool` role。
- 不用 `appendCustomMessageEntry` 存 update。
- 不把 update 拼进用户当前输入文本。
- 不把 update 写成 `SessionMessageRecord`。

如需审计记录，使用：

```ts
manager.appendCustomEntry('system_prompt_update', {
  baseSnapshotId: update.baseSnapshotId,
  contentHash: update.contentHash,
  changes: update.changes,
})
```

`custom` entry 不参与 `buildSessionContext`；`custom_message` 会参与，不能用。

## 10. 测试要求

新增：

- `backend/src/core/prompts/__tests__/system-prompt-update.test.ts`
- `backend/src/runtime/__tests__/system-prompt-update-runtime.test.ts`

必须覆盖：

1. 无变化时 `buildSystemPromptUpdate` 返回 `null`。
2. 修改 `USER.md` 后，`systemText` 不变，update 出现 `USER.md current effective content`。
3. 同一 snapshot 下 USER 先新增 X 再新增 Y，最新 update 展示当前 X + Y。
4. 同一 snapshot 下 USER 新增 X 后删除 X，最新 update 不再展示 X。
5. 跨日后 update 输出 current date，system 不变。
6. `mode/toolsEnabled/extraInstructions/phase` 变化输出 runtime update。
7. plan final answer 阶段复用 simple snapshot，但 update 包含 final-answer directive。
8. prompt module / tool inventory 变化只进入 blocked source changes，不覆盖工具权限。
9. update message 位于 current user message 前，且不进入 visible transcript。
10. 不输出 `none` / `null`。
11. corrupt snapshot restore 被忽略或重建，不参与 update。

## 11. 验收标准

P2 完成后：

- P1 snapshot 仍然稳定。
- update 能表达当前 runtime delta 和可编辑上下文变化。
- plan final answer 不再依赖重写 system 注入阶段指令。
- 用户可见 transcript 仍然干净。
- API request logger 能看到 update message 位于当前用户消息前。
- 测试覆盖 cumulative since snapshot，而不是 delta-since-previous。

P2 完成后再进入 P3：显式拆分 visible transcript / API replay transcript / augmentation 记录，并统一 MemoryRecall tag 与位置。
