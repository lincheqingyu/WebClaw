# 语言规范

## 使用中文的场景

- 所有对话与回复
- 代码注释（含 JSDoc / TSDoc）
- Git 提交信息与 PR 描述
- 计划文档与技术方案
- CLAUDE.md 及项目文档

## 保持英文的场景

- 代码本身：变量名、函数名、类名、组件名
- TypeScript 类型定义与接口名称
- 配置文件（`vite.config.ts`、`tsconfig.json`、`package.json` 等）
- 文件名与目录名

## 技术术语处理

首次出现的技术术语可附英文原文，后续直接使用中文：

```
// 首次出现
状态管理 (State Management)

// 后续使用
状态管理
```

## 样式方案

已确定使用 **Tailwind CSS 4** 作为样式方案。
