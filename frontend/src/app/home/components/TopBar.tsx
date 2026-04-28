import { Moon, Settings, Sun } from 'lucide-react'

interface TopBarProps {
  conversationTitle: string
  sessionMetaText?: string | null
  isDark: boolean
  onThemeToggle: () => void
  onSettingsToggle: () => void
}

export function TopBar({
  conversationTitle,
  sessionMetaText = null,
  isDark,
  onThemeToggle,
  onSettingsToggle,
}: TopBarProps) {
  return (
    <header className="h-12 shrink-0 bg-surface-alt/95 backdrop-blur">
      <div className="flex h-full w-full items-center justify-between px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="line-clamp-1 text-sm font-medium text-text-primary">
            {conversationTitle}
          </h1>
          {sessionMetaText && (
            <div className="shrink-0 text-xs text-text-muted">
              {sessionMetaText}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onThemeToggle}
            className={[
              'flex items-center justify-center',
              'size-9 rounded-lg',
              'text-text-secondary',
              'transition-colors hover:bg-hover hover:text-text-primary',
            ].join(' ')}
            aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSettingsToggle()
            }}
            className={[
              'flex items-center justify-center',
              'size-9 rounded-lg',
              'text-text-secondary',
              'transition-colors hover:bg-hover hover:text-text-primary',
            ].join(' ')}
            aria-label="打开设置"
          >
            <Settings className="size-5" />
          </button>
        </div>
      </div>
    </header>
  )
}
