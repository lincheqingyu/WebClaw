# PaperQA 风格 RAG 开发与文档编写原则

更新日期：2026-04-08

## 1. 开发原则

### 1.1 先做独立效果，再做主链路集成

RAG 这条路线必须先证明自身检索效果，再考虑接入 runtime。

默认顺序：

1. ingest
2. chunk
3. retrieval
4. evidence selection
5. answer synthesis
6. 再评估 integration

### 1.2 不和记忆系统混层

默认边界：

- memory：解决“这个用户/会话发生过什么”
- RAG：解决“文档里有什么知识”

禁止：

- 把文档 chunk 写进 `memory_items`
- 用 `memory` 文档代替 RAG 规划

### 1.3 效果优先于形式

这条路线的成败，不取决于表是否建好，而取决于：

- 检索是不是更准
- 证据是不是更可信
- 回答是不是更像 Paper-QA 风格

## 2. 文档编写原则

后续新增文档时，每次都要写清：

1. 使用的数据集或文档源
2. chunk 策略
3. 检索方法
4. 评估口径
5. 相比上一轮的提升或退化

## 3. 统一词汇

在本路线文档中，尽量统一使用：

- `文档源`
- `chunk`
- `证据`
- `检索`
- `证据筛选`
- `引用`
- `回答组装`

## 4. 变更边界

允许改：

- `backend/src/rag/`
- `backend/src/db/knowledge-repository.ts`
- RAG 相关 migration
- RAG 独立测试和 smoke

默认不改：

- runtime 主链路
- memory recall
- WebSocket 协议
- 前端 UI
