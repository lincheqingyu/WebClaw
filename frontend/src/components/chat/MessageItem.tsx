import clsx from 'clsx'
import type { ChatMessage } from '../../hooks/useChat'

interface MessageItemProps {
  message: ChatMessage
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
          'max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed',
          isUser && 'bg-accent text-white',
          isAssistant && 'bg-surface border border-border text-text-primary',
          isEvent && 'bg-hover text-text-secondary border border-border',
          message.role === 'system' && 'bg-hover text-text-secondary border border-border',
        )}
      >
        {isEvent && message.eventType && (
          <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
            {message.eventType}
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}
