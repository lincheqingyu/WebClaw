# 前端 Bug 修复指令

> 本指令交给 Claude Opus 执行。要求**从根源上修复**，不得打补丁、不得绕过问题、不得引入新的脆弱依赖。

---

## Bug 1：输入框粘贴内容后光标焦点丢失

### 根因分析

**文件**：`frontend/src/components/ui/ChatInput.tsx`

`ChatInput` 根据 `showExpanded = isMultiline || attachments.length > 0` 在两个完全不同的 JSX 分支里分别渲染 `<AutoResizeTextarea>`：

```tsx
// showExpanded = false 时，textarea 在这个树里：
<div className="flex items-center gap-2 px-3 py-3">
  <button>...</button>
  <AutoResizeTextarea ... />   // ← 位置 A
  ...
</div>

// showExpanded = true 时，textarea 换到另一棵树：
<div className="px-3 pt-3 pb-2">
  {/* 附件预览区 */}
  <AutoResizeTextarea ... />   // ← 位置 B
  ...
</div>
```

React 无法将位置 A 的 `<AutoResizeTextarea>` 与位置 B 的对应起来，每次 `showExpanded` 翻转（粘贴文字导致多行、粘贴文件增加附件）都会把旧 textarea unmount 并 mount 新实例，新实例没有焦点。

现有的 `queueTextareaFocusRestore` 机制只覆盖了文件粘贴路径，对**文字粘贴引发的 `isMultiline` 翻转**完全无效，也存在异步竞态。

### 修复要求

**不允许**用 `setTimeout`、`requestAnimationFrame` 或 `focus()` 补丁来亡羊补牢。

**必须**重构 JSX 结构，让 `<AutoResizeTextarea>` 在整个组件生命周期内始终位于同一棵树的同一位置（同一层级、同一 key），无论 `showExpanded` 如何变化。

具体思路（仅供参考，实现方式由你决定，但必须满足上述约束）：

- 将 compact 与 expanded 的视觉差异改用 CSS 条件类名或条件渲染**周边元素**（附件区、工具栏）实现，而非整体替换两套 JSX 树。
- `<AutoResizeTextarea>` 只出现一次，且在 `showExpanded` 切换前后保持 React reconcile 可追踪（相同的树路径）。
- 确认修复后，可以酌情删除或简化已失去意义的 `shouldRestoreFocusRef` / `selectionRangeRef` / `queueTextareaFocusRestore` / `restoreTextareaFocus` 逻辑；如果部分路径（如 `handleFileChange` 通过文件选择器选文件后）仍然需要主动 focus，保留对应的最小逻辑即可。

---

## Bug 2：流式输出时代码块复制按钮可见但无法点击

### 根因分析

**文件**：`frontend/src/index.css`（第 470–488 行）

CSS 用 `:hover` 伪类同时控制了**视觉显示**（`opacity`/`transform`）和**事件穿透**（`pointer-events`）：

```css
/* 默认：不可见且不可点 */
.streamdown-markdown [data-streamdown="code-block"] > [data-streamdown="code-block-header"] + div {
    opacity: 0;
    transform: translateY(-1px);
    pointer-events: none;   /* ← 事件完全屏蔽 */
}

/* hover 时：可见且可点 */
.streamdown-markdown [data-streamdown="code-block"]:hover > ... {
    opacity: 1;
    pointer-events: auto;   /* ← 事件恢复 */
}
```

流式输出期间（`isAnimating=true`），React 每收到一个 chunk 都会重新渲染 `<Streamdown>` 并更新 DOM。每次 DOM patch 都可能短暂打断浏览器的 `:hover` 状态跟踪。用户把鼠标悬停在按钮上、准备点击时，下一个 chunk 的 DOM 更新恰好发生，`:hover` 瞬间失效 → `pointer-events: none` 生效 → 点击事件穿透到按钮下方元素，复制操作无法触发。

这不是偶发的竞态，而是 CSS `:hover` 伪类本身不适合在频繁 DOM 变更场景下同时承担"事件闸门"职责的根本性设计问题。

### 修复要求

**不允许**通过监听 streaming 状态然后手动设置 `pointer-events` 来打补丁。

**必须**将 `pointer-events` 控制从 `:hover` 伪类中分离出来：

- 复制按钮（及其容器）的 `pointer-events` **始终为 `auto`**，不随 hover 状态切换。
- 视觉上的显示/隐藏动效（`opacity`、`transform` 的渐变）可以保留，继续由 `:hover` / `:focus-within` 驱动，这部分没有问题。
- 最终效果：即便按钮在视觉上是透明的（`opacity: 0`），用户依然可以点击；hover 时变为可见是纯粹的视觉增强，不再是点击的前提条件。

修改范围仅限 `index.css` 里上述两段选择器，不需要改动 TypeScript/TSX 文件。

---

## 通用要求

1. **只改必要的代码**，不做无关重构。
2. 修改前先完整阅读涉及的文件，理解上下文再动手。
3. 每处修改后自行用 `grep` / `diff` 确认改动符合预期，不引入语法错误。
4. 代码注释保持中文（符合项目 `.claude/rules/language.md` 规范），代码本身（变量名、函数名等）保持英文。
