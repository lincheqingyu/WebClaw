import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Copy, FileText, ListTodo, RotateCcw, Sparkles } from 'lucide-react'
import { useState, type FocusEvent, type ReactNode } from 'react'
import type { ChatMessage } from '../../hooks/useChat'
import { buildAttachmentPreviewUrl } from '../../lib/chat-attachments'

interface MessageItemProps {
  message: ChatMessage
  onResendUser?: (message: string) => void
  onToggleThinking?: (messageId: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <pre
      className="group/code relative mx-2 overflow-x-auto rounded-xl border border-border bg-surface-alt px-4 py-3 text-xs leading-relaxed"
    >
      <button
        type="button"
        onClick={handleCopyCode}
        className={[
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'bg-surface-alt text-black transition-all hover:bg-surface',
          'opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100',
        ].join(' ')}
        aria-label="复制代码"
        title="复制代码"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {language ? (
        <div className="mb-2 pr-16 text-[11px] uppercase tracking-wide text-text-muted">{language}</div>
      ) : (
        <div className="mb-2 pr-16" />
      )}
      <code>{code}</code>
    </pre>
  )
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+```/g, '\n```')
    .replace(/```\n+/g, '```\n')
}

type MarkdownSegment =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string }

function splitMarkdownSegments(text: string): MarkdownSegment[] {
  const lines = text.split('\n')
  const segments: MarkdownSegment[] = []

  let inCode = false
  let fenceLength = 0 // 当前代码块开启时的反引号数量
  let nestedDepth = 0 // 嵌套代码块深度（处理 LLM 输出嵌套 ``` 的场景）
  let language = ''
  let buffer: string[] = []

  const flushText = () => {
    const content = buffer.join('\n')
    if (content.trim()) {
      segments.push({ kind: 'text', content })
    }
    buffer = []
  }

  const flushCode = () => {
    const content = buffer.join('\n')
    segments.push({ kind: 'code', content, language: language || undefined })
    buffer = []
  }

  // 计算行首连续反引号数量
  const countLeadingBackticks = (line: string): number => {
    const match = line.match(/^`{3,}/)
    return match ? match[0].length : 0
  }

  for (const line of lines) {
    const backtickCount = countLeadingBackticks(line)

    if (!inCode && backtickCount >= 3) {
      // 开启代码块
      flushText()
      inCode = true
      fenceLength = backtickCount
      nestedDepth = 0
      language = line.slice(backtickCount).trim()
      continue
    }

    if (inCode && backtickCount >= 3) {
      const trailing = line.slice(backtickCount).trim()

      if (trailing !== '') {
        // 有语言标识（如 ```python）：嵌套代码块开启，深度 +1
        nestedDepth++
        buffer.push(line)
        continue
      }

      // 纯关闭标记（如 ```）
      if (nestedDepth > 0) {
        // 先关闭内层嵌套
        nestedDepth--
        buffer.push(line)
        continue
      }

      // 外层反引号数量匹配检查：>= 开启时的数量才关闭
      if (backtickCount >= fenceLength) {
        flushCode()
        inCode = false
        fenceLength = 0
        nestedDepth = 0
        language = ''
        continue
      }
    }

    buffer.push(line)
  }

  if (inCode) {
    // 流式输出时未闭合代码块：将尾部仍按代码块渲染，避免闪烁成普通文本。
    flushCode()
  } else {
    flushText()
  }

  return segments
}

