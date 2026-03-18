import { useEffect, useMemo, useRef, useState } from 'react'
import { createDefaultThinkingConfig, type ChatAttachment } from '@webclaw/shared'
import { Moon, Settings, Sun } from 'lucide-react'
import { ConversationArea } from './ConversationArea'
import { ChatsOverview } from './ChatsOverview'
import { DocumentPanel } from './DocumentPanel'
import { SettingsDrawer } from './SettingsDrawer'
import {
  ConversationSidebar,
  type ConversationItem,
} from './ConversationSidebar'
import type {
  ChatMessage,
  ModelConfig,
  SessionResolvedPayload,
  SessionTitleUpdatedPayload,
} from '../../../hooks/useChat'
import {
  deleteSession as deleteSessionByKey,
  fetchSessionHistoryView,
  fetchSessions,
  updateSessionTitle,
} from '../../../lib/session-api'
import {
  toChatMessagesFromHistoryView,
  toSessionListItemVm,
  type SessionListItemVm,
} from '../../../lib/session-management'
import { getPeerId, resetPeerId, setPeerId } from '../../../lib/session'

const STORAGE_KEYS = {
  modelConfig: 'webclaw.modelConfig',
  sidebarCollapsed: 'webclaw.sidebarCollapsed',
  themeMode: 'webclaw.themeMode',
  documentPanelWidth: 'webclaw.documentPanelWidth',
}

interface OpenDocument {
  key: string
  messageId: string
  attachmentIndex: number
  attachment: ChatAttachment
}

function loadModelConfig(): ModelConfig {
  const defaultThinking = createDefaultThinkingConfig()
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.modelConfig)
    if (!raw) {
      return { model: 'glm-4.7', temperature: 0.7, maxTokens: 8192, baseUrl: '', apiKey: '', enableTools: false, thinking: defaultThinking }
    }
    const parsed = JSON.parse(raw)
    return {
      model: parsed.model ?? 'glm-4.7',
      temperature: Number(parsed.temperature ?? 0.7),
      maxTokens: Number(parsed.maxTokens ?? 8192),
      baseUrl: parsed.baseUrl ?? '',
      apiKey: parsed.apiKey ?? '',
      enableTools: Boolean(parsed.enableTools ?? false),
      thinking: {
        enabled: Boolean(parsed.thinking?.enabled ?? defaultThinking.enabled),
        level: parsed.thinking?.level ?? defaultThinking.level,
        protocol: parsed.thinking?.protocol ?? defaultThinking.protocol,
      },
    }
  } catch {
    return { model: 'glm-4.7', temperature: 0.7, maxTokens: 8192, baseUrl: '', apiKey: '', enableTools: false, thinking: defaultThinking }
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function loadThemeMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.themeMode) === 'dark'
  } catch {
    return false
  }
}

function loadDocumentPanelWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.documentPanelWidth)
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 360) return clampDocumentPanelWidth(parsed)
  } catch {
    // noop
  }
  return 520
}

function clampDocumentPanelWidth(width: number): number {
  if (typeof window === 'undefined') return Math.max(360, width)
  const max = Math.max(420, Math.floor(window.innerWidth * 0.55))
  return Math.min(Math.max(360, width), max)
}

function toConversationItem(session: SessionListItemVm): ConversationItem {
  return {
    id: session.id,
    title: session.title,
    preview: session.preview,
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
  }
}

