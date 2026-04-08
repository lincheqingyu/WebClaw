import clsx from 'clsx'
import { FileText, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import { AutoResizeTextarea } from './AutoResizeTextarea'
import { CategoryTags } from './CategoryTags'
import type { ChatMode } from '../../hooks/useChat'
import { buildAttachmentPreviewUrl, readChatAttachment } from '../../lib/chat-attachments'

const FILE_INPUT_ACCEPT = 'image/*,.txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.mjs,.cjs,.sql,.yaml,.yml,.xml,.html,.css,.scss,.log,.pdf,.docx,.xlsx,.xls'

export interface ChatInputSubmitPayload {
  message: string
  attachments: ChatAttachment[]
}

interface ChatInputProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (payload: ChatInputSubmitPayload) => void
  showSuggestions?: boolean
  disabled?: boolean
  disabledReason?: string | null
  rightSlot?: ReactNode
}

/**
 * 聊天输入框编排组件
 *
 * 管理输入状态，组合 AutoResizeTextarea + InputToolbar + CategoryTags。
 * 容器采用圆角 + 阴影样式，hover/focus-within 时阴影增强。
 */
export function ChatInput({
  mode,
  onModeChange,
  onSend,
  showSuggestions = true,
  disabled = false,
  disabledReason = null,
  rightSlot,
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [isMultiline, setIsMultiline] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isReadingAttachments, setIsReadingAttachments] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const previewAttachments = useMemo(() => attachments.map((attachment) => ({
    attachment,
    previewUrl: buildAttachmentPreviewUrl(attachment),
  })), [attachments])

  /** 发送消息（暂时为空操作，后续接入） */
  const handleSend = () => {
    if (disabled || (!message.trim() && attachments.length === 0)) return
    onSend({
      message,
      attachments,
    })
    setMessage('')
    setIsMultiline(false)
    setAttachments([])
    setAttachmentError(null)
  }

  const handlePlusClick = () => {
    if (disabled) return
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (nextFiles.length === 0) return

    setIsReadingAttachments(true)
    setAttachmentError(null)

    try {
      const parsed = await Promise.all(nextFiles.map((file) => readChatAttachment(file)))
      setAttachments((prev) => [...prev, ...parsed])
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '读取附件失败')
    } finally {
      setIsReadingAttachments(false)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, currentIndex) => currentIndex !== index))
  }

  /** 点击分类标签（暂时填入输入框，后续接入） */
  const handleCategorySelect = (label: string) => {
    // TODO: 接入分类逻辑
    setMessage(label)
  }

  const toggleThinking = () => {
    onModeChange(mode === 'plan' ? 'simple' : 'plan')
  }

  const compact = !showSuggestions
  const showExpanded = isMultiline || attachments.length > 0
  const planBadge = mode === 'plan' ? (
        <button
      type="button"
      onClick={() => onModeChange('simple')}
      className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface-alt px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
      aria-label="关闭 plan 模式"
    >
      plan
    </button>
  ) : null

  useEffect(() => {
    if (!message && attachments.length === 0) {
      setIsMultiline(false)
    }
  }, [attachments.length, message])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={FILE_INPUT_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
      <div
        className={clsx(
          'relative border border-border bg-surface',
          showExpanded ? 'rounded-[20px]' : compact ? 'rounded-full' : 'rounded-[20px]',
          'shadow-[var(--shadow-input)]',
          'transition-shadow duration-200',
          disabled ? 'opacity-60' : 'hover:shadow-[var(--shadow-input-hover)]',
          !disabled && 'focus-within:shadow-[var(--shadow-input-hover)]',
        )}
      >
        {showExpanded ? (
          <div className={clsx('px-3 pt-3 pb-2')}>
            {attachments.length > 0 && (
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {previewAttachments.map(({ attachment, previewUrl }, index) => (
                    attachment.kind === 'image' ? (
                      <div
                        key={`${attachment.name}_${index}`}
                        className="group relative h-20 w-20 overflow-hidden rounded-2xl border border-border bg-surface-thought shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                      >
                        <img
                          src={previewUrl ?? ''}
                          alt={attachment.name}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(index)}
                          className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-full bg-surface/90 text-text-primary backdrop-blur transition-colors hover:bg-surface dark:text-white"
                          aria-label={`移除附件 ${attachment.name}`}
                        >
                          <X className="size-3.5" />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2 py-1 text-[11px] text-white">
                          <div className="truncate">{attachment.name}</div>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={`${attachment.name}_${index}`}
                        className="group relative flex min-w-[11rem] max-w-[15rem] items-start gap-3 rounded-2xl border border-border bg-surface-thought px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
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
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(index)}
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-hover hover:text-text-primary dark:text-white"
                          aria-label={`移除附件 ${attachment.name}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            <AutoResizeTextarea
              value={message}
              onChange={setMessage}
              onSend={handleSend}
              onToggleThinking={toggleThinking}
              maxRows={10}
              onLayoutChange={({ multiline }) => setIsMultiline(multiline)}
              className={clsx('px-1 py-0', 'max-h-[15rem] min-h-8')}
              disabled={disabled}
            />
            <div className="mt-1 flex h-8 items-center justify-between px-1">
              <button
                type="button"
                onClick={handlePlusClick}
                className={clsx(
                  'flex shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5',
                  'h-7 text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
                )}
                aria-label="添加附件"
                disabled={disabled || isReadingAttachments}
              >
                <Plus className="size-4" />
                <span className="text-xs font-medium">{isReadingAttachments ? '读取中...' : '附件'}</span>
              </button>
              <div className="flex items-center gap-2">
                {planBadge}
                {rightSlot && <div className="shrink-0">{rightSlot}</div>}
              </div>
            </div>
          </div>
        ) : (
          <div className={clsx('flex items-center gap-2', compact ? 'px-4 py-2' : 'px-3 py-3')}>
            <button
              type="button"
              onClick={handlePlusClick}
              className={clsx(
                'flex shrink-0 items-center justify-center',
                'size-8 rounded-full',
                'text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
              )}
              aria-label="添加附件"
              disabled={disabled || isReadingAttachments}
            >
              <Plus className="size-4" />
            </button>
            {planBadge}

            <AutoResizeTextarea
              value={message}
              onChange={setMessage}
              onSend={handleSend}
              onToggleThinking={toggleThinking}
              maxRows={10}
              onLayoutChange={({ multiline }) => setIsMultiline(multiline)}
              className={clsx('px-1 py-1', 'max-h-[15rem] min-h-8')}
              disabled={disabled}
            />
            {rightSlot && <div className="shrink-0">{rightSlot}</div>}
          </div>
        )}
      </div>

      {attachmentError && (
        <div className="mt-2 text-center text-xs text-rose-500">
          {attachmentError}
        </div>
      )}

      {disabledReason && (
        <div className="mt-2 text-center text-xs text-text-muted">
          {disabledReason}
        </div>
      )}

      {/* 分类标签（输入框下方） */}
      {showSuggestions && <CategoryTags onSelect={handleCategorySelect} />}
    </div>
  )
}
