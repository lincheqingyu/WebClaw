import { useState, useEffect, useMemo } from 'react'
import { ConversationArea } from './ConversationArea'
import { SettingsDrawer } from './SettingsDrawer'
import {
  ConversationSidebar,
  type ConversationItem,
} from './ConversationSidebar'
import type { ModelConfig } from '../../../hooks/useChat'

interface SystemPromptItem {
    id: string
    title: string
    prompt: string
}

const STORAGE_KEYS = {
  prompts: 'webclaw.systemPrompts',
  activePromptId: 'webclaw.activePromptId',
  modelConfig: 'webclaw.modelConfig',
  conversations: 'webclaw.conversations',
  activeConversationId: 'webclaw.activeConversationId',
  sidebarCollapsed: 'webclaw.sidebarCollapsed',
}

function loadPrompts(): SystemPromptItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.prompts)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadActivePromptId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.activePromptId)
  } catch {
    return null
  }
}

function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.modelConfig)
    if (!raw) {
      return { model: 'glm-4.7', temperature: 0.7, maxTokens: 8192, baseUrl: '', apiKey: '', enableTools: false }
    }
    const parsed = JSON.parse(raw)
    return {
      model: parsed.model ?? 'glm-4.7',
      temperature: Number(parsed.temperature ?? 0.7),
      maxTokens: Number(parsed.maxTokens ?? 8192),
      baseUrl: parsed.baseUrl ?? '',
      apiKey: parsed.apiKey ?? '',
      enableTools: Boolean(parsed.enableTools ?? false),
    }
  } catch {
    return { model: 'glm-4.7', temperature: 0.7, maxTokens: 8192, baseUrl: '', apiKey: '', enableTools: false }
  }
}

function createPeerId() {
  return `peer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function createConversation(title = '新会话'): ConversationItem {
  const now = Date.now()
  return {
    id: `conv_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    preview: '开始一段新的对话',
    peerId: createPeerId(),
    updatedAt: now,
  }
}

function loadConversations(): ConversationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.conversations)
    if (!raw) return [createConversation()]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createConversation()]
    }

    const normalized = parsed
      .filter((item: unknown) => typeof item === 'object' && item !== null)
      .map((item) => {
        const candidate = item as Partial<ConversationItem>
        return {
          id: candidate.id || `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: candidate.title?.trim() || '新会话',
          preview: candidate.preview?.trim() || '开始一段新的对话',
          peerId: candidate.peerId?.trim() || createPeerId(),
          updatedAt: Number(candidate.updatedAt) || Date.now(),
        }
      })

    return normalized.length > 0 ? normalized : [createConversation()]
  } catch {
    return [createConversation()]
  }
}

function loadActiveConversationId(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.activeConversationId)
    return raw ?? ''
  } catch {
    return ''
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

function deriveTitleFromMessage(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新会话'
  const snippet = normalized.slice(0, 18)
  return normalized.length > 18 ? `${snippet}...` : snippet
}

/**
 * 主布局容器
 *
 * 职责：
 * 1. 管理设置抽屉的开关状态（isSettingsOpen）
 * 2. 管理亮/暗色主题切换（isDark）
 * 3. 用 Flexbox 横向排列：对话区域 | 设置抽屉
 */
export function HomePageLayout() {
  const [conversations, setConversations] = useState<ConversationItem[]>(() => loadConversations())
  const [activeConversationId, setActiveConversationId] = useState<string>(() => loadActiveConversationId())
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed())

  // ---------- 状态管理 ----------
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [systemPrompts, setSystemPrompts] = useState<SystemPromptItem[]>(() => loadPrompts())
  const [activePromptId, setActivePromptId] = useState<string | null>(() => loadActivePromptId())
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => loadModelConfig())

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.prompts, JSON.stringify(systemPrompts))
  }, [systemPrompts])

  useEffect(() => {
    if (activePromptId) {
      localStorage.setItem(STORAGE_KEYS.activePromptId, activePromptId)
    } else {
      localStorage.removeItem(STORAGE_KEYS.activePromptId)
    }
  }, [activePromptId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.modelConfig, JSON.stringify(modelConfig))
  }, [modelConfig])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activeConversationId, activeConversationId)
  }, [activeConversationId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, isSidebarCollapsed ? '1' : '0')
  }, [isSidebarCollapsed])

  useEffect(() => {
    if (conversations.length === 0) {
      const initial = createConversation()
      setConversations([initial])
      setActiveConversationId(initial.id)
      return
    }
    const exists = conversations.some((item) => item.id === activeConversationId)
    if (!exists) {
      setActiveConversationId(conversations[0].id)
    }
  }, [activeConversationId, conversations])

  const activePrompt = useMemo(() => {
    return systemPrompts.find((p) => p.id === activePromptId) ?? null
  }, [systemPrompts, activePromptId])

  const activeConversation = useMemo(() => {
    return conversations.find((item) => item.id === activeConversationId) ?? conversations[0]
  }, [conversations, activeConversationId])

  const handleSettingsToggle = () => {
    setIsSettingsOpen((prev) => !prev)
  }

  const handleSettingsClose = () => {
    setIsSettingsOpen(false)
  }

  const handleThemeToggle = () => {
    setIsDark((prev) => !prev)
  }

  const handleCreateConversation = () => {
    const next = createConversation()
    setConversations((prev) => [next, ...prev])
    setActiveConversationId(next.id)
  }

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId)
  }

  const handleDeleteConversation = (conversationId: string) => {
    const filtered = conversations.filter((item) => item.id !== conversationId)
    if (filtered.length === 0) {
      const created = createConversation()
      setConversations([created])
      setActiveConversationId(created.id)
      return
    }
    setConversations(filtered)
    if (activeConversationId === conversationId) {
      setActiveConversationId(filtered[0].id)
    }
  }

  const handleConversationActivity = (content: string) => {
    if (!activeConversation) return
    const title = deriveTitleFromMessage(content)
    const preview = content.replace(/\s+/g, ' ').trim().slice(0, 40)
    setConversations((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== activeConversation.id) return item
        return {
          ...item,
          title: item.title === '新会话' ? title : item.title,
          preview: preview || item.preview,
          updatedAt: Date.now(),
        }
      })
      return updated.sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }

  if (!activeConversation) return null

  return (
    <div
      className={[
        'flex h-screen w-screen overflow-hidden',
        'bg-surface-alt text-text-primary font-sans',
        'transition-colors duration-300',
      ].join(' ')}
    >
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversation.id}
        collapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onCreateConversation={handleCreateConversation}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
      />
      <ConversationArea
        key={activeConversation.id}
        onSettingsToggle={handleSettingsToggle}
        isDark={isDark}
        onThemeToggle={handleThemeToggle}
        systemPrompt={activePrompt?.prompt ?? ''}
        modelConfig={modelConfig}
        conversationTitle={activeConversation.title}
        peerId={activeConversation.peerId}
        onConversationActivity={handleConversationActivity}
      />
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={handleSettingsClose}
        systemPrompts={systemPrompts}
        activePromptId={activePromptId}
        onSystemPromptsChange={setSystemPrompts}
        onActivePromptChange={setActivePromptId}
        modelConfig={modelConfig}
        onModelConfigChange={setModelConfig}
      />
    </div>
  )
}