function renderInlineMarkdown(text: string): Array<string | ReactNode> {
  const parts: Array<string | ReactNode> = []
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={`code-${key++}`} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`strong-${key++}`} className="font-semibold">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`em-${key++}`} className="italic">{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (m) {
        parts.push(
          <a
            key={`a-${key++}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="text-accent-text underline underline-offset-2"
          >
            {m[1]}
          </a>,
        )
      } else {
        parts.push(token)
      }
    } else {
      parts.push(token)
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

function TableBlock({ raw, headers, alignments, rows }: {
  raw: string
  headers: string[]
  alignments: Array<'left' | 'center' | 'right'>
  rows: string[][]
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group/table relative mx-2 overflow-x-auto rounded-xl border border-border bg-surface-alt px-2 py-2">
      <button
        type="button"
        onClick={handleCopy}
        className={[
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'bg-surface-alt text-black transition-all hover:bg-surface',
          'opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100',
        ].join(' ')}
        aria-label="复制表格"
        title="复制表格"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={i}
                style={{ textAlign: alignments[i] }}
                className="px-3 py-1.5 font-semibold text-text-primary"
              >
                {renderInlineMarkdown(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/50">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{ textAlign: alignments[ci] }}
                  className="px-3 py-1.5 text-text-secondary"
                >
                  {renderInlineMarkdown(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderTextBlock(block: string, blockIndex: number): ReactNode {
  const lines = block.split('\n')
  const nodes: ReactNode[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: ReactNode[] = []
  let listKey = 0
  let tableLines: string[] = []
  let tableKey = 0

  const flushList = () => {
    if (!listType || listItems.length === 0) return
    if (listType === 'ul') {
      nodes.push(
        <ul key={`ul-${blockIndex}-${listKey++}`} className="list-disc space-y-1 pl-5">
          {listItems}
        </ul>,
      )
    } else {
      nodes.push(
        <ol key={`ol-${blockIndex}-${listKey++}`} className="list-decimal space-y-1 pl-5">
          {listItems}
        </ol>,
      )
    }
    listType = null
    listItems = []
  }

  const flushTable = () => {
    if (tableLines.length === 0) return

    if (tableLines.length < 2) {
      // 不足两行（无表头+分隔符），当普通文本处理
      tableLines.forEach((line, i) => {
        nodes.push(
          <p key={`tp-${blockIndex}-${tableKey}-${i}`} className="whitespace-pre-wrap break-words leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>,
        )
      })
      tableLines = []
      return
    }

    const parseRow = (line: string) =>
      line.split('|').slice(1, -1).map(cell => cell.trim())

    const headers = parseRow(tableLines[0])

    // 解析对齐方式
    const alignments: Array<'left' | 'center' | 'right'> = parseRow(tableLines[1]).map(cell => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
      if (cell.endsWith(':')) return 'right'
      return 'left'
    })

    const rows = tableLines.slice(2).map(parseRow)
    const raw = tableLines.join('\n')

    nodes.push(
      <TableBlock
        key={`tbl-${blockIndex}-${tableKey++}`}
        raw={raw}
        headers={headers}
        alignments={alignments}
        rows={rows}
      />,
    )
    tableLines = []
  }

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim()

    if (!trimmed) {
      flushTable()
      flushList()
      nodes.push(<div key={`gap-${blockIndex}-${lineIndex}`} className="h-2" />)
      return
    }

    // 表格行检测：以 | 开头并以 | 结尾
    if (/^\|.+\|$/.test(trimmed)) {
      flushList()
      tableLines.push(trimmed)
      return
    }

    // 非表格行时 flush 已收集的表格
    if (tableLines.length > 0) {
      flushTable()
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushList()
      nodes.push(<hr key={`hr-${blockIndex}-${lineIndex}`} className="my-2 border-border" />)
      return
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushList()
      const level = trimmed.match(/^#+/)?.[0].length ?? 1
      const content = trimmed.replace(/^#{1,6}\s+/, '')
      const sizeClass = level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold'
      nodes.push(
        <div key={`h-${blockIndex}-${lineIndex}`} className={sizeClass}>
          {renderInlineMarkdown(content)}
        </div>,
      )
      return
    }

    if (/^>\s+/.test(trimmed)) {
      flushList()
      nodes.push(
        <blockquote
          key={`q-${blockIndex}-${lineIndex}`}
          className="border-l-2 border-border pl-3 text-text-secondary"
        >
          {renderInlineMarkdown(trimmed.replace(/^>\s+/, ''))}
        </blockquote>,
      )
      return
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listItems.push(
        <li key={`li-ul-${blockIndex}-${lineIndex}`} className="leading-relaxed">
          {renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}
        </li>,
      )
      return
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listItems.push(
        <li key={`li-ol-${blockIndex}-${lineIndex}`} className="leading-relaxed">
          {renderInlineMarkdown(trimmed.replace(/^\d+\.\s+/, ''))}
        </li>,
      )
      return
    }

    flushList()
    nodes.push(
      <p key={`p-${blockIndex}-${lineIndex}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>,
    )
  })

  flushTable()
  flushList()
  return <div className="space-y-2">{nodes}</div>
}

function MarkdownPreviewBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group/mdblock relative mx-2 overflow-x-auto rounded-xl border border-border bg-surface-alt px-4 py-3">
      <button
        type="button"
        onClick={handleCopy}
        className={[
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'bg-surface-alt text-black transition-all hover:bg-surface',
          'opacity-0 group-hover/mdblock:opacity-100 group-focus-within/mdblock:opacity-100',
        ].join(' ')}
        aria-label="复制源码"
        title="复制源码"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <div className="mb-2 pr-16 text-[11px] uppercase tracking-wide text-text-muted">markdown</div>
      {renderMarkdown(code)}
    </div>
  )
}

function renderMarkdown(text: string): ReactNode {
  const normalized = normalizeMarkdown(text)
  const segments = splitMarkdownSegments(normalized)
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.kind === 'code') {
          // markdown/md 语言的代码块：将内容作为 Markdown 递归渲染
          if (segment.language === 'markdown' || segment.language === 'md') {
            return <MarkdownPreviewBlock key={`md-${index}`} code={segment.content} />
          }
          return <CodeBlock key={`pre-${index}`} code={segment.content} language={segment.language} />
        }
        return <div key={`txt-${index}`}>{renderTextBlock(segment.content, index)}</div>
      })}
    </div>
  )
}

function summarizeTodo(items: NonNullable<ChatMessage['todoItems']>) {
  const completed = items.filter((item) => item.status === 'completed').length
  const inProgress = items.filter((item) => item.status === 'in_progress').length
  const total = items.length
  return {
    label: `已完成 ${completed}/${total} 步`,
    detail: inProgress > 0 ? `进行中 ${inProgress} 项` : total === completed ? '全部已完成' : '等待执行',
  }
}

function currentTodoFocus(items: NonNullable<ChatMessage['todoItems']>) {
  const active = items.find((item) => item.status === 'in_progress') ?? items.find((item) => item.status === 'pending')
  return active?.content ?? null
}

function getEventLabel(eventType?: string) {
  if (!eventType) return null

  switch (eventType) {
    case 'pause':
      return '需要你补充信息'
    case 'tool_error':
      return '执行异常'
    case 'session_tool_result':
      return '会话操作'
    default:
      return null
  }
}

