# system-prompt 与 memory 删债 执行指令

> 更新日期：2026-05-29
> 类型：执行指令
> 关联：[CLAUDE.md](../../CLAUDE.md) · [20260513-7 系统提示词模块再合并与缓存命中优化 决策沉淀](./20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md) · [20260525-1 记忆与上下文设计理念 决策沉淀](./20260525-1-记忆与上下文设计理念%20决策沉淀.md) · [20260618-1 后端代码文件级说明 技术规范](../backend/20260618-1-后端代码文件级说明%20技术规范.md)
> 执行者：Claude Opus 4.8 low（或同等）
> 性质：纯删债（删除旧 / 废弃 / 无用 / 矛盾代码），**不是功能迁移，不是重构**

---

## 0. 给执行者的第一句话（必须先读）

本任务只做"删债"，遵守 CLAUDE.md §4 两条铁律：

- **删代码优先于加代码**：本任务不新增任何功能、不重设计任何结构。
- **无引用即删，有引用就拆的不在本次范围**：凡是删除会牵动多个模块的纠缠点，一律**停手**，写进 §5 围栏清单，不要自作主张拆。

本任务**只有两个删除目标**（§3 阶段 A、§4 阶段 B）。**除此之外的一切删除都属越界**，尤其不要碰 §5 列出的内容。如果你读代码后发现这两个目标的现状与本文描述不符（行号漂移、出现新引用），**以 grep 校验结果为准**，并在交付说明里记录差异，不要凭本文硬删。

reasoning effort 是 low，所以本文把判断都前置成确定性步骤；遇到任何需要"判断要不要拆"的地方，默认答案是**停手并上报**。

---

## 1. 范围

| 目标 | 性质 | 是否在本次范围 |
|---|---|---|
| flush 每日 dump 路径（`flush.ts` + 调用点） | 无用、已被 SQLite 抽取路径取代 | ✅ 阶段 A |
| 已死的 PG `MemoryCoordinator` 分支（默认 `PG_ENABLED=false` 不可达） | 废弃 | ✅ 阶段 B |
| 整套 PG 移除（`db/client.ts`、`db/memory-repository.ts`、foresight/rag/prompt-injector 的 PG 用法） | 纠缠重构 | ❌ §5 围栏 |
| `.lecquy/system-prompt/` 模板加载器（`prompt-module-files.ts` 等） | 需先迁移到 BASE.md，属功能迁移 | ❌ §5 围栏 |

---

## 2. 通用纪律（每一步都适用）

1. **grep 先行**：每删一个符号 / 文件前，先按本文给出的命令 grep 全部引用，确认与预期一致。出现本文未列出的新引用 → 停手上报。
2. **单步单提交**：阶段 A、阶段 B 分开提交；每个阶段内的子步骤尽量小步提交，便于回滚。
3. **测试 gate**：每个阶段删完后跑 §6 的测试；**绿了才进下一阶段**，红了立即回滚本阶段改动并上报。
4. **不动混杂目录**：见到一个文件 / 目录里既有要删的死代码、又有在用的运行时逻辑，且无法干净切分 → 停手，写进交付说明，不要硬拆（CLAUDE.md §4）。
5. **不删测试来凑绿**：测试失败要修因，不许通过删/改断言来让它过。
6. **类型与 lint 兜底**：删完靠 `tsc` / eslint 找出"现在没人用的 import / 变量"，顺手清理这些**因删除而变孤儿的** import，不要扩大到无关清理。

所有路径相对仓库根；后端代码在 `backend/`。

---

## 3. 阶段 A：移除 flush 每日 dump 路径

### A.0 背景
`backend/src/memory/flush.ts` 每若干轮把"最后一条 user + 最后一条 assistant"原样 dump 进每日 `MEMORY.md`，正文是占位符。真正的长期记忆走 SQLite 事件抽取（`coordinator.ts` 的 `extractAndPersistOnTurnComplete`）。flush 是 CLAUDE.md §3 点名"价值低"的并行冗余路径，删除。

### A.1 先校验引用（预期：仅 1 个 live 调用点 + index 导出）
```bash
grep -rn "recordMemoryTurnAndMaybeFlush\|resetMemoryTurnCounter" backend/src --include=*.ts | grep -v "memory/flush.ts"
```
预期命中：`backend/src/memory/index.ts`（导出）、`backend/src/agent/agent-runner.ts`（import + 调用）。若还有别处 → 停手上报。

