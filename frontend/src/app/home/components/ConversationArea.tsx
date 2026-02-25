import {Moon, Settings, Sun} from 'lucide-react'
import { ChatInput } from '../../../components/ui/ChatInput'
import { MessageList } from '../../../components/chat/MessageList'
import { useChat, type ModelConfig } from '../../../hooks/useChat'

/**
 * 组件的 Props 类型定义
 *
 * 这是 TypeScript 特有的语法，叫做 接口（Interface）
 * 类比：它就像一份"零件清单"，告诉 React：
 * "要使用 ConversationArea 这个组件，你必须传入以下三样东西"
 *
 * 每一行的格式是：属性名: 类型
 * → boolean 表示只能是 true 或 false
 * → () => void 表示"一个没有参数、没有返回值的函数"
 */
interface ConversationAreaProps {
    onSettingsToggle: () => void // 切换设置抽屉的回调函数
    isDark: boolean               // 当前是否是暗色模式
    onThemeToggle: () => void     // 切换主题的回调
    systemPrompt: string
    modelConfig: ModelConfig
}

/**
 * 区域 A：对话主页面
 *
 * 布局特征：
 * → flex-1 让它占据除 SettingsDrawer 之外的所有空间
 * → 包含一个浮动的设置按钮（右上角）
 */
export function ConversationArea({
                                     onSettingsToggle,
                                     isDark,
                                     onThemeToggle,
                                     systemPrompt,
                                     modelConfig,
                                 }: ConversationAreaProps) {
    const { mode, setMode, messages, send, isStreaming, isWaiting } = useChat({
        systemPrompt,
        modelConfig,
    })
    const hasSent = messages.length > 0

    return (
        <div
            className={[
                // 布局：占满剩余空间
                "relative flex-1",
                // 外观：白色背景 + 右侧边框作为分隔线
                "border-r border-border bg-surface-alt",
            ].join(" ")}
        >
            <button
                type="button"
                onClick={onThemeToggle}
                className={[
                    "flex items-center justify-center",
                    "size-10 rounded-full",
                    "text-text-secondary",
                    "transition-colors hover:bg-hover hover:text-text-primary",
                ].join(" ")}
                aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
            >
                {/* 根据当前主题显示不同图标 */}
                {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>

            {/* ---------- 设置按钮（右上角浮动） ---------- */}
            <button
                type="button"
                onClick={(e) => {
                    // stopPropagation() 阻止事件冒泡
                    // 为什么需要？不阻止的话，点按钮会同时触发父 div 的 onClick（关闭抽屉）
                    e.stopPropagation()
                    onSettingsToggle()
                }}
                className={[
                    // 定位：绝对定位在右上角
                    "absolute right-4 top-4",
                    // 布局：flex 居中图标
                    "flex items-center justify-center",
                    // 尺寸：40px × 40px 的圆形按钮
                    "size-10 rounded-full",
                    // 文字/图标颜色
                    "text-text-secondary",
                    // 交互：悬停时变色 + 平滑过渡
                    "transition-colors hover:bg-hover hover:text-text-primary",
                ].join(" ")}
                aria-label="打开设置"
            >
                <Settings className="size-5" />
            </button>

            {/* ---------- 对话区域 ---------- */}
            {!hasSent ? (
                <div className="flex h-full flex-col items-center justify-center">
                    <div className="mb-8 text-center">
                        <div className="text-2xl font-semibold text-text-primary">
                            有什么我可以帮你的？
                        </div>
                        <div className="mt-2 text-sm text-text-muted">
                            支持 simple 与 thinking 两种模式
                        </div>
                    </div>
                    <ChatInput
                        mode={mode}
                        onModeChange={setMode}
                        onSend={send}
                        showSuggestions
                    />
                </div>
            ) : (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="flex-1 min-h-0">
                        <MessageList messages={messages} isStreaming={isStreaming} isWaiting={isWaiting} />
                    </div>
                    <div className="pb-6">
                        <ChatInput
                            mode={mode}
                            onModeChange={setMode}
                            onSend={send}
                            showSuggestions={false}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
