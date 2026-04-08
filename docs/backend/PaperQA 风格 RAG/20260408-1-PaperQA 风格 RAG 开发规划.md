# PaperQA 风格 RAG 开发规划

更新日期：2026-04-08

## 1. 目标

这条路线的目标是尽量逼近 Paper-QA 风格的文档检索效果。

目标表述：

- 检索、选证据、组织回答的行为尽量向 Paper-QA 靠拢
- 效果目标至少达到 `80%` 的工程复刻
- 当前阶段优先追求“独立可验证的 RAG 质量”，而不是先接入主链路

## 2. 当前基线

当前仓库已有：

- `knowledge_documents`
- `knowledge_chunks`
- 最小 ingestion
- text-first search
- 独立 RAG repository

当前还没有：

- 面向检索效果的 chunk 策略
- 证据筛选层
- Paper-QA 风格 answer synthesis
- citation 风格输出
- 与 runtime 主链路的集成方案

## 3. 参考项目

主参考对象：

- Paper-QA / Paper-QA2

当前阶段要重点研究：

- ingest 流程
- chunk 组织方式
- retrieval 组合策略
- evidence ranking
- 回答阶段如何引用证据

## 4. 分阶段开发顺序

### Phase 1：独立检索质量提升

重点：

- chunk 策略
- metadata 结构
- text-first search 的质量

### Phase 2：证据筛选与排序

重点：

- top-k 策略
- 去噪
- 命中文档内的证据选择

### Phase 3：回答组装

重点：

- 回答结构
- 证据引用
- 结果可追溯性

### Phase 4：再评估是否接 runtime

只有独立质量达到预期后，再讨论：

- knowledge recall 是否接主链路
- 与 memory recall 如何并列

## 5. 验收标准

达到下面标准，才算这条路线的一期完成：

1. 有稳定的文档 ingest 和 chunk 策略
2. `searchKnowledgeChunks()` 在目标文档集上有可接受的检索质量
3. 至少有一套接近 Paper-QA 的证据驱动回答样式
4. 文档中能明确描述“当前离 Paper-QA 还差什么”

## 6. 当前不做

- 不直接接 runtime
- 不和记忆系统混表
- 不做前端知识库 UI
- 不做大规模 embedding / vector search 扩展，除非确有必要
