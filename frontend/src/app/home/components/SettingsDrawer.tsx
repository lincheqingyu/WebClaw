import { X, Plus, Trash2, Save } from 'lucide-react'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import type { ModelConfig } from '../../../hooks/useChat'

interface SystemPromptItem {
    id: string
    title: string
    prompt: string
}

/**
 * SettingsDrawer 的 Props
 *
 * 注意这里比之前多了两个属性：isDark 和 onThemeToggle
 * → 这是因为我们把"主题切换按钮"放在了设置抽屉里
 */
interface SettingsDrawerProps {
    isOpen: boolean
    onClose: () => void
    isDark: boolean               // 当前是否是暗色模式
    onThemeToggle: () => void     // 切换主题的回调
    systemPrompts: SystemPromptItem[]
    activePromptId: string | null
    onSystemPromptsChange: (items: SystemPromptItem[]) => void
    onActivePromptChange: (id: string | null) => void
    modelConfig: ModelConfig
    onModelConfigChange: (config: ModelConfig) => void
}

/**
 * 设置抽屉
 *
 * 动画原理：
 * → 抽屉始终在 DOM 中（不会被销毁/创建）
 * → 通过 translate-x-full（向右移出屏幕）和 translate-x-0（回到原位）来控制显隐
 * → transition-transform 让位移带有平滑动画
 * → 这比 display:none 的方式性能更好，因为 GPU 可以加速 transform 动画
 */
export function SettingsDrawer({
                                   isOpen,
                                   onClose,
                                   systemPrompts,
                                   activePromptId,
                                   onSystemPromptsChange,
                                   onActivePromptChange,
                                   modelConfig,
                                   onModelConfigChange,
                               }: SettingsDrawerProps) {
    const activePrompt = useMemo(
        () => systemPrompts.find((p) => p.id === activePromptId) ?? null,
        [systemPrompts, activePromptId],
    )

    const [draftTitle, setDraftTitle] = useState('')
    const [draftPrompt, setDraftPrompt] = useState('')

    useEffect(() => {
        setDraftTitle(activePrompt?.title ?? '')
        setDraftPrompt(activePrompt?.prompt ?? '')
    }, [activePrompt?.id])

    const handleNewPrompt = () => {
        onActivePromptChange(null)
        setDraftTitle('')
        setDraftPrompt('')
    }

    const handleSavePrompt = () => {
        if (!draftTitle.trim() && !draftPrompt.trim()) return
        if (activePrompt) {
            onSystemPromptsChange(
                systemPrompts.map((p) =>
                    p.id === activePrompt.id ? { ...p, title: draftTitle, prompt: draftPrompt } : p,
                ),
            )
        } else {
            const id = `prompt_${Date.now()}`
            onSystemPromptsChange([
                ...systemPrompts,
                { id, title: draftTitle || '未命名', prompt: draftPrompt },
            ])
            onActivePromptChange(id)
        }
    }

    const handleDeletePrompt = () => {
        if (!activePrompt) return
        onSystemPromptsChange(systemPrompts.filter((p) => p.id !== activePrompt.id))
        onActivePromptChange(null)
        setDraftTitle('')
        setDraftPrompt('')
    }

    const updateModelConfig = (partial: Partial<ModelConfig>) => {
        onModelConfigChange({ ...modelConfig, ...partial })
    }

    return (
        <div
            className={clsx(
                // 定位：固定在视口右侧
                // 尺寸：占满高度，宽 320px
                "h-screen w-80 shrink-0",
                // 外观：背景 + 左侧边框
                "border-l border-border bg-surface",
                // 动画：平滑滑入/滑出
                "transition-transform duration-300 ease-in-out",
                // 条件样式：clsx 的核心价值 ——
                // 比模板字符串里写三元表达式更清晰
                isOpen ? "mr-0" : "-mr-80"
            )}
        >
            {/* ---------- 抽屉头部 ---------- */}
            <div
                className={[
                    "flex items-center justify-between",
                    "border-b border-border px-6 py-4",
                ].join(" ")}
            >
                <h2 className="text-lg font-semibold text-text-primary">设置</h2>
                <button
                    type="button"
                    onClick={onClose}
                    className={[
                        "flex items-center justify-center",
                        "size-8 rounded",
                        "text-text-secondary",
                        "transition-colors hover:bg-hover hover:text-text-primary",
                    ].join(" ")}
                    aria-label="关闭设置"
                >
                    <X className="size-5" />
                </button>
            </div>

            {/* ---------- 抽屉内容 ---------- */}
            <div className="p-6">

                {/* System Prompt 配置 */}
                <div className="mt-8">
                    <div className="mb-3 text-sm font-semibold text-text-primary">System Prompt</div>
                    <div className="rounded-2xl border border-border bg-surface-alt p-4">
                        <div className="flex items-center gap-2">
                            <select
                                value={activePromptId ?? ''}
                                onChange={(e) => onActivePromptChange(e.target.value || null)}
                                className="flex-1 rounded-md border border-border bg-surface px-2 py-2 text-sm text-text-primary"
                            >
                                <option value="">新建提示词…</option>
                                {systemPrompts.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.title}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={handleNewPrompt}
                                className="rounded-md border border-border bg-surface px-2 py-2 text-text-secondary"
                                aria-label="新建提示词"
                            >
                                <Plus className="size-4" />
                            </button>
                        </div>

                        <div className="mt-3">
                            <label className="text-xs text-text-muted">标题</label>
                            <input
                                value={draftTitle}
                                onChange={(e) => setDraftTitle(e.target.value)}
                                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                                placeholder="例如：SQL 查询助手"
                            />
                        </div>

                        <div className="mt-3">
                            <label className="text-xs text-text-muted">提示词</label>
                            <textarea
                                value={draftPrompt}
                                onChange={(e) => setDraftPrompt(e.target.value)}
                                rows={6}
                                className="mt-1 w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                                placeholder="请输入 system prompt"
                            />
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSavePrompt}
                                className="flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-xs text-white"
                            >
                                <Save className="size-3" />
                                保存
                            </button>
                            <button
                                type="button"
                                onClick={handleDeletePrompt}
                                className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-text-secondary"
                            >
                                <Trash2 className="size-3" />
                                删除
                            </button>
                        </div>
                    </div>
                </div>

                {/* 模型参数配置 */}
                <div className="mt-8">
                    <div className="mb-3 text-sm font-semibold text-text-primary">模型参数</div>
                    <div className="grid gap-3 rounded-2xl border border-border bg-surface-alt p-4">
                        <div>
                            <label className="text-xs text-text-muted">Model</label>
                            <input
                                value={modelConfig.model}
                                onChange={(e) => updateModelConfig({ model: e.target.value })}
                                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                                placeholder="glm-4.7"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-text-muted">Temperature</label>
                            <input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                value={modelConfig.temperature}
                                onChange={(e) =>
                                    updateModelConfig({ temperature: Number(e.target.value) })
                                }
                                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-text-muted">Max Tokens</label>
                            <input
                                type="number"
                                min={1}
                                step={1}
                                value={modelConfig.maxTokens}
                                onChange={(e) =>
                                    updateModelConfig({ maxTokens: Number(e.target.value) })
                                }
                                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
