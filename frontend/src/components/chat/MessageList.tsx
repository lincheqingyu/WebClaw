import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
}

export function MessageList({ messages, isStreaming, isWaiting }: MessageListProps) {
  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto px-6 py-6">
      {messages.length === 0 && (
        <div className="text-center text-text-muted">
          发送消息开始对话
        </div>
      )}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>
      {(isStreaming || isWaiting) && (
        <div className="text-xs text-text-muted">
          {isWaiting ? '等待用户补充信息…' : '正在生成…'}
        </div>
      )}
    </div>
  )
}
