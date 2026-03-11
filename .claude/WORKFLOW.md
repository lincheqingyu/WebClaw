# Agent Web 开发工作流指南

从 UI 设计构思到组件代码落地的全流程参考。

---

## 一、工具全景图

| 阶段 | 工具 | 触发方式 |
|------|------|---------|
| 设计构思 | `interface-design` 技能 | 描述界面需求时自动激活 |
| 设计系统 | `ui-ux-pro-max` 技能 | `python3 .claude/skills/ui-ux-pro-max/scripts/search.py ...` |
| 截图→代码 | `ui-analyzer` 技能 | 提供截图/设计稿时自动激活 |
| 创意实现 | `frontend-design` 技能 | 请求构建前端界面时自动激活 |
| 架构规划 | `/plan` 命令 + planner/architect 智能体 | 输入 `/plan <描述>` |
| 编码实现 | `frontend-patterns` + `coding-standards` 技能 | 编码时自动参考 |
| TDD 测试 | `/tdd` 命令 + `webapp-testing` 技能 | 输入 `/tdd <描述>` |
| 代码审查 | `/code-review` 命令 | 提交前输入 `/code-review` |
| 构建修复 | `/build-fix` 命令 | 构建报错时输入 `/build-fix` |
| 重构清理 | `/refactor-clean` 命令 | 定期输入 `/refactor-clean` |

---

## 二、三条开发路径

### 路径 A：从零构建界面（推荐路径）

本项目是终端风格 AI 对话客户端，属于"应用界面"（dashboard/tool），优先使用 `interface-design` 技能。

**Step 1 — 意图定义（interface-design）**

向 Claude 描述要构建的界面，触发 interface-design 技能。技能会引导回答 3 个核心问题：
- 用户是谁？
- 要完成什么任务？
- 界面应该给人什么感觉？

产出：设计方向 (Direction)、领域探索 (Domain)、签名元素 (Signature)、需要避免的默认选择 (Defaults)

示例提示词：
> "为 Agent Web 设计主对话界面。这是一个面向开发者的终端风格 AI 对话客户端，用户需要在此输入提示词、查看流式回复、阅读代码块。"

**Step 2 — 设计系统生成（ui-ux-pro-max）**

基于 Step 1 的方向关键词，运行设计系统生成命令：

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
  "developer tool terminal CLI dark monospace" \
  --design-system -p "Agent Web"
```

可追加细分搜索：`--domain color`、`--domain typography`、`--stack html-tailwind`

产出：颜色调色板、排版推荐、风格模式、反面模式。

**Step 3 — 组件实现（frontend-design + interface-design Craft Foundations）**

向 Claude 请求实现具体组件，同时引用前两步的设计决策：
- `frontend-design` 确保视觉独特性（反 AI 审美）
- `interface-design` 的 Craft Foundations 确保工艺质量（微妙的层级、精确间距、一致的圆角/阴影策略）

示例提示词：
> "基于上面的设计系统，实现 ChatMessage 组件。要求：支持用户/AI 两种角色、Markdown 渲染、代码块语法高亮、暗色主题。"

**Step 4 — 实现规划（/plan）**

对于复杂功能，先用 `/plan` 拆解为可执行步骤。planner 智能体产出：分阶段计划、依赖关系、风险评估。等待确认后再开始编码。

**Step 5 — TDD 编码（/tdd）**

用 `/tdd` 启动测试驱动开发：
1. 定义接口
2. 写失败测试 (RED)
3. 最小实现 (GREEN)
4. 重构 (REFACTOR)
5. 确保 80%+ 测试覆盖率

**Step 6 — 审查与提交（/code-review）**

提交前**必须**运行 `/code-review`，修复所有 CRITICAL 和 HIGH 问题，通过后按 conventional commits 规范提交。

---

### 路径 B：从设计截图实现（快速路径）

适用场景：已有 Figma 导出、UI 截图或设计稿。

1. **提供截图** → 触发 `ui-analyzer` 技能（自动 9 步分析流程）
2. **验证设计令牌** → 可选用 `ui-ux-pro-max --domain color/typography` 校验
3. **质量检查** → `interface-design` Craft Foundations 验证（Swap / Squint / Signature / Token 四项测试）
4. `/plan` → `/tdd` → `/code-review` → 提交

---

### 路径 C：迭代优化现有界面

适用场景：已有组件需要美化或重构。

1. **截图当前状态** → 用 `ui-analyzer` 分析现有问题
2. **重新定义方向** → 用 `interface-design` 重新回答意图三问
3. **重构实现** → `/refactor-clean` 清理 + `frontend-design` 重新设计
4. `/code-review` → 提交

---

## 三、interface-design 设计系统持久化

`interface-design` 技能支持将设计决策保存到 `.interface-design/system.md`，实现跨会话一致性：

- **首次使用**：完成 Intent + Domain Exploration 后，Claude 会将核心决策写入 `system.md`
- **后续使用**：如果 `system.md` 存在，Claude 直接沿用已定义的方向、间距基数、depth 策略等
- **内容包括**：设计方向、depth 策略（borders-only / subtle shadows / layered）、间距基数、关键组件模式
- **何时更新**：仅在设计方向发生根本变化时

---

## 四、技能协作关系

```
                    ┌──────────────────┐
                    │ interface-design │  ← 意图 & 方向（应用界面）
                    │   Intent First   │
                    └────────┬─────────┘
                             │ 方向关键词
                    ┌────────▼─────────┐
                    │  ui-ux-pro-max   │  ← 设计系统（数据驱动）
                    │  Design System   │
                    └────────┬─────────┘
                             │ 颜色/排版/风格令牌
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───────┐     │     ┌────────▼───────┐
     │ frontend-design│     │     │  ui-analyzer   │
     │ 从零创建(创意) │     │     │ 从截图实现(精确)│
     └────────┬───────┘     │     └────────┬───────┘
              │              │              │
              └──────────────▼──────────────┘
                    生产级 React + Tailwind 代码
```

**协作要点：**
- **interface-design** vs **frontend-design**：前者用于应用界面（dashboard/tool），后者用于营销页面（landing page）。本项目主要使用 interface-design
- **ui-ux-pro-max** 是所有设计技能的上游数据源
- **ui-analyzer** 是唯一能将截图/设计稿转化为代码的桥梁

---

## 五、实战示例 — Agent Web 主对话界面

以"主对话界面"为例，展示完整开发流程：

```
1. 描述需求 → 触发 interface-design
   "为 Agent Web 设计主对话界面..."

2. 生成设计系统 → 运行 ui-ux-pro-max
   python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
     "developer tool terminal CLI dark monospace" \
     --design-system -p "Agent Web"

3. 拆解功能 → /plan
   /plan 实现主对话界面：消息列表、输入框、流式输出、代码块高亮

4. 逐组件 TDD 实现 → /tdd
   /tdd ChatMessage 组件：支持 Markdown、代码块、用户/AI 角色区分

5. 审查 → /code-review

6. 构建验证 → npm run build（报错则 /build-fix）

7. E2E 测试 → webapp-testing（Playwright 验证关键流程）
```