export function MessageItem({
  message,
  onResendUser,
  onToggleThinking,
  onToggleTodo,
  onTogglePlanTask,
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'
  const hasPrimaryContent = message.content.trim().length > 0
  const hasThinkingContent = Boolean(message.hasThinking && message.thinkingContent?.trim())
  const showThoughtsCard = Boolean((isAssistant || isEvent) && hasThinkingContent)
  const canCopyMessage = message.content.trim().length > 0
  const todoItems = message.todoItems ?? []
  const planDetails = message.planDetails ?? {}
  const isPlanPanel = isEvent && (message.eventType === 'plan' || message.eventType === 'todo')
  const eventLabel = getEventLabel(message.eventType)
  const [copied, setCopied] = useState(false)
  const [isActionBarHovered, setIsActionBarHovered] = useState(false)
  const [isActionBarFocused, setIsActionBarFocused] = useState(false)
  const isActionBarVisible = isActionBarHovered || isActionBarFocused
  const attachments = message.attachments ?? []

  if (isAssistant && !hasPrimaryContent && !showThoughtsCard) {
    return null
  }

  if (isPlanPanel) {
    const summary = summarizeTodo(todoItems)
    const focus = currentTodoFocus(todoItems)
    const completed = todoItems.filter((item) => item.status === 'completed').length
    const total = todoItems.length
    const headerStatus = total === 0 ? '正在生成计划' : `${completed}/${total}`
    const headerDetail =
      total === 0
        ? '正在拆解任务...'
        : focus
          ? `当前：${focus}`
          : summary.detail

    return (
      <div className="flex w-full justify-start">
        <div className="w-full overflow-hidden rounded-[1.35rem] border border-border bg-surface-thought">
          <button
            type="button"
            onClick={() => onToggleTodo?.(message.id)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-hover/60"
            aria-expanded={message.isTodoExpanded}
            aria-label={message.isTodoExpanded ? '收起计划步骤' : '展开计划步骤'}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-alt text-accent-text">
                <ListTodo className="size-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">Plan</div>
                <div className="mt-0.5 text-xs text-text-secondary">{headerDetail}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm text-text-secondary">
              <span>{headerStatus}</span>
              {message.isTodoExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </div>
          </button>

          {message.isTodoExpanded && (
            <div className="border-t border-border bg-surface-alt px-4 py-4">
              {todoItems.length === 0 ? (
                <div className="text-sm text-text-secondary">正在生成任务列表...</div>
              ) : (
                <div className="space-y-4">
                  {todoItems.map((item, index) => {
                    const detail = planDetails[index]
                    const taskSummary = detail?.content?.trim() || item.result?.trim() || ''
                    const hasTaskSummary = Boolean(taskSummary)
                    const isTaskExpanded = message.expandedPlanTaskIndexes?.includes(index) ?? false

                    return (
                      <div key={`${item.content}_${index}`} className="overflow-hidden rounded-[1.1rem] border border-border/80 bg-surface-thought">
                        <button
                          type="button"
                          onClick={() => onTogglePlanTask?.(message.id, index)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/35"
                          aria-expanded={isTaskExpanded}
                          aria-label={isTaskExpanded ? '收起任务详情' : '展开任务详情'}
                        >
                          <span className={clsx(
                            'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                            item.status === 'completed' && 'border-border bg-surface-thought text-text-primary',
                            item.status === 'in_progress' && 'border-accent text-accent-text',
                            item.status === 'pending' && 'border-border text-text-muted',
                          )}>
                            {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '>' : ''}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className={clsx(
                              'text-sm leading-relaxed',
                              item.status === 'completed' ? 'text-text-primary' : item.status === 'in_progress' ? 'font-medium text-text-primary' : 'text-text-secondary',
                            )}>
                              {item.content}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 pt-0.5 text-sm text-text-secondary">
                            {isTaskExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </div>
                        </button>

                        {isTaskExpanded && (
                          <div className="border-t border-border/80 px-4 py-3">
                            {hasTaskSummary ? (
                              <div className="space-y-3">
                                <div className="px-1 text-text-primary">
                                  {renderMarkdown(taskSummary)}
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-text-secondary">
                                {item.status === 'pending' ? '等待执行' : item.status === 'in_progress' ? '正在执行...' : '已完成'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleActionAreaBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusTarget = event.relatedTarget
    if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) {
      return
    }
    setIsActionBarFocused(false)
  }

  const renderAttachments = () => {
    if (attachments.length === 0) return null

    return (
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment, index) => (
            attachment.kind === 'image' ? (
              <div
                key={`${attachment.name}_${index}`}
                className="overflow-hidden rounded-[1.1rem] border border-border bg-surface-thought shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
              >
                <img
                  src={buildAttachmentPreviewUrl(attachment) ?? ''}
                  alt={attachment.name}
                  className="h-32 w-32 object-cover md:h-40 md:w-40"
                />
                <div className="border-t border-border/70 px-3 py-2">
                  <div className="truncate text-xs font-medium text-text-primary">{attachment.name}</div>
                </div>
              </div>
            ) : (
              <div
                key={`${attachment.name}_${index}`}
                className="flex min-w-[12rem] max-w-[18rem] items-start gap-3 rounded-[1.1rem] border border-border bg-surface-thought px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-text-secondary">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-primary">{attachment.name}</div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {(attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : '文本文件')}
                    {attachment.truncated ? ' · 已截断' : ''}
                  </div>
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={clsx(
          'inline-flex flex-col',
          isUser ? 'max-w-[88%] items-end' : showThoughtsCard ? 'w-full' : 'max-w-full',
        )}
        onPointerEnter={() => setIsActionBarHovered(true)}
        onPointerLeave={() => setIsActionBarHovered(false)}
        onFocusCapture={() => setIsActionBarFocused(true)}
        onBlur={handleActionAreaBlur}
      >
        <div
          className={clsx(
            'rounded-2xl px-4 py-2 text-sm leading-relaxed',
            isUser && 'w-fit bg-hover text-text-primary border border-border/70',
            isAssistant && (showThoughtsCard ? 'w-full bg-transparent border-transparent shadow-none text-text-primary px-1 py-1' : 'w-fit max-w-full bg-transparent border-transparent shadow-none text-text-primary px-1 py-1'),
            isEvent && 'bg-surface text-text-secondary border border-border/80',
            message.role === 'system' && 'bg-hover text-text-secondary border border-border',
          )}
        >
          {isEvent && eventLabel && (
            <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
              {eventLabel}
            </div>
          )}

          {showThoughtsCard && (
            <div className="mb-4 overflow-hidden rounded-[1.35rem] border border-border bg-surface-thought">
              <button
                type="button"
                onClick={() => onToggleThinking?.(message.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/60"
                aria-expanded={message.isThinkingExpanded}
                aria-label={message.isThinkingExpanded ? '隐藏思考内容' : '展开查看模型思考'}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-thought text-accent-text">
                    <Sparkles className="size-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-text-primary">Thoughts</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <span>{message.isThinkingExpanded ? '收起思考' : '展开思考'}</span>
                  {message.isThinkingExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </div>
              </button>

              {message.isThinkingExpanded && (
                <div className="border-t border-border px-4 py-4 text-text-primary [&_p]:text-text-primary [&_li]:text-text-primary [&_blockquote]:text-text-primary [&_td]:text-text-primary [&_code]:text-text-primary">
                  {renderMarkdown(message.thinkingContent ?? '')}
                </div>
              )}
            </div>
          )}

          {isUser && renderAttachments()}

          {isAssistant ? (
            hasPrimaryContent ? (
              renderMarkdown(message.content)
            ) : null
          ) : (
            hasPrimaryContent ? (
              <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</div>
            ) : null
          )}
        </div>
        {(isUser || isAssistant) && canCopyMessage && (
          <div
            className={clsx(
              'mt-0.5 flex h-7 items-center',
              isUser ? 'justify-end pr-0.5' : 'justify-start pl-1',
            )}
          >
            <div
              className={clsx(
                'flex items-center gap-1 transition-opacity duration-150',
                isActionBarVisible
                  ? 'visible opacity-100 pointer-events-auto'
                  : 'invisible opacity-0 pointer-events-none',
              )}
            >
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-text-primary transition-colors hover:bg-surface dark:text-white"
                aria-label="复制消息"
                title="复制消息"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
              {isUser && onResendUser && (
                <button
                  type="button"
                  onClick={() => onResendUser(message.content)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-text-primary transition-colors hover:bg-surface dark:text-white"
                  aria-label="重新发送问题"
                  title="重新发送问题"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