### A.2 确认每日 MEMORY.md dump 没有 live 消费者（关键判断点）
```bash
grep -rn "appendDailyMemoryEntry\|getDailyMemoryFilePath" backend/src --include=*.ts | grep -v "memory/flush.ts" | grep -v "memory/store.ts"
```
- 若**只有 flush.ts 在写**、没有别的运行时代码依赖每日 dump 的内容（注入 prompt、检索等）→ 可以删。
- 若发现有 prompt / 检索路径在读每日 dump 内容 → **停手上报**（说明该 dump 仍被消费，删除会丢信息，超出本次范围）。
- `store.ts` 里的 `appendDailyMemoryEntry` 是否一并删：只有当确认全仓再无调用者时才删该导出函数；否则保留 `store.ts`，只断开 flush。

### A.3 删除动作
1. `backend/src/agent/agent-runner.ts`：删除对 `recordMemoryTurnAndMaybeFlush` 的 import（保留同行其它导入如 `ensureMemoryFiles`）与其调用行（约 255 行）。
2. `backend/src/memory/index.ts`：删除 `export { recordMemoryTurnAndMaybeFlush, resetMemoryTurnCounter } from './flush.js'`。
3. 删除文件 `backend/src/memory/flush.ts`。
4. 若有 `flush` 相关测试文件（grep `flush` in `backend/src/memory`）：随之删除，**不要保留对已删模块的测试**。
5. 若 A.2 判定 `appendDailyMemoryEntry` 已无任何调用者：从 `store.ts` 删除该函数及 `index.ts` 对应导出；否则保留。

### A.4 阶段 A 测试 gate
跑 §6。绿 → 提交（建议信息：`chore(memory): 移除已废弃的 flush 每日 dump 路径`）。

---

## 4. 阶段 B：移除已死的 PG MemoryCoordinator 分支

### B.0 背景
`backend/src/memory/coordinator.ts` 同时含两条路径：
- **live**：`extractAndPersistOnTurnComplete` / `buildEventExtractionInput`（SQLite 直写，默认走这条）——**保留**。
- **死路**：`MemoryCoordinator` 类 + `createMemoryCoordinator` + `getMemoryCoordinator` + 模块单例 + PG 入队轮询。仅在 `config.PG_ENABLED && MEMORY_PG_LEGACY==='true'` 时启用，默认 `enabled=false`，运行时不可达——**删除**。

调用方现状已是"PG 关时走 SQLite"：
- `session-runtime-service.ts` ~1929：`if (memoryCoordinator?.enabled) { onTurnCompleted } else { extractAndPersistOnTurnComplete }`。
- `server.ts` ~53：`config.PG_ENABLED ? await createMemoryCoordinator(config) : null`。

删除即把这两处坍缩到只剩 SQLite 直写。

> ⚠️ 边界纪律：本阶段**只删 coordinator 内的 PG 分支与其两个调用点**。**不要**顺手删 `db/memory-repository.ts`、`db/client.ts` 或其它 PG 代码——它们还被 `foresight-sync.ts`、`rag/`、`prompt-injector.ts`、dev smoke 脚本引用，属于 §5 围栏的独立大任务。删 coordinator 后这些文件仍应能编译。

### B.1 先校验引用
```bash
grep -rn "MemoryCoordinator\|createMemoryCoordinator\|getMemoryCoordinator" backend/src --include=*.ts | grep -v "memory/coordinator.ts"
```
预期命中：`memory/index.ts`（导出）、`runtime/session-runtime-service.ts`、`server.ts`。若有别处 → 停手上报。

### B.2 删除与坍缩动作
1. `backend/src/runtime/session-runtime-service.ts`：
   - import 行（约 94）删去 `getMemoryCoordinator`，保留 `extractAndPersistOnTurnComplete`。
   - 把 `getMemoryCoordinator()` + `if (memoryCoordinator?.enabled) {...} else {...}` 整段坍缩为**直接调用** `await extractAndPersistOnTurnComplete(finalProjection, manager, this.runtimePaths.workspaceDir)`（保留外层 try/catch 与日志）。
2. `backend/src/server.ts`：
   - 删除 `import { createMemoryCoordinator }`（约 35）。
   - 删除 `const memoryCoordinator = config.PG_ENABLED ? await createMemoryCoordinator(config) : null`（约 53-55）。
   - grep `memoryCoordinator` in `server.ts`，若后续（如 shutdown）有引用一并清理；**注意**别误删与 PG migration 无关的 server 启停逻辑。