export function HomePageLayout() {
  const [activeView, setActiveView] = useState<'chat' | 'sessions'>('chat')
  const [sessionItems, setSessionItems] = useState<SessionListItemVm[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [activePeerId, setActivePeerId] = useState<string>(() => getPeerId())
  const [messageSeed, setMessageSeed] = useState<ChatMessage[]>([])
  const [messageVersion, setMessageVersion] = useState(0)
  const [isSessionListLoading, setIsSessionListLoading] = useState(true)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [chatDisabledReason, setChatDisabledReason] = useState<string | null>(null)

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDark, setIsDark] = useState<boolean>(() => loadThemeMode())
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => loadModelConfig())
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed())
  const [openDocument, setOpenDocument] = useState<OpenDocument | null>(null)
  const [documentPanelWidth, setDocumentPanelWidth] = useState<number>(() => loadDocumentPanelWidth())
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }

    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'

    const themeColor = isDark ? '#1f1f1f' : '#f6f6f7'
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', themeColor)
  }, [isDark])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.themeMode, isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.modelConfig, JSON.stringify(modelConfig))
  }, [modelConfig])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, isSidebarCollapsed ? '1' : '0')
  }, [isSidebarCollapsed])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.documentPanelWidth, String(documentPanelWidth))
  }, [documentPanelWidth])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
  }, [])

  const activeSession = useMemo(() => {
    const targetKey = selectedSessionKey ?? currentSessionKey
    return sessionItems.find((item) => item.id === targetKey) ?? null
  }, [currentSessionKey, selectedSessionKey, sessionItems])

  const conversationTitle = activeSession?.title ?? '新会话'
  const canSend = !isHistoryLoading && !chatDisabledReason
  const inputHint = isHistoryLoading ? '正在加载会话历史...' : chatDisabledReason

  const refreshSessions = async () => {
    setIsSessionListLoading(true)
    setSessionError(null)
    try {
      const rows = await fetchSessions()
      setSessionItems(rows.map(toSessionListItemVm))
    } catch {
      setSessionError('会话列表加载失败')
    } finally {
      setIsSessionListLoading(false)
    }
  }

  useEffect(() => {
    void refreshSessions()
  }, [])

  const replaceMessageSeed = (messages: ChatMessage[]) => {
    setMessageSeed(messages)
    setMessageVersion((prev) => prev + 1)
  }

  const handleStartNewConversation = () => {
    const nextPeerId = resetPeerId()
    setActivePeerId(nextPeerId)
    setActiveView('chat')
    setSelectedSessionKey(null)
    setCurrentSessionKey(null)
    setCurrentSessionId(null)
    setChatDisabledReason(null)
    setOpenDocument(null)
    replaceMessageSeed([])
  }

  const handleSelectConversation = async (sessionKey: string) => {
    const target = sessionItems.find((item) => item.id === sessionKey) ?? null
    setActiveView('chat')
    setSelectedSessionKey(sessionKey)
    setCurrentSessionKey(sessionKey)
    setCurrentSessionId(target?.sessionId ?? null)
    setChatDisabledReason(null)
    setOpenDocument(null)
    setIsHistoryLoading(true)
    setSessionError(null)

    try {
      const history = await fetchSessionHistoryView(sessionKey)
      replaceMessageSeed(toChatMessagesFromHistoryView(history.projection, history.entries))

      const peerId = target?.peerId ?? null
      if (!peerId) {
        setChatDisabledReason('当前会话无法恢复发送绑定，仅支持查看历史。')
        return
      }

      setPeerId(peerId)
      setActivePeerId(peerId)
    } catch {
      setSessionError('会话历史加载失败')
    } finally {
      setIsHistoryLoading(false)
    }
  }

  const handleRenameConversation = async (sessionKey: string) => {
    const current = sessionItems.find((item) => item.id === sessionKey)
    const nextTitle = window.prompt('输入新的会话标题', current?.title ?? '')
    if (!nextTitle || nextTitle.trim() === (current?.title ?? '').trim()) return

    try {
      const updated = await updateSessionTitle(sessionKey, nextTitle)
      setSessionItems((prev) =>
        prev.map((item) =>
          item.id === sessionKey
            ? {
                ...item,
                title: updated.title?.trim() || item.title,
              }
            : item,
        ),
      )
    } catch {
      setSessionError('重命名会话失败')
    }
  }

  const handleDeleteConversation = async (sessionKey: string) => {
    const confirmed = window.confirm('删除后将清空该会话的历史记录，确定继续吗？')
    if (!confirmed) return

    try {
      await deleteSessionByKey(sessionKey)
      setSessionItems((prev) => prev.filter((item) => item.id !== sessionKey))

      if (selectedSessionKey === sessionKey || currentSessionKey === sessionKey) {
        handleStartNewConversation()
      }
    } catch {
      setSessionError('删除会话失败')
    }
  }

  const handleSessionResolved = (payload: SessionResolvedPayload) => {
    setCurrentSessionKey(payload.sessionKey)
    setCurrentSessionId(payload.sessionId)
    setSelectedSessionKey(payload.sessionKey)
    void refreshSessions()
  }

  const handleSessionTitleUpdated = (payload: SessionTitleUpdatedPayload) => {
    setSessionItems((prev) =>
      prev.map((item) =>
        item.id === payload.sessionKey
          ? {
              ...item,
              title: payload.title || item.title,
            }
          : item,
      ),
    )
  }

  const handleChatLifecycleEvent = (event: 'run_completed' | 'run_paused' | 'run_failed') => {
    if (event === 'run_completed' || event === 'run_paused') {
      void refreshSessions()
    }
  }

  const sidebarItems = useMemo(() => sessionItems.map(toConversationItem), [sessionItems])
  const sessionMetaText = currentSessionId ? `会话 ID: ${currentSessionId}` : null
  const showDocumentWorkspace = Boolean(openDocument)

  const handleOpenAttachment = (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => {
    setIsSettingsOpen(false)
    setIsSidebarCollapsed(true)
    if (!openDocument) {
      setDocumentPanelWidth(clampDocumentPanelWidth(Math.floor((window.innerWidth - 64) / 2)))
    }
    setOpenDocument({
      key: `${messageId}:${attachmentIndex}`,
      messageId,
      attachmentIndex,
      attachment,
    })
  }

  const handleCloseDocument = () => {
    setOpenDocument(null)
  }

  const handleSettingsToggle = () => {
    setIsSettingsOpen((prev) => {
      const next = !prev
      if (next) {
        setOpenDocument(null)
      }
      return next
    })
  }

  const handleDocumentResizeStart = (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMove = (moveEvent: PointerEvent | MouseEvent) => {
      setDocumentPanelWidth(clampDocumentPanelWidth(window.innerWidth - moveEvent.clientX))
    }

    const stop = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', stop)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      resizeCleanupRef.current = null
    }

    resizeCleanupRef.current?.()
    resizeCleanupRef.current = stop
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', stop)
  }

  return (
    <div
      className={[
        'flex h-screen w-screen overflow-hidden',
        'bg-surface-alt text-text-primary font-sans',
        'transition-colors duration-300',
      ].join(' ')}
    >
      <ConversationSidebar
        conversations={sidebarItems}
        activeConversationId={selectedSessionKey}
        activeView={activeView}
        collapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onCreateConversation={handleStartNewConversation}
        onOpenSessions={() => {
          setOpenDocument(null)
          setActiveView('sessions')
        }}
        onSelectConversation={(conversationId) => {
          void handleSelectConversation(conversationId)
        }}
        onRenameConversation={(conversationId) => {
          void handleRenameConversation(conversationId)
        }}
        onDeleteConversation={(conversationId) => {
          void handleDeleteConversation(conversationId)
        }}
        isLoading={isSessionListLoading}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {sessionError && (
          <div className="shrink-0 border-b border-border bg-surface px-4 py-2 text-xs text-text-muted">
            {sessionError}
          </div>
        )}
        {activeView === 'sessions' ? (
          <ChatsOverview
            conversations={sidebarItems}
            onCreateConversation={handleStartNewConversation}
            onSelectConversation={(conversationId) => {
              void handleSelectConversation(conversationId)
            }}
          />
        ) : showDocumentWorkspace && openDocument ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <header className="h-12 shrink-0 bg-surface-alt/95 backdrop-blur">
              <div className="flex h-full w-full items-center justify-between px-4 md:px-6">
                <div className="min-w-0 flex items-center gap-3">
                  <h1 className="line-clamp-1 text-sm font-medium text-text-primary">{conversationTitle}</h1>
                  {sessionMetaText && (
                    <div className="shrink-0 text-xs text-text-muted">
                      {sessionMetaText}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDark((prev) => !prev)}
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
                    onClick={handleSettingsToggle}
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

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <ConversationArea
                  onSettingsToggle={handleSettingsToggle}
                  isDark={isDark}
                  onThemeToggle={() => setIsDark((prev) => !prev)}
                  modelConfig={modelConfig}
                  conversationTitle={conversationTitle}
                  sessionMetaText={sessionMetaText}
                  peerId={activePeerId}
                  currentSessionKey={selectedSessionKey ?? currentSessionKey}
                  externalMessages={messageSeed}
                  messageVersion={messageVersion}
                  canSend={canSend}
                  disabledReason={inputHint}
                  onSessionResolved={handleSessionResolved}
                  onSessionTitleUpdated={handleSessionTitleUpdated}
                  onChatLifecycleEvent={handleChatLifecycleEvent}
                  onOpenAttachment={handleOpenAttachment}
                  activeAttachmentKey={openDocument.key}
                  showHeader={false}
                  workspaceMode="split"
                />
              </div>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="调整文档面板宽度"
                onPointerDown={handleDocumentResizeStart}
                onMouseDown={handleDocumentResizeStart}
                className="group relative hidden w-5 shrink-0 cursor-col-resize bg-transparent md:block"
                style={{ touchAction: 'none' }}
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-[color:var(--border-strong)]" />
                <div className="absolute left-1/2 top-1/2 h-14 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/70 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.14)] transition-transform group-hover:scale-105 dark:bg-surface" />
              </div>
              <DocumentPanel
                document={openDocument}
                width={documentPanelWidth}
                onClose={handleCloseDocument}
              />
            </div>
          </div>
        ) : (
          <ConversationArea
            onSettingsToggle={handleSettingsToggle}
            isDark={isDark}
            onThemeToggle={() => setIsDark((prev) => !prev)}
            modelConfig={modelConfig}
            conversationTitle={conversationTitle}
            sessionMetaText={sessionMetaText}
            peerId={activePeerId}
            currentSessionKey={selectedSessionKey ?? currentSessionKey}
            externalMessages={messageSeed}
            messageVersion={messageVersion}
            canSend={canSend}
            disabledReason={inputHint}
            onSessionResolved={handleSessionResolved}
            onSessionTitleUpdated={handleSessionTitleUpdated}
            onChatLifecycleEvent={handleChatLifecycleEvent}
            onOpenAttachment={handleOpenAttachment}
            activeAttachmentKey={null}
            showHeader
            workspaceMode="default"
          />
        )}
      </div>
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        modelConfig={modelConfig}
        onModelConfigChange={setModelConfig}
      />
    </div>
  )
}
