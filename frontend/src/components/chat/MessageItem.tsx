import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { ChatMessage } from '../../hooks/useChat'

interface MessageItemProps {
  message: ChatMessage
}

function renderInlineMarkdown(text: string): Array<string | ReactNode> {
  const parts: Array<string | ReactNode> = []
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
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
        <code key={`code-${key++}`} className="rounded bg-hover px-1 py-0.5 text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (m) {
        parts.push(
          <a
            key={`a-${key++}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
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

function renderMarkdown(text: string): ReactNode {
  const blocks = text.split(/```([\s\S]*?)```/g)
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          return (
            <pre key={`pre-${index}`} className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-xs">
              <code>{block}</code>
            </pre>
          )
        }

        const lines = block.split('\n')
        return (
          <div key={`txt-${index}`} className="space-y-1">
            {lines.map((line, lineIndex) => {
              if (!line.trim()) return <div key={`br-${lineIndex}`} className="h-2" />
              if (/^#{1,6}\s/.test(line)) {
                const level = line.match(/^#+/)?.[0].length ?? 1
                const content = line.replace(/^#{1,6}\s+/, '')
                const sizeClass = level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold'
                return (
                  <div key={`h-${lineIndex}`} className={sizeClass}>
                    {renderInlineMarkdown(content)}
                  </div>
                )
              }
              if (/^[-*]\s+/.test(line)) {
                return (
                  <div key={`li-${lineIndex}`} className="pl-4">
                    <span className="mr-2">•</span>
                    <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</span>
                  </div>
                )
              }
              return (
                <p key={`p-${lineIndex}`} className="whitespace-pre-wrap break-words">
                  {renderInlineMarkdown(line)}
                </p>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'

  return (
    <div
      className={clsx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={clsx(
          'max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed',
          // 用户消息改为低饱和背景 + 深色文字，降低视觉权重
          isUser && 'bg-hover text-text-primary border border-border/70',
          // AI 消息去掉卡片外观，与页面背景融合
          isAssistant && 'bg-transparent border-transparent shadow-none text-text-primary px-1 py-1',
          isEvent && 'bg-hover text-text-secondary border border-border',
          message.role === 'system' && 'bg-hover text-text-secondary border border-border',
        )}
      >
        {isEvent && message.eventType && (
          <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
            {message.eventType}
          </div>
        )}
        {isAssistant ? renderMarkdown(message.content) : <div className="whitespace-pre-wrap">{message.content}</div>}
      </div>
    </div>
  )
}