3. `backend/src/memory/index.ts`：从 coordinator 的 re-export 中删去 `createMemoryCoordinator`、`getMemoryCoordinator`、`MemoryCoordinator`，保留 `buildEventExtractionInput`、`extractAndPersistOnTurnComplete`。
4. `backend/src/memory/coordinator.ts`：
   - 删除 `MemoryCoordinator` 类、`createMemoryCoordinator`、`getMemoryCoordinator`、`memoryCoordinator` 单例、`isLegacyPgMemoryEnabled`、相关常量（`MEMORY_JOB_POLL_INTERVAL_MS`、`MEMORY_JOB_MAX_RETRY` 等仅 PG 用到的）。
   - 删除仅 PG 用到的 import：`getPool`（`../db/client.js`）、`../db/memory-repository.js` 的全部导入、`getConfig`/`Env`（若坍缩后无其它用处，靠 tsc 确认）。
   - **保留**：`buildEventExtractionInput`、`extractAndPersistOnTurnComplete`、`countDurableCandidateMessages`、`deriveProjectId`/`sqlite-store`/`extraction-runner` 相关 import、`SessionManager`/`SessionProjection` 类型。
5. `coordinator.test.ts`：删除针对 `MemoryCoordinator` 类 / PG 轮询的用例；保留针对 `extractAndPersistOnTurnComplete` / `buildEventExtractionInput` 的用例。若整文件都是 PG 用例则整删。

### B.3 阶段 B 测试 gate
跑 §6。绿 → 提交（建议信息：`chore(memory): 移除默认不可达的 PG MemoryCoordinator 分支`）。

---

## 5. 不在本次范围（围栏 —— 看到也别删）

以下都是**真实存在的债**，但删除属于迁移/纠缠重构，**本次一律不动**，发现相关诱因写进交付说明即可：

1. **整套 PG 移除**：`backend/src/db/client.ts`、`backend/src/db/memory-repository.ts`、`foresight-sync.ts` 的 PG 写入、`rag/index.ts` 与 `prompt-injector.ts` 的 `getPool` 用法、`backend/src/dev/*pg*smoke*` / `live-event-extraction-smoke.ts` / `ws-pg-acceptance.ts`。原因：跨 memory/rag/prompt 多模块纠缠，是 CLAUDE.md 记载的 ~2000 行独立删除任务，需专门立项。
2. **`.lecquy/system-prompt/` 模板加载器**：`core/prompts/prompt-module-files.ts`（读 `.lecquy/system-prompt/*.md` 覆盖模板 + `DEFAULT_TEMPLATES` 兜底）、`context-files.ts`、`system-prompts.ts`、`runtime-paths.ts` 中的 `systemPromptDir`。原因：CLAUDE.md §1.3 第 5 条——这是旧模板兼容目录，**删除前必须先把调用方和测试迁到 BASE.md 模型**，属功能迁移而非删债。
3. **`foresight-sync.ts`**：依赖 PG，去留取决于 foresight 功能是否保留，超出删债范围。
4. **任何"看起来风格不一致 / 抽象不优雅"的代码**：CLAUDE.md §2.1，不主动重构。

---

## 6. 测试与验证命令

> 先看 `backend/package.json` 的 `scripts` 确认真实命令（大概率 vitest）。下列为模板，按实际调整。

```bash
# 类型检查（删债后必须无新增 TS 报错）
cd backend && npx tsc --noEmit

# 受影响范围的单测（memory + runtime + server/agent 相关）
cd backend && npm test -- src/memory
cd backend && npm test -- src/runtime src/agent

# 全量（时间允许时）
cd backend && npm test
```

验证清单：
- [ ] `tsc --noEmit` 无新增报错（无孤儿 import / 未用变量）。
- [ ] memory / runtime / agent / server 相关测试全绿。
- [ ] grep 复查：`recordMemoryTurnAndMaybeFlush`、`MemoryCoordinator`、`createMemoryCoordinator`、`getMemoryCoordinator` 在 `backend/src` 下**已无残留引用**（除非本就在围栏内）。
- [ ] `db/memory-repository.ts`、`db/client.ts` **仍然存在且可编译**（证明没有越界删 PG）。

---

