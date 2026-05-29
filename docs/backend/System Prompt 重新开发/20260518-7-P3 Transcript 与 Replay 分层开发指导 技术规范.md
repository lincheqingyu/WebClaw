# P3 Transcript 与 Replay 分层开发指导

> 更新日期：2026-05-18
> 类型：技术规范
> 前置：[P2 SystemPromptUpdate 代码审查](./20260518-6-P2%20SystemPromptUpdate%20代码审查%20报告.md)

## 1. P3 目标

P3 的目标是把“用户看见的对话历史”和“模型实际收到的 replay messages”彻底分开，并给所有 synthetic context 建立可审计、可重放的 augmentation 记录。

完成后必须满足：

- 用户可见 transcript 只包含 kira 真实输入与 assistant 可见输出。
- `<retrieved_memory>`、`<system_prompt_update>` 等 synthetic context 不显示、不导出为用户真实消息。
- API replay transcript 能还原模型请求的语义完整顺序。
- runtime augmentation 记录能解释每轮注入来源、内容 hash、插入位置和所属 run。
- MemoryRecall 不再使用 `<LAYER:memory_recall>`，统一迁移到 `<retrieved_memory priority="low">`。
- `custom_message display=false` 不作为隐藏 prompt 注入手段。

## 2. 非目标

- 不做 compact / resnapshot 语义吸收；这是 P4。
- 不做 provider adapter / Anthropic `cache_control` 翻译；这是 P5。
- 不重写 memory extraction / memory.db schema。
- 不改变 `FrozenSystemSnapshot` 与 `SystemPromptUpdate` 的核心语义。
- 不做前端 UI 改版；只保证 UI 不展示 runtime augmentation。

## 3. 当前代码事实

P2 之后，相关事实如下：

- `systemText` 已由 `FrozenSystemSnapshot` 冻结。
- `<system_prompt_update>` 已作为 synthetic user message 追加到模型请求的 current user 前。
- update 审计使用 `appendCustomEntry('system_prompt_update', ...)`，没有写入 `custom_message`。
- `SessionManager.buildSessionContext` 仍会把所有 `custom_message` 放回 context，即使 `display=false`。
- layered `buildContextMessages` 当前顺序仍是 `memory recall → session context`，P3 需要改成 `session context → memory recall → update`。
- MemoryRecall 当前 tag 仍是 `<LAYER:memory_recall>`。

## 4. 三条数据线

P3 必须显式建立三条数据线，不再靠“某个 AgentMessage 数组刚好不显示”维持边界。

### 4.1 Visible Transcript

用户可见 transcript 只服务 UI、导出、用户历史浏览。

包含：

- kira 真实 user message。
- assistant 可见回复。
- 用户需要看到的 tool / artifact / approval 事件摘要。

不包含：

- `<retrieved_memory>`。
- `<system_prompt_update>`。
- hidden attachment summary。
- runtime diagnostic。
- provider payload。

### 4.2 API Replay Transcript

API replay transcript 服务模型请求重放和调试。

包含：

- frozen `systemText` 或其 snapshot id + content hash。
- compaction summary / kept history。
- visible transcript 中会参与模型上下文的 user / assistant / toolResult。
- runtime augmentations 按插入锚点展开后的 synthetic user messages。

要求：

- 顺序稳定。
- 可从 session event tree 重建。
- 不把 synthetic context 误标成 kira 真实发言。
- compact 后仍能解释“摘要前后哪些 augmentation 被保留 / 丢弃”。

### 4.3 Runtime Augmentation

runtime augmentation 是本轮运行临时注入的 synthetic context 记录。

最小类型建议：

```ts
export type RuntimeAugmentationKind =
  | 'retrieved_memory'
  | 'system_prompt_update'
  | 'attachment_context'
  | 'compact_context'

export interface RuntimeAugmentationEntryData {
  readonly kind: 'runtime_augmentation'
  readonly augmentationKind: RuntimeAugmentationKind
  readonly sessionId: string
  readonly runId: string
  readonly stepId?: string
  readonly targetMessageId: string
  readonly insertBefore: 'current_user'
  readonly ordinal: number
  readonly role: 'user'
  readonly content: string
  readonly contentHash: string
  readonly source?: {
    readonly snapshotId?: string
    readonly snapshotHash?: string
    readonly sourceHashBefore?: unknown
    readonly sourceHashNow?: unknown
  }
  readonly visible: false
  readonly createdAt: string
}
```

说明：

- `content` 保存实际渲染后的 synthetic message 文本。只保存 `changes` 或 hash 不够。
- `targetMessageId` 指向本轮真实 user message。
- `ordinal` 决定同一 user message 前多个 augmentation 的稳定顺序。
- `visible` 固定为 `false`，但 UI 是否展示不能靠这个字段兜底；UI projection 应直接忽略该 custom type。

## 5. Prompt Frame 组装顺序

P3 后统一用 prompt frame 描述一次模型请求：

```ts
export interface RuntimePromptFrame {
  readonly systemPrompt: string
  readonly systemSnapshotId?: string
  readonly systemPromptHash: string
  readonly visibleMessages: readonly AgentMessage[]
  readonly replayMessages: readonly AgentMessage[]
  readonly augmentations: readonly RuntimeAugmentationEntryData[]
}
```

组装顺序固定：

