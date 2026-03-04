import { ChevronLeft, ChevronRight, MessageSquare, PenSquare, Plus, Trash2 } from 'lucide-react'

export interface ConversationItem {
  id: string
  title: string
  preview: string
  peerId: string
  updatedAt: number
}

interface ConversationSidebarProps {
  conversations: ConversationItem[]
  activeConversationId: string
  collapsed: boolean
  onToggleCollapse: () => void
  onCreateConversation: () => void
  onSelectConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
}

function formatTime(timestamp: number): string {
  const now = new Date()
  const target = new Date(timestamp)
  const sameDay =
    now.getFullYear() === target.getFullYear() &&
    now.getMonth() === target.getMonth() &&
    now.getDate() === target.getDate()

  if (sameDay) {
    return target.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return target.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  collapsed,
  onToggleCollapse,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
}: ConversationSidebarProps) {
  return (
    <aside
      className={[
        'h-full shrink-0 border-r border-border bg-surface-alt',
        'transition-[width] duration-300 ease-out',
        collapsed ? 'w-[3.05rem]' : 'w-72',
      ].join(' ')}
      aria-label="会话管理栏"
    >
      <div className="flex h-full flex-col">
        <div
          className={[
            'flex h-12 shrink-0 items-center px-2',
            collapsed ? 'justify-center' : 'justify-between',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={onToggleCollapse}
            className={[
              'inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary',
              'transition-colors hover:bg-hover hover:text-text-primary',
            ].join(' ')}
            aria-label={collapsed ? '展开会话栏' : '收起会话栏'}
            title={collapsed ? '展开会话栏' : '收起会话栏'}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>

          {!collapsed && (
            <button
              type="button"
              onClick={onCreateConversation}
              className={[
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium',
                'text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
              ].join(' ')}
              aria-label="新建会话"
            >
              <Plus className="size-4" />
              <span>新会话</span>
            </button>
          )}
        </div>

        {collapsed && (
          <div className="flex justify-center p-2">
            <button
              type="button"
              onClick={onCreateConversation}
              className={[
                'inline-flex h-8 w-8 items-center justify-center rounded-md',
                'text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
              ].join(' ')}
              aria-label="新建会话"
              title="新建会话"
            >
              <PenSquare className="size-4" />
            </button>
          </div>
        )}

        <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId

              if (collapsed) {
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => onSelectConversation(conversation.id)}
                      title={conversation.title}
                      className={[
                        'group relative mx-auto inline-flex h-8 w-8 items-center justify-center rounded-md transition-all',
                        isActive
                          ? 'bg-hover text-text-primary'
                          : 'text-text-secondary hover:bg-hover hover:text-text-primary',
                      ].join(' ')}
                      aria-label={conversation.title}
                    >
                      <MessageSquare className="size-4" />
                      {isActive && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
                    </button>
                  </li>
                )
              }

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conversation.id)}
                    className={[
                      'group flex h-12 w-full items-center gap-2 rounded-md px-2.5 text-left transition-all',
                      isActive
                        ? 'bg-hover'
                        : 'hover:bg-hover',
                    ].join(' ')}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span
                      className={[
                        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                        isActive ? 'text-text-primary' : 'text-text-secondary',
                      ].join(' ')}
                    >
                      <MessageSquare className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="line-clamp-1 block truncate text-sm font-medium text-text-primary leading-tight">
                        {conversation.title}
                      </span>
                      <span className="line-clamp-1 mt-0.5 block truncate text-xs text-text-muted leading-tight">
                        {conversation.preview}
                      </span>
                    </span>
                    <span className="ml-1 flex shrink-0 items-center gap-1">
                      <span className="text-[11px] text-text-muted">{formatTime(conversation.updatedAt)}</span>
                      {conversations.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteConversation(conversation.id)
                          }}
                          className={[
                            'inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted',
                            'transition-colors hover:bg-surface-alt hover:text-red-500',
                            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                          ].join(' ')}
                          aria-label="删除会话"
                          title="删除会话"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </aside>
  )
}