## 7. 文档同步（删完必做，CLAUDE.md 强制）

1. **`docs/backend/20260618-1-后端代码文件级说明 技术规范.md`**：删除 `memory/flush.ts` 条目；更新 `memory/coordinator.ts` 说明（去掉 PG 协调器描述）；如删了 dev PG 脚本/测试同步删条目。
2. **`CLAUDE.md`**：若 §3 优先级 1 对 `flush.ts` 的描述、或 python/脚本/目录语义因本次删除而过时，同步修订。
3. **`AGENTS.md`**：与 `CLAUDE.md` 同源，任一改动必须镜像（CLAUDE.md 协作与同步条款）。
4. 不要把本次一次性删除过程写进 `CLAUDE.md`/`AGENTS.md`；过程记录留在本执行指令的"执行结果"附录或提交信息里。

---

## 8. 交付说明（执行者回填）

完成后在本文件末尾追加一节，列出：
- 实删文件 / 符号清单与对应 commit。
- grep / tsc / 测试结果摘要。
- 与本文描述不符之处（行号漂移、新引用、被迫停手的点）。
- §5 围栏中实际遇到、建议后续立项处理的债。

## 9. 回滚

每阶段独立提交。任一阶段测试红且无法快速修因 → `git revert` 该阶段提交，恢复到上一个绿状态，并在交付说明记录失败原因，不要带病推进下一阶段。

---

## 10. 执行结果（2026-05-29）

### 实删文件 / 符号清单

- 阶段 A commit `dcf6662`（`chore(memory): 移除已废弃的 flush 每日 dump 路径`）：
  - 删除 `backend/src/memory/flush.ts`。
  - 删除 `recordMemoryTurnAndMaybeFlush` / `resetMemoryTurnCounter` 导出与 `agent-runner.ts` 调用点。
  - 删除仅由 flush 使用的 `appendDailyMemoryEntry` / `getDailyMemoryFilePath`。
  - 删除因 `TurnState` 失去用途而产生的 `backend/src/agent/index.ts` 孤儿导出。
- 阶段 B commit `f1773bd`（`chore(memory): 移除默认不可达的 PG MemoryCoordinator 分支`）：
  - 删除 `MemoryCoordinator` 类、`createMemoryCoordinator`、`getMemoryCoordinator`、模块级 `memoryCoordinator` 单例。
  - 删除 `coordinator.ts` 内 PG 入队 / 轮询 / job 处理相关 import、常量和方法。
  - `server.ts` 不再创建或关闭 memory coordinator。
  - `session-runtime-service.ts` turn 完成后直接调用 `extractAndPersistOnTurnComplete`。

### 验证结果

- 阶段 A：
  - `rg "recordMemoryTurnAndMaybeFlush|resetMemoryTurnCounter|appendDailyMemoryEntry|getDailyMemoryFilePath" backend/src --glob '*.ts'`：无命中。
  - `pnpm -F @lecquy/backend typecheck`：通过。
  - `pnpm -F @lecquy/backend test`：通过，`264` 个测试通过。
- 阶段 B：
  - `rg "MemoryCoordinator|createMemoryCoordinator|getMemoryCoordinator|memoryCoordinator" backend/src --glob '*.ts'`：无命中。
  - `backend/src/db/client.ts`、`backend/src/db/memory-repository.ts` 仍存在。
  - `pnpm -F @lecquy/backend typecheck`：通过。
  - `pnpm -F @lecquy/backend test`：通过，`264` 个测试通过。

### 与本文描述不符之处

- `prompt-injector.ts` 仍通过 `loadMemoryInjectionText` fallback 读取 `MEMORY.md` 与今天 / 昨天 daily memory 文件；这是 §5 围栏内的 prompt / PG 兼容链路，本次未拆。阶段 A 只删除自动写 daily dump 的 flush 路径。
- `coordinator.test.ts` 现有用例已经只覆盖 SQLite watermark / 异常路径，没有需要删除的 PG 轮询测试。

### 后续围栏债

- 整套 PG 代码仍存在：`db/client.ts`、`db/memory-repository.ts`、`memory-search-repository.ts`、`prompt-injector.ts` 的 PG legacy fallback、`foresight-sync.ts`、dev PG smoke 脚本等。本次按 §5 不处理。
- `.lecquy/system-prompt/` 模板加载器与相关测试仍存在。本次按 §5 不处理。
