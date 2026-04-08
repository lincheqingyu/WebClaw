import {ChevronDown, Trash2, X} from 'lucide-react'
import {clsx} from 'clsx'
import {useCallback, useEffect, useRef, useState} from 'react'
import {createDefaultThinkingConfig, type ThinkingConfig, type ThinkingProtocol} from '@lecquy/shared'
import type {ModelConfig} from '../../../hooks/useChat'
import {API_V1} from '../../../config/api.ts'
import {
    fetchContextFiles,
    fetchMemoryFileContent,
    fetchMemoryFiles,
    fetchMemoryRuntimeConfig,
    saveMemoryRuntimeConfig,
    updateContextFile,
    type ContextFileName,
    type ContextFileRecord,
    type MemoryFileMeta,
    type MemoryRuntimeConfig,
} from '../../../lib/context-api.ts'

interface ModelPresetItem {
    id: string
    model: string
    baseUrl: string
    apiKey: string
    title?: string
}

/**
 * SettingsDrawer 的 Props
 *
 */
interface SettingsDrawerProps {
    isOpen: boolean
    onClose: () => void
    modelConfig: ModelConfig
    onModelConfigChange: (config: ModelConfig) => void
}

type InlineDropdownId = 'maxTokens' | 'thinkingProtocol' | 'thinkingLevel'
type EditableContextFileName = Extract<ContextFileName, 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.md'>
type ManagedContextFileName = Extract<ContextFileName, 'AGENTS.md' | 'TOOLS.md'>

const MODEL_PRESET_STORAGE_KEY = 'lecquy.modelPresets'
const ACTIVE_MODEL_PRESET_STORAGE_KEY = 'lecquy.activeModelPresetId'
const EDITABLE_CONTEXT_FILES: ReadonlyArray<{
    name: EditableContextFileName
    title: string
    summary: string
}> = [
    {name: 'SOUL.md', title: 'Soul', summary: '助手气质与表达风格'},
    {name: 'IDENTITY.md', title: 'Identity', summary: '角色定位与能力边界'},
    {name: 'USER.md', title: 'User', summary: '用户背景、偏好与约定'},
    {name: 'MEMORY.md', title: 'Memory', summary: '长期记忆与运行配置'},
] as const
const MANAGED_CONTEXT_FILES: ReadonlyArray<{name: ManagedContextFileName; title: string}> = [
    {name: 'AGENTS.md', title: 'AGENTS.md'},
    {name: 'TOOLS.md', title: 'TOOLS.md'},
] as const