```text
system: FrozenSystemSnapshot.systemText

messages:
1. compaction summary（如果存在）
2. kept history / recent tail
3. <retrieved_memory priority="low">...</retrieved_memory>
4. <system_prompt_update priority="high" source="lecquy">...</system_prompt_update>
5. current user message
```

worker 路径：

```text
system: worker FrozenSystemSnapshot.systemText

messages:
1. worker memory recall（如果存在）
2. worker system_prompt_update（如果存在）
3. todoSnapshot user message
```

注意：

- update 必须紧贴当前 user / todoSnapshot 之前。
- memory recall 必须在 update 之前，因为 update 是更高优先级的当前运行态修正。
- history 必须在 memory recall 之前，避免旧历史被 recall 片段隔开。

## 6. 实现切分

### P3.0 小修：timezone 补入回归

先修 P2 审查 Finding 1：

- snapshot 无 timezone、当前请求有 timezone 时必须输出 date/timezone update。
- 增加单测覆盖同一天补入 timezone 的场景。

这个修复很小，但能避免 P3 replay frame 固化错误行为。

### P3.1 新增 runtime augmentation 类型与 helper

建议新增：

- `backend/src/runtime/context/runtime-augmentation.ts`
- `backend/src/runtime/context/prompt-frame-builder.ts`

职责：

- 创建 `RuntimeAugmentationEntryData`。
- 把 augmentation entry 转成 `AgentMessage`。
- 按 `targetMessageId + ordinal` 展开 replay messages。
- 计算 `contentHash = hashContent(content)`。

### P3.2 改造 current run prompt frame

`SessionRuntimeService.executeRun` 当前先构造 `contextBeforeInput`，再 append user message，随后在 runner 内部构造 update。P3 应把“本轮 prompt frame”提升为显式对象：

1. 创建真实 user message 并拿到 message entry id。
2. 构建 visible history context。
3. 构建 memory recall augmentation。
4. 确保 snapshot 并构建 system prompt update augmentation。
5. 用统一 helper 产出 `RuntimePromptFrame`。
6. 把 `frame.replayMessages` 传给 simple / manager / worker。
7. 把 `frame.augmentations` 写入 custom entry。

不要用 `custom_message` 承载 hidden context。

### P3.3 更新 MemoryRecall

`backend/src/memory/prompt-injector.ts` 需要把：

```text
<LAYER:memory_recall>
...
</LAYER>
```

迁移为：

```text
<retrieved_memory priority="low" source="lecquy">
...
</retrieved_memory>
```

同时更新相关测试：

- `backend/src/memory/__tests__/prompt-injector.test.ts`
- prompt serializer 中拒绝 memory recall system layer 的测试保持有效，但断言应对齐新 tag。

### P3.4 持久化 replay 所需信息

当前 `system_prompt_update` custom entry 只保存 `changes` 和 hash。P3 应改为统一 runtime augmentation entry，至少保存：

- rendered `content`
- `contentHash`
- `targetMessageId`
- `runId`
- `ordinal`
- `augmentationKind`
- snapshot id / hash（如果有）

如果未来内容过大，可以保存 `contentRef` 指向 `.lecquy/artifacts` 或日志文件，但 P3 不需要提前复杂化；当前 update / memory recall 都应直接内联。

### P3.5 AI request logger 对齐

`logAiRequestSnapshot` 可以继续写完整 payload，但应补充 frame 元信息：

- `systemSnapshotId`
- `systemPromptHash`
- augmentation kind / hash / targetMessageId
- replay message count

日志是调试辅助，不是唯一事实源。session event tree 仍要能解释 replay。

## 7. 测试要求

新增或更新测试必须覆盖：

1. 用户可见 transcript 不包含 `<retrieved_memory>` 或 `<system_prompt_update>`。
2. API replay frame 顺序为 history → retrieved memory → system prompt update → current user。
3. runtime augmentation custom entry 包含 `content`、`contentHash`、`targetMessageId`、`runId`、`ordinal`。
4. 重启 / 清空内存 cache 后，能从 session event tree 重建同一轮 replay transcript。
5. plan final answer replay 中包含 `phase=plan_final_answer` update，且 visible transcript 只看到最终 assistant 回复。
6. worker replay 中 update 位于 `todoSnapshot` 前。
7. `custom_message display=false` 不被新路径用于隐藏 runtime context。
8. MemoryRecall 使用 `<retrieved_memory priority="low">`，不再出现 `<LAYER:memory_recall>`。
9. compact 后的 visible transcript 仍干净，API replay 至少能解释 compact 后保留区间内的 augmentation。

## 8. 验收标准

P3 完成后：

- `buildContextMessages` 不再把 memory recall 放在 history 前。
- hidden synthetic context 全部通过 runtime augmentation 建模。
- 用户历史、API replay、augmentation 三者边界清楚。
- P2 update 的审计记录升级为可重放记录。
- MemoryRecall tag 对齐 20260513-7。
- P4 可以在此基础上实现 compact / resnapshot：把 update 吸收到新 snapshot，并按规则丢弃旧 augmentation。

## 9. 明确禁止

- 不把 `<retrieved_memory>` 拼进用户当前输入文本。
- 不把 `<system_prompt_update>` 写成 `SessionMessageRecord`。
- 不用 `custom_message display=false` 冒充 hidden context。
- 不在 compact 摘要里写成“kira 说过 retrieved memory 内容”。
- 不让 update 覆盖 BASE / TOOLS / AGENTS / safety / tool permission。
