import clsx from 'clsx'
import { useState } from 'react'
import { AutoResizeTextarea } from './AutoResizeTextarea'
import { CategoryTags } from './CategoryTags'
import { InputToolbar } from './InputToolbar'
import type { ChatMode } from '../../hooks/useChat'

interface ChatInputProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (message: string) => void
  showSuggestions?: boolean
}

/**
 * 聊天输入框编排组件
 *
 * 管理输入状态，组合 AutoResizeTextarea + InputToolbar + CategoryTags。
 * 容器采用圆角 + 阴影样式，hover/focus-within 时阴影增强。
 */
export function ChatInput({ mode, onModeChange, onSend, showSuggestions = true }: ChatInputProps) {
  const [message, setMessage] = useState('')

  const hasContent = message.trim().length > 0

  /** 发送消息（暂时为空操作，后续接入） */
  const handleSend = () => {
    if (!hasContent) return
    onSend(message)
    setMessage('')
  }

  /** 点击加号按钮（暂时为空操作，后续接入） */
  const handlePlusClick = () => {
    // TODO: 接入附件/功能菜单
  }

  /** 点击分类标签（暂时填入输入框，后续接入） */
  const handleCategorySelect = (label: string) => {
    // TODO: 接入分类逻辑
    setMessage(label)
  }

  const toggleThinking = () => {
    onModeChange(mode === 'thinking' ? 'simple' : 'thinking')
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      <div
        className={clsx(
          'rounded-[20px] border border-border bg-surface',
          'shadow-[var(--shadow-input)]',
          'transition-shadow duration-200',
          'hover:shadow-[var(--shadow-input-hover)]',
          'focus-within:shadow-[var(--shadow-input-hover)]',
        )}
      >
        {/* 文本输入区域 */}
        <AutoResizeTextarea
          value={message}
          onChange={setMessage}
          onSend={handleSend}
          onToggleThinking={toggleThinking}
        />

        {/* 底部工具栏 */}
        <InputToolbar
          hasContent={hasContent}
          mode={mode}
          onModeChange={onModeChange}
          onPlusClick={handlePlusClick}
          onSend={handleSend}
        />
      </div>

      {/* 分类标签（输入框下方） */}
      {showSuggestions && <CategoryTags onSelect={handleCategorySelect} />}
    </div>
  )
}