function loadModelPresetsFromStorage(): ModelPresetItem[] {
    try {
        const raw = localStorage.getItem(MODEL_PRESET_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function loadActiveModelPresetIdFromStorage(): string | null {
    try {
        return localStorage.getItem(ACTIVE_MODEL_PRESET_STORAGE_KEY)
    } catch {
        return null
    }
}

function getModelPresetLabel(item: ModelPresetItem | null | undefined): string {
    if (!item) return ''
    const modelLabel = item?.model?.trim()
    if (modelLabel) return modelLabel
    const legacyTitle = item?.title?.trim()
    if (legacyTitle) return legacyTitle
    return 'Untitled model'
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
                                   modelConfig,
                                   onModelConfigChange,
                               }: SettingsDrawerProps) {
    const NEW_MODEL_PRESET_VALUE = '__new_model__'

    const [isContextPanelOpen, setIsContextPanelOpen] = useState(false)
    const [isModelOptionsOpen, setIsModelOptionsOpen] = useState(false)
    const [activeInlineDropdown, setActiveInlineDropdown] = useState<InlineDropdownId | null>(null)
    const [isModelPanelOpen, setIsModelPanelOpen] = useState(false)
    const [selectedContextFile, setSelectedContextFile] = useState<EditableContextFileName>('SOUL.md')
    const [selectedManagedFile, setSelectedManagedFile] = useState<ManagedContextFileName | null>(null)
    const [contextFiles, setContextFiles] = useState<Record<ContextFileName, ContextFileRecord | undefined>>({
        'SOUL.md': undefined,
        'IDENTITY.md': undefined,
        'USER.md': undefined,
        'MEMORY.md': undefined,
        'AGENTS.md': undefined,
        'TOOLS.md': undefined,
    })
    const [contextDrafts, setContextDrafts] = useState<Record<EditableContextFileName, string>>({
        'SOUL.md': '',
        'IDENTITY.md': '',
        'USER.md': '',
        'MEMORY.md': '',
    })
    const [contextSaveStatus, setContextSaveStatus] = useState<'Saved' | 'Editing'>('Saved')
    const [contextLoading, setContextLoading] = useState(false)
    const [contextError, setContextError] = useState<string | null>(null)
    const [modelPresets, setModelPresets] = useState<ModelPresetItem[]>(() => loadModelPresetsFromStorage())
    const [selectedModelPresetId, setSelectedModelPresetId] = useState<string>(() => {
        return loadActiveModelPresetIdFromStorage() ?? NEW_MODEL_PRESET_VALUE
    })
    const [draftModel, setDraftModel] = useState('')
    const [draftBaseUrl, setDraftBaseUrl] = useState('')
    const [draftApiKey, setDraftApiKey] = useState('')
    const [modelSaveStatus, setModelSaveStatus] = useState<'Saved' | 'Editing'>('Saved')
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const fetchAbortRef = useRef<AbortController | null>(null)
    const settingsScrollRef = useRef<HTMLDivElement | null>(null)
    const maxTokensDropdownRef = useRef<HTMLDivElement | null>(null)
    const thinkingProtocolDropdownRef = useRef<HTMLDivElement | null>(null)
    const thinkingLevelDropdownRef = useRef<HTMLDivElement | null>(null)
    const [memoryConfig, setMemoryConfig] = useState<MemoryRuntimeConfig>({flushTurns: 20, embeddingBaseUrl: ''})
    const [memoryDraftConfig, setMemoryDraftConfig] = useState<MemoryRuntimeConfig>({flushTurns: 20, embeddingBaseUrl: ''})
    const [memoryFiles, setMemoryFiles] = useState<MemoryFileMeta[]>([])
    const [selectedMemoryFile, setSelectedMemoryFile] = useState<string | null>(null)
    const [selectedMemoryContent, setSelectedMemoryContent] = useState('')
    const [memorySaveStatus, setMemorySaveStatus] = useState<'Saved' | 'Editing'>('Saved')
    const thinkingConfig = modelConfig.thinking ?? createDefaultThinkingConfig()

    const resetDrawerPanels = useCallback(() => {
        setIsContextPanelOpen(false)
        setIsModelPanelOpen(false)
        setIsModelOptionsOpen(false)
        setActiveInlineDropdown(null)
        setSelectedContextFile('SOUL.md')
        setSelectedManagedFile(null)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
        setContextError(null)
    }, [])

    const updateModelConfig = (partial: Partial<ModelConfig>) => {
        onModelConfigChange({...modelConfig, ...partial})
    }

    const updateThinkingConfig = (partial: Partial<ThinkingConfig>) => {
        updateModelConfig({
            thinking: {
                ...thinkingConfig,
                ...partial,
            },
        })
    }

    /** 从 vLLM /v1/models 接口获取模型名称 */
    const fetchModelName = useCallback(async (baseUrl: string, apiKey: string, signal: AbortSignal) => {
        setModelsLoading(true)
        setModelsError(null)
        try {
            const response = await fetch(`${API_V1}/models/list`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({baseUrl, apiKey: apiKey || undefined}),
                signal,
            })
            if (!response.ok) {
                const text = await response.text().catch(() => '')
                throw new Error(text || `请求失败: ${response.status}`)
            }
            const json = await response.json() as { success: boolean; data?: { data?: Array<{ id: string }> } }
            const modelId = json?.data?.data?.[0]?.id
            if (!modelId) {
                throw new Error('未找到可用模型')
            }
            return modelId
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            const msg = error instanceof Error ? error.message : '获取模型失败'
            setModelsError(msg)
        } finally {
            setModelsLoading(false)
        }
    }, [])

    const handleConnectModel = useCallback(async () => {
        if (!draftBaseUrl.trim()) {
            setModelsError('请先填写 Base URL')
            return
        }

        fetchAbortRef.current?.abort()
        const controller = new AbortController()
        fetchAbortRef.current = controller
        const modelId = await fetchModelName(draftBaseUrl.trim(), draftApiKey.trim(), controller.signal)
        if (!modelId) return

        setDraftModel(modelId)
        setModelSaveStatus('Editing')
        setModelsError(null)
    }, [draftApiKey, draftBaseUrl, fetchModelName])

    useEffect(() => {
        return () => {
            fetchAbortRef.current?.abort()
        }
    }, [])

    const maxTokenPreset = (() => {
        if (modelConfig.maxTokens <= 8192) return 'low'
        if (modelConfig.maxTokens <= 16384) return 'medium'
        return 'high'
    })()

    const activeModelPreset = modelPresets.find((p) => p.id === selectedModelPresetId) ?? null
    const tokenOptions = [
        {key: 'low', label: 'Low', hint: '8k', value: 8192},
        {key: 'medium', label: 'Middle', hint: '16k', value: 16384},
        {key: 'high', label: 'High', hint: '32k', value: 32768},
    ] as const
    const thinkingProtocolOptions = [
        {value: 'off', label: 'Off'},
        {value: 'qwen', label: 'Qwen'},
        {value: 'zai', label: 'Z.ai'},
        {value: 'openai_reasoning', label: 'OpenAI'},
    ] as const satisfies ReadonlyArray<{value: ThinkingProtocol; label: string}>
    const thinkingLevelOptions = [
        {value: 'off', label: 'Off'},
        {value: 'minimal', label: 'Minimal'},
        {value: 'low', label: 'Low'},
        {value: 'medium', label: 'Medium'},
        {value: 'high', label: 'High'},
        {value: 'xhigh', label: 'XHigh'},
    ] as const satisfies ReadonlyArray<{value: ThinkingConfig['level']; label: string}>
    const selectedTokenOption =
        tokenOptions.find((item) => item.key === maxTokenPreset) ?? tokenOptions[0]
    const selectedThinkingProtocol =
        thinkingProtocolOptions.find((item) => item.value === thinkingConfig.protocol) ?? thinkingProtocolOptions[0]
    const selectedThinkingLevel =
        thinkingLevelOptions.find((item) => item.value === thinkingConfig.level) ?? thinkingLevelOptions[3]
    const thinkingProtocolSelected = thinkingConfig.protocol !== 'off'
    const thinkingEnabled = thinkingProtocolSelected && thinkingConfig.enabled
    const isMaxTokensOpen = activeInlineDropdown === 'maxTokens'
    const isThinkingProtocolOpen = activeInlineDropdown === 'thinkingProtocol'
    const isThinkingLevelOpen = activeInlineDropdown === 'thinkingLevel'

    const toggleInlineDropdown = (dropdownId: InlineDropdownId) => {
        setActiveInlineDropdown((current) => current === dropdownId ? null : dropdownId)
    }

    useEffect(() => {
        // 首次没有模型预设时，按当前模型配置创建一个默认预设，便于后续编辑/切换。
        if (modelPresets.length > 0) return
        const id = `model_${Date.now()}`
        const initial: ModelPresetItem = {
            id,
            model: modelConfig.model || '',
            baseUrl: modelConfig.baseUrl || '',
            apiKey: modelConfig.apiKey || '',
            title: modelConfig.model || 'Default model',
        }
        setModelPresets([initial])
        setSelectedModelPresetId(id)
    }, [modelConfig.apiKey, modelConfig.baseUrl, modelConfig.model, modelPresets.length])

    useEffect(() => {
        localStorage.setItem(MODEL_PRESET_STORAGE_KEY, JSON.stringify(modelPresets))
    }, [modelPresets])

    useEffect(() => {
        if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) {
            localStorage.removeItem(ACTIVE_MODEL_PRESET_STORAGE_KEY)
            return
        }
        localStorage.setItem(ACTIVE_MODEL_PRESET_STORAGE_KEY, selectedModelPresetId)
    }, [selectedModelPresetId])

    useEffect(() => {
        if (!isModelPanelOpen) return
        const initialId = selectedModelPresetId ?? NEW_MODEL_PRESET_VALUE
        setSelectedModelPresetId(initialId)
        if (initialId === NEW_MODEL_PRESET_VALUE) {
            setDraftModel('')
            setDraftBaseUrl('')
            setDraftApiKey('')
        } else {
            const selected = modelPresets.find((p) => p.id === initialId)
            setDraftModel(selected?.model ?? '')
            setDraftBaseUrl(selected?.baseUrl ?? '')
            setDraftApiKey(selected?.apiKey ?? '')
        }
        setModelSaveStatus('Saved')
        setModelsError(null)
    }, [isModelPanelOpen, modelPresets, selectedModelPresetId])

    useEffect(() => {
        if (!isContextPanelOpen) return
        void (async () => {
            setContextLoading(true)
            setContextError(null)
            try {
                const [files, cfg, logs] = await Promise.all([
                    fetchContextFiles(),
                    fetchMemoryRuntimeConfig(),
                    fetchMemoryFiles(),
                ])
                const nextMap = files.reduce<Record<ContextFileName, ContextFileRecord | undefined>>((acc, file) => {
                    acc[file.name] = file
                    return acc
                }, {
                    'SOUL.md': undefined,
                    'IDENTITY.md': undefined,
                    'USER.md': undefined,
                    'MEMORY.md': undefined,
                    'AGENTS.md': undefined,
                    'TOOLS.md': undefined,
                })

                setContextFiles(nextMap)
                setContextDrafts({
                    'SOUL.md': nextMap['SOUL.md']?.content ?? '',
                    'IDENTITY.md': nextMap['IDENTITY.md']?.content ?? '',
                    'USER.md': nextMap['USER.md']?.content ?? '',
                    'MEMORY.md': nextMap['MEMORY.md']?.content ?? '',
                })
                setMemoryConfig(cfg)
                setMemoryDraftConfig(cfg)
                setMemoryFiles(logs)
                setSelectedMemoryFile(null)
                setSelectedMemoryContent('')
                setContextSaveStatus('Saved')
                setMemorySaveStatus('Saved')
            } catch (error) {
                setContextError(error instanceof Error ? error.message : '加载上下文失败')
            } finally {
                setContextLoading(false)
            }
        })()
    }, [isContextPanelOpen])

    useEffect(() => {
        if (isOpen) return
        resetDrawerPanels()
    }, [isOpen, resetDrawerPanels])

    useEffect(() => {
        if (!isModelPanelOpen || modelSaveStatus !== 'Editing') return

        const timer = window.setTimeout(() => {
            if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) {
                if (!draftModel.trim() && !draftBaseUrl.trim() && !draftApiKey.trim()) {
                    setModelSaveStatus('Saved')
                    return
                }
                const nextId = `model_${Date.now()}`
                const newItem: ModelPresetItem = {
                    id: nextId,
                    model: draftModel,
                    baseUrl: draftBaseUrl,
                    apiKey: draftApiKey,
                    title: draftModel.trim() || undefined,
                }
                setModelPresets((prev) => [...prev, newItem])
                setSelectedModelPresetId(nextId)
                onModelConfigChange({
                    ...modelConfig,
                    model: newItem.model,
                    baseUrl: newItem.baseUrl,
                    apiKey: newItem.apiKey,
                })
                setModelSaveStatus('Saved')
                return
            }

            const nextItems = modelPresets.map((item) =>
                item.id === selectedModelPresetId
                    ? {
                        ...item,
                        model: draftModel,
                        baseUrl: draftBaseUrl,
                        apiKey: draftApiKey,
                        title: draftModel.trim() || item.title,
                    }
                    : item,
            )
            setModelPresets(nextItems)
            onModelConfigChange({
                ...modelConfig,
                model: draftModel,
                baseUrl: draftBaseUrl,
                apiKey: draftApiKey,
            })
            setModelSaveStatus('Saved')
        }, 250)

        return () => {
            window.clearTimeout(timer)
        }
    }, [
        draftApiKey,
        draftBaseUrl,
        draftModel,
        isModelPanelOpen,
        modelConfig,
        modelPresets,
        modelSaveStatus,
        onModelConfigChange,
        selectedModelPresetId,
    ])

    useEffect(() => {
        if (!isContextPanelOpen || selectedContextFile !== 'MEMORY.md' || memorySaveStatus !== 'Editing') return

        const timer = window.setTimeout(async () => {
            try {
                const next = await saveMemoryRuntimeConfig(memoryDraftConfig)
                setMemoryConfig(next)
                setMemoryDraftConfig(next)
                setMemorySaveStatus('Saved')
            } catch (error) {
                setContextError(error instanceof Error ? error.message : '保存记忆配置失败')
            }
        }, 250)

        return () => window.clearTimeout(timer)
    }, [isContextPanelOpen, memoryDraftConfig, memorySaveStatus, selectedContextFile])

    useEffect(() => {
        if (!activeInlineDropdown) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return

            if (
                maxTokensDropdownRef.current?.contains(target)
                || thinkingProtocolDropdownRef.current?.contains(target)
                || thinkingLevelDropdownRef.current?.contains(target)
            ) {
                return
            }

            setActiveInlineDropdown(null)
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setActiveInlineDropdown(null)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [activeInlineDropdown])

    useEffect(() => {
        if (!activeInlineDropdown) return

        const node = settingsScrollRef.current
        if (!node) return

        const handleScroll = () => {
            setActiveInlineDropdown(null)
        }

        node.addEventListener('scroll', handleScroll, {passive: true})
        return () => node.removeEventListener('scroll', handleScroll)
    }, [activeInlineDropdown])

    useEffect(() => {
        if (!isOpen || isContextPanelOpen || isModelPanelOpen) {
            setActiveInlineDropdown(null)
        }
    }, [isContextPanelOpen, isModelPanelOpen, isOpen])

    const persistContextFile = useCallback(async (name: EditableContextFileName, content: string) => {
        try {
            const file = await updateContextFile(name, content)
            setContextFiles((prev) => ({...prev, [name]: file}))
            setContextDrafts((prev) => ({...prev, [name]: file.content}))
            setContextSaveStatus('Saved')
            setContextError(null)
        } catch (error) {
            setContextError(error instanceof Error ? error.message : '保存上下文失败')
        }
    }, [])

    useEffect(() => {
        if (!isContextPanelOpen || contextSaveStatus !== 'Editing') return
        const draft = contextDrafts[selectedContextFile]
        const timer = window.setTimeout(() => {
            void persistContextFile(selectedContextFile, draft)
        }, 250)

        return () => window.clearTimeout(timer)
    }, [contextDrafts, contextSaveStatus, isContextPanelOpen, persistContextFile, selectedContextFile])

    const handleModelPresetSelection = (value: string) => {
        setSelectedModelPresetId(value)
        if (value === NEW_MODEL_PRESET_VALUE) {
            setDraftModel('')
            setDraftBaseUrl('')
            setDraftApiKey('')
            setModelSaveStatus('Saved')
            setModelsError(null)
            return
        }
        const selected = modelPresets.find((item) => item.id === value)
        setDraftModel(selected?.model ?? '')
        setDraftBaseUrl(selected?.baseUrl ?? '')
        setDraftApiKey(selected?.apiKey ?? '')
        if (selected) {
            onModelConfigChange({
                ...modelConfig,
                model: selected.model,
                baseUrl: selected.baseUrl,
                apiKey: selected.apiKey,
            })
        }
        setModelSaveStatus('Saved')
        setModelsError(null)
    }

    const handleDeleteModelPreset = () => {
        if (selectedModelPresetId === NEW_MODEL_PRESET_VALUE) return
        const nextItems = modelPresets.filter((item) => item.id !== selectedModelPresetId)
        setModelPresets(nextItems)
        setSelectedModelPresetId(NEW_MODEL_PRESET_VALUE)
        setDraftModel('')
        setDraftBaseUrl('')
        setDraftApiKey('')
        setModelSaveStatus('Saved')
        setModelsError(null)
    }

    const handleOpenContextPanel = (name: EditableContextFileName) => {
        setSelectedContextFile(name)
        setSelectedManagedFile(null)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
        setIsContextPanelOpen(true)
    }

    const handleCloseContextPanel = () => {
        if (contextSaveStatus === 'Editing') {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        setIsContextPanelOpen(false)
    }

    const handleSelectContextFile = (name: EditableContextFileName) => {
        if (contextSaveStatus === 'Editing') {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        setSelectedContextFile(name)
        setSelectedManagedFile(null)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
        setContextSaveStatus('Saved')
        setContextError(null)
    }

    const handleSelectManagedFile = (name: ManagedContextFileName) => {
        if (contextSaveStatus === 'Editing') {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        setSelectedManagedFile(name)
        setSelectedMemoryFile(null)
        setSelectedMemoryContent('')
    }

    const handleOpenMemoryFile = async (name: string) => {
        try {
            const content = await fetchMemoryFileContent(name)
            setSelectedMemoryFile(name)
            setSelectedMemoryContent(content)
        } catch (error) {
            setContextError(error instanceof Error ? error.message : '读取记忆文件失败')
        }
    }

    const handleDrawerClose = () => {
        if (isContextPanelOpen && contextSaveStatus === 'Editing' && !selectedManagedFile) {
            void persistContextFile(selectedContextFile, contextDrafts[selectedContextFile])
        }
        resetDrawerPanels()
        onClose()
    }

    return (
        <div
            className={clsx(
                "h-screen shrink-0 overflow-hidden bg-surface-alt",
                "transition-[width] duration-300 ease-in-out",
                isOpen ? "w-80" : "w-0"
            )}
        >
            {/* ---------- 抽屉头部 ---------- */}
            <div
                className={[
                    "flex items-center justify-between",
                    "h-12 px-6",
                ].join(" ")}
            >
                <h2 className="text-lg font-semibold text-text-primary">设置</h2>
                <button
                    type="button"
                    onClick={handleDrawerClose}
                    className={[
                        "flex items-center justify-center",
                        "size-8 rounded",
                        "text-text-secondary",
                        "transition-colors hover:bg-hover hover:text-text-primary",
                    ].join(" ")}
                    aria-label="关闭设置"
                >
                    <X className="size-5"/>
                </button>
            </div>

            {/* ---------- 抽屉内容 ---------- */}
            <div ref={settingsScrollRef} className="relative h-[calc(100vh-48px)] overflow-y-auto px-6 py-5">
                <div className="selector-container space-y-3">
                    <div className="settings-item settings-model-selector">
                        <div className="item-input-form-field">
                            <button
                                type="button"
                                onClick={() => setIsModelPanelOpen(true)}
                                className="model-selector-card w-full rounded-2xl border border-border bg-surface-raised p-4 text-left shadow-sm transition-shadow hover:shadow-[var(--shadow-input)]"
                            >
                                <span className="block text-sm font-semibold text-text-primary">Model selection</span>
                                <span className="mt-1 block text-xs text-text-secondary">
                                    {getModelPresetLabel(activeModelPreset) || modelConfig.model || '未设置模型'}
                                </span>
                                <span className="mt-1 block text-xs text-text-secondary">
                                    {modelConfig.baseUrl || 'Select a model and adjust runtime parameters'}
                                </span>
                            </button>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => handleOpenContextPanel(selectedContextFile)}
                        className="w-full rounded-2xl border border-border bg-surface-raised p-4 text-left shadow-sm transition-shadow hover:shadow-[var(--shadow-input)]"
                    >
                        <span className="block text-sm font-semibold text-text-primary">Assistant context</span>
                        <span className="mt-1 block text-xs text-text-secondary">
                            Soul · Identity · User · Memory
                        </span>
                        <span className="mt-1 block text-xs text-text-secondary">
                            编辑 `.lecquy` 上下文文件，系统托管 AGENTS / TOOLS 只读
                        </span>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {EDITABLE_CONTEXT_FILES.map((file) => (
                                <span
                                    key={file.name}
                                    className="inline-flex rounded-full border border-border bg-surface-alt px-2 py-0.5 text-[11px] text-text-muted"
                                >
                                    {file.title}
                                </span>
                            ))}
                        </div>
                    </button>
                </div>

                <div className="my-6 h-px w-full bg-border" role="separator" aria-orientation="horizontal"/>

                <div className="space-y-5">
                    {/* Function Calling 开关 */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-text-primary">Function Calling</h3>
                            <p className="text-xs text-text-secondary mt-0.5">启用后模型可调用工具</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={modelConfig.enableTools}
                            onClick={() => updateModelConfig({enableTools: !modelConfig.enableTools})}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                                modelConfig.enableTools
                                    ? 'border-[color:var(--color-toggle-on)] bg-[color:var(--color-toggle-on)]'
                                    : 'border-[color:var(--color-toggle-off)] bg-[color:var(--color-toggle-off)]'
                            }`}
                        >
                            <span className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${
                                modelConfig.enableTools ? 'translate-x-6 bg-[color:var(--color-toggle-thumb-active)]' : 'translate-x-1 bg-[color:var(--color-toggle-thumb)]'
                            }`}/>
                        </button>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-semibold text-text-primary">Thinking enabled</h3>
                            <p className="mt-0.5 text-xs text-text-secondary">显示折叠思考</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={thinkingEnabled}
                            disabled={!thinkingProtocolSelected}
                            onClick={() => updateThinkingConfig({enabled: !thinkingConfig.enabled})}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                                thinkingEnabled
                                    ? 'border-[color:var(--color-toggle-on)] bg-[color:var(--color-toggle-on)]'
                                    : 'border-[color:var(--color-toggle-off)] bg-[color:var(--color-toggle-off)]'
                            } ${!thinkingProtocolSelected ? 'cursor-not-allowed opacity-50' : ''}`}
                        >
                            <span className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform ${
                                thinkingEnabled ? 'translate-x-6 bg-[color:var(--color-toggle-thumb-active)]' : 'translate-x-1 bg-[color:var(--color-toggle-thumb)]'
                            }`}/>
                        </button>
                    </div>
                </div>

                <div className="my-6 h-px w-full bg-border" role="separator" aria-orientation="horizontal"/>

                <div className="settings-item-column settings-item-spacer">
                    <div className="item-about item-about-slider">
                        <div className="item-description">
                            <h3 className="item-description-title text-sm font-semibold text-text-primary">Temperature</h3>
                        </div>
                    </div>
                    <div className="item-input mt-3 flex items-center gap-3">
                        <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.05}
                            value={modelConfig.temperature}
                            onChange={(e) => updateModelConfig({temperature: Number(e.target.value)})}
                            className="flex-1 accent-text-primary"
                        />
                        <input
                            type="number"
                            min={0}
                            max={2}
                            step={0.05}
                            value={modelConfig.temperature}
                            onChange={(e) => updateModelConfig({temperature: Number(e.target.value)})}
                            className="w-14 rounded-lg border border-border bg-surface-raised py-1 text-center text-sm text-text-primary shadow-sm outline-none"
                        />
                    </div>
                </div>

                <div className="my-6 h-px w-full bg-border" role="separator" aria-orientation="horizontal"/>

                <div className="space-y-5">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-text-primary">Max tokens</h3>
                            <p className="mt-0.5 text-xs text-text-secondary">回复上限</p>
                        </div>
                        <div ref={maxTokensDropdownRef} className="relative w-[128px] shrink-0">
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => toggleInlineDropdown('maxTokens')}
                                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface-raised px-3 py-2 text-sm shadow-sm"
                                    aria-haspopup="listbox"
                                    aria-expanded={isMaxTokensOpen}
                                    aria-label="Max tokens"
                                >
                                    <div className="flex w-full min-w-0 items-center justify-between pr-2">
                                        <span className="truncate text-text-primary">{selectedTokenOption.label}</span>
                                        <span className="text-xs text-text-muted">{selectedTokenOption.hint}</span>
                                    </div>
                                    <ChevronDown className="size-4 text-text-muted"/>
                                </button>

                                {isMaxTokensOpen && (
                                    <div
                                        className="absolute right-0 z-20 mt-2 max-h-56 w-full overflow-auto rounded-2xl border border-border bg-surface-raised shadow-sm"
                                        role="listbox"
                                        aria-label="Max tokens options"
                                    >
                                        {tokenOptions.map((item) => {
                                            const active = item.key === maxTokenPreset
                                            return (
                                                <button
                                                    key={item.key}
                                                    type="button"
                                                    onClick={() => {
                                                        updateModelConfig({maxTokens: item.value})
                                                        setActiveInlineDropdown(null)
                                                    }}
                                                    className={clsx(
                                                        'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                        active ? 'bg-hover text-text-primary' : 'bg-surface-raised text-text-secondary hover:bg-hover hover:text-text-primary',
                                                    )}
                                                    role="option"
                                                    aria-selected={active}
                                                >
                                                    <span>{item.label}</span>
                                                    <span className="text-xs text-text-muted">{item.hint}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-text-primary">Thinking protocol</h3>
                            <p className="mt-0.5 text-xs text-text-secondary">思考协议</p>
                        </div>
                        <div ref={thinkingProtocolDropdownRef} className="relative w-[128px] shrink-0">
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => toggleInlineDropdown('thinkingProtocol')}
                                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface-raised px-3 py-2 text-sm shadow-sm"
                                    aria-haspopup="listbox"
                                    aria-expanded={isThinkingProtocolOpen}
                                    aria-label="Thinking protocol"
                                >
                                    <div className="flex w-full min-w-0 items-center justify-between pr-2">
                                        <span className="truncate text-text-primary">{selectedThinkingProtocol.label}</span>
                                        <span className="text-xs text-text-muted">{thinkingProtocolSelected ? 'set' : 'off'}</span>
                                    </div>
                                    <ChevronDown className="size-4 text-text-muted"/>
                                </button>

                                {isThinkingProtocolOpen && (
                                    <div
                                        className="absolute bottom-full right-0 z-20 mb-2 max-h-56 w-full overflow-auto rounded-2xl border border-border bg-surface-raised shadow-sm"
                                        role="listbox"
                                        aria-label="Thinking protocol options"
                                    >
                                        {thinkingProtocolOptions.map((item) => {
                                            const active = item.value === thinkingConfig.protocol
                                            return (
                                                <button
                                                    key={item.value}
                                                    type="button"
                                                    onClick={() => {
                                                        updateThinkingConfig({
                                                            protocol: item.value,
                                                            enabled: item.value === 'off' ? false : thinkingConfig.enabled,
                                                        })
                                                        setActiveInlineDropdown(null)
                                                    }}
                                                    className={clsx(
                                                        'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                        active ? 'bg-hover text-text-primary' : 'bg-surface-raised text-text-secondary hover:bg-hover hover:text-text-primary',
                                                    )}
                                                    role="option"
                                                    aria-selected={active}
                                                >
                                                    <span>{item.label}</span>
                                                    <span className="text-xs text-text-muted">{item.value === 'off' ? 'off' : 'on'}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-text-primary">Thinking level</h3>
                            <p className="mt-0.5 text-xs text-text-secondary">思考强度</p>
                        </div>
                        <div ref={thinkingLevelDropdownRef} className="relative w-[128px] shrink-0">
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!thinkingProtocolSelected) return
                                        toggleInlineDropdown('thinkingLevel')
                                    }}
                                    className={`flex w-full items-center justify-between rounded-2xl border border-border bg-surface-raised px-3 py-2 text-sm shadow-sm ${
                                        !thinkingProtocolSelected ? 'cursor-not-allowed opacity-50' : ''
                                    }`}
                                    aria-haspopup="listbox"
                                    aria-expanded={isThinkingLevelOpen}
                                    aria-label="Thinking level"
                                    disabled={!thinkingProtocolSelected}
                                >
                                    <div className="flex w-full min-w-0 items-center justify-between pr-2">
                                        <span className="truncate text-text-primary">{selectedThinkingLevel.label}</span>
                                        <span className="text-xs text-text-muted">{thinkingProtocolSelected ? 'on' : 'off'}</span>
                                    </div>
                                    <ChevronDown className="size-4 text-text-muted"/>
                                </button>

                                {isThinkingLevelOpen && thinkingProtocolSelected && (
                                    <div
                                        className="absolute bottom-full right-0 z-20 mb-2 max-h-56 w-full overflow-auto rounded-2xl border border-border bg-surface-raised shadow-sm"
                                        role="listbox"
                                        aria-label="Thinking level options"
                                    >
                                        {thinkingLevelOptions.map((item) => {
                                            const active = item.value === thinkingConfig.level
                                            return (
                                                <button
                                                    key={item.value}
                                                    type="button"
                                                    onClick={() => {
                                                        updateThinkingConfig({level: item.value})
                                                        setActiveInlineDropdown(null)
                                                    }}
                                                    className={clsx(
                                                        'flex w-full items-center justify-between px-3 py-2 text-sm',
                                                        active ? 'bg-hover text-text-primary' : 'bg-surface-raised text-text-secondary hover:bg-hover hover:text-text-primary',
                                                    )}
                                                    role="option"
                                                    aria-selected={active}
                                                >
                                                    <span>{item.label}</span>
                                                    <span className="text-xs text-text-muted">{item.value}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {isContextPanelOpen && (
                    <div className="absolute inset-0 z-20 flex flex-col bg-surface-alt px-6 py-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <div>
                                <span className="text-base font-semibold text-text-primary">Assistant context</span>
                                <p className="mt-1 text-xs text-text-secondary">Soul · Identity · User · Memory</p>
                            </div>
                            <button
                                type="button"
                                onClick={handleCloseContextPanel}
                                aria-label="关闭上下文面板"
                                className="flex size-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                            >
                                <X className="size-4"/>
                            </button>
                        </div>

                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
                            <div className="grid grid-cols-2 gap-2">
                                {EDITABLE_CONTEXT_FILES.map((file) => {
                                    const active = selectedContextFile === file.name && !selectedManagedFile
                                    return (
                                        <button
                                            key={file.name}
                                            type="button"
                                            onClick={() => handleSelectContextFile(file.name)}
                                            className={clsx(
                                                'rounded-2xl border px-3 py-3 text-left transition-colors',
                                                active
                                                    ? 'border-text-primary bg-surface-raised text-text-primary'
                                                    : 'border-border bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                            )}
                                        >
                                            <div className="text-sm font-semibold">{file.title}</div>
                                            <div className="mt-1 text-xs">{file.summary}</div>
                                        </button>
                                    )
                                })}
                            </div>

                            <div className="rounded-2xl border border-border bg-surface-raised p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 text-sm font-semibold text-text-primary">
                                        {selectedManagedFile ? selectedManagedFile : EDITABLE_CONTEXT_FILES.find((file) => file.name === selectedContextFile)?.title}
                                    </div>
                                    <span className="shrink-0 rounded-full border border-border bg-surface-alt px-2 py-0.5 text-[11px] text-text-muted">
                                        {selectedManagedFile
                                            ? contextFiles[selectedManagedFile]?.path ?? `.lecquy/${selectedManagedFile}`
                                            : contextFiles[selectedContextFile]?.path ?? `.lecquy/${selectedContextFile}`}
                                    </span>
                                </div>
                                <div className="mt-2 truncate text-xs text-text-secondary">
                                    {selectedManagedFile
                                        ? contextFiles[selectedManagedFile]?.description ?? '系统托管文件，仅供查看。'
                                        : contextFiles[selectedContextFile]?.description ?? ''}
                                </div>

                                {contextError && (
                                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                                        {contextError}
                                    </div>
                                )}

                                {contextLoading ? (
                                    <div className="mt-4 rounded-xl border border-border bg-surface px-3 py-8 text-sm text-text-secondary">
                                        正在加载上下文文件...
                                    </div>
                                ) : selectedManagedFile ? (
                                    <pre className="mt-4 min-h-[16rem] overflow-auto rounded-xl border border-border bg-surface px-3 py-3 text-xs leading-6 text-text-primary">
                                        {contextFiles[selectedManagedFile]?.content || '(empty)'}
                                    </pre>
                                ) : (
                                    <textarea
                                        value={contextDrafts[selectedContextFile]}
                                        onChange={(event) => {
                                            setContextDrafts((prev) => ({
                                                ...prev,
                                                [selectedContextFile]: event.target.value,
                                            }))
                                            setContextSaveStatus('Editing')
                                            setContextError(null)
                                        }}
                                        placeholder="在这里编辑上下文内容..."
                                        className="mt-4 min-h-[16rem] w-full resize-none rounded-xl border border-border bg-surface px-3 py-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                        spellCheck
                                    />
                                )}

                                {!selectedManagedFile && selectedContextFile === 'MEMORY.md' && (
                                    <div className="mt-4 space-y-4 border-t border-border pt-4">
                                        <div>
                                            <div className="text-sm font-semibold text-text-primary">Memory runtime</div>
                                            <div className="mt-1 text-xs text-text-secondary">记忆引擎配置与只读日志入口</div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs text-text-secondary">Embedding base URL</label>
                                            <input
                                                value={memoryDraftConfig.embeddingBaseUrl}
                                                onChange={(e) => {
                                                    setMemoryDraftConfig((prev) => ({
                                                        ...prev,
                                                        embeddingBaseUrl: e.target.value,
                                                    }))
                                                    setMemorySaveStatus('Editing')
                                                }}
                                                placeholder="http://127.0.0.1:8000/v1"
                                                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-xs text-text-secondary">Flush turns</label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={memoryDraftConfig.flushTurns}
                                                onChange={(e) => {
                                                    setMemoryDraftConfig((prev) => ({
                                                        ...prev,
                                                        flushTurns: Number(e.target.value || memoryConfig.flushTurns || 20),
                                                    }))
                                                    setMemorySaveStatus('Editing')
                                                }}
                                                className="w-28 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                                            />
                                        </div>

                                        {selectedMemoryFile ? (
                                            <div className="rounded-xl border border-border bg-surface p-3">
                                                <div className="mb-3 flex items-center justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedMemoryFile(null)
                                                            setSelectedMemoryContent('')
                                                        }}
                                                        className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                                                    >
                                                        返回日志列表
                                                    </button>
                                                    <span className="truncate text-xs text-text-muted">{selectedMemoryFile}</span>
                                                </div>
                                                <pre className="max-h-56 overflow-auto text-xs leading-6 text-text-primary">
                                                    {selectedMemoryContent || '(empty)'}
                                                </pre>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-border bg-surface p-3">
                                                <div className="mb-2 text-xs text-text-secondary">Memory logs (read-only) · {memoryFiles.length}</div>
                                                <div className="max-h-52 space-y-2 overflow-auto">
                                                    {memoryFiles.map((file) => (
                                                        <button
                                                            key={file.name}
                                                            type="button"
                                                            onClick={() => void handleOpenMemoryFile(file.name)}
                                                            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                                                        >
                                                            <span className="truncate">{file.name}</span>
                                                            <span className="ml-2 shrink-0 text-[11px] text-text-muted">
                                                                {new Date(file.updatedAt).toLocaleDateString()}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 border-t border-border pt-4">
                                    <div className="mb-2 text-sm font-semibold text-text-primary">Managed by system</div>
                                    <div className="flex gap-2">
                                        {MANAGED_CONTEXT_FILES.map((file) => {
                                            const active = selectedManagedFile === file.name
                                            return (
                                                <button
                                                    key={file.name}
                                                    type="button"
                                                    onClick={() => handleSelectManagedFile(file.name)}
                                                    className={clsx(
                                                        'rounded-full border px-3 py-1.5 text-xs transition-colors',
                                                        active
                                                            ? 'border-text-primary bg-surface-alt text-text-primary'
                                                            : 'border-border bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                                    )}
                                                >
                                                    {file.title}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <div className="mt-4 text-xs text-text-muted">
                                    {selectedManagedFile
                                        ? 'Managed files are read-only.'
                                        : `${contextSaveStatus === 'Editing' ? 'Saving...' : 'Saved'} · ${selectedContextFile === 'MEMORY.md' ? (memorySaveStatus === 'Editing' ? '同步保存 Memory runtime...' : 'Memory runtime 已同步') : 'Context files are saved to .lecquy'}`}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {isModelPanelOpen && (
                    <div className="absolute inset-0 z-20 flex flex-col bg-surface-alt px-6 py-4">
                        <div className="flex items-center justify-between border-b border-border pb-3">
                            <span className="text-base font-semibold text-text-primary">Model selection</span>
                            <button
                                type="button"
                                onClick={() => setIsModelPanelOpen(false)}
                                aria-label="关闭模型面板"
                                className="flex size-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                            >
                                <X className="size-4"/>
                            </button>
                        </div>

                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                            <div className="relative w-full">
                                <button
                                    type="button"
                                    onClick={() => setIsModelOptionsOpen((prev) => !prev)}
                                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none"
                                    aria-haspopup="listbox"
                                    aria-expanded={isModelOptionsOpen}
                                    aria-label="Model preset"
                                >
                                    <span className="truncate">
                                        {selectedModelPresetId === NEW_MODEL_PRESET_VALUE
                                            ? '+ Create new model setting'
                                            : getModelPresetLabel(modelPresets.find((item) => item.id === selectedModelPresetId) ?? null)}
                                    </span>
                                    <ChevronDown className="size-4 text-text-muted"/>
                                </button>

                                {isModelOptionsOpen && (
                                    <div
                                        className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
                                        role="listbox"
                                        aria-label="Model preset options"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleModelPresetSelection(NEW_MODEL_PRESET_VALUE)
                                                setIsModelOptionsOpen(false)
                                            }}
                                            className={clsx(
                                                'flex w-full items-center px-3 py-2 text-left text-sm',
                                                selectedModelPresetId === NEW_MODEL_PRESET_VALUE
                                                    ? 'bg-hover text-text-primary'
                                                    : 'bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                            )}
                                            role="option"
                                            aria-selected={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                                        >
                                            + Create new model setting
                                        </button>
                                        {modelPresets.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => {
                                                    handleModelPresetSelection(item.id)
                                                    setIsModelOptionsOpen(false)
                                                }}
                                                className={clsx(
                                                    'flex w-full items-center px-3 py-2 text-left text-sm',
                                                    selectedModelPresetId === item.id
                                                        ? 'bg-hover text-text-primary'
                                                        : 'bg-surface text-text-secondary hover:bg-hover hover:text-text-primary',
                                                )}
                                                role="option"
                                                aria-selected={selectedModelPresetId === item.id}
                                            >
                                                {getModelPresetLabel(item)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                                    {draftModel ? (
                                        <span className="text-text-primary">{draftModel}</span>
                                    ) : (
                                        <span className="text-text-secondary/60">点击连接获取 model name</span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleConnectModel()}
                                    disabled={modelsLoading || !draftBaseUrl.trim()}
                                    className="shrink-0 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {modelsLoading ? '连接中...' : '连接'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteModelPreset}
                                    disabled={selectedModelPresetId === NEW_MODEL_PRESET_VALUE}
                                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                    aria-label="Delete model setting"
                                >
                                    <Trash2 className="size-4"/>
                                </button>
                            </div>

                            {modelsError && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                                    {modelsError}
                                </div>
                            )}
                            <input
                                value={draftBaseUrl}
                                onChange={(e) => {
                                    setDraftBaseUrl(e.target.value)
                                    setModelSaveStatus('Editing')
                                    setModelsError(null)
                                }}
                                placeholder="baseUrl"
                                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />
                            <input
                                value={draftApiKey}
                                onChange={(e) => {
                                    setDraftApiKey(e.target.value)
                                    setModelSaveStatus('Editing')
                                    setModelsError(null)
                                }}
                                placeholder="apiKey"
                                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]"
                            />

                            <div className="mt-auto text-xs text-text-muted">
                                Model settings are saved in local storage.
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    )
}
