/**
 * 对话路由
 * 通过请求体 stream 参数控制同步/流式响应
 * 使用 pi-agent-core agentLoop 驱动 Agent
 */

import {Router, type Router as RouterType} from 'express'
import {z} from 'zod'
import type {AgentMessage} from '@mariozechner/pi-agent-core'
import type { AssistantMessage, UserMessage } from '@mariozechner/pi-ai'
import {runMainAgent} from '../agent/index.js'
import {createVllmModel} from '../agent/vllm-model.js'
import {getConfig} from '../config/index.js'
import {initSSE, sendSSEEvent} from '../utils/stream.js'
import {createHttpError} from '../middlewares/error-handler.js'
import {logger} from '../utils/logger.js'
import {chatRequestSchema} from '../types/api.js'
import {createTodoManager} from '../core/todo/todo-manager.js'

const router: RouterType = Router()
const MAX_CONTEXT_MESSAGES = 40

function extractAssistantText(message: AgentMessage): string {
    if (message.role !== 'assistant') return ''
    const content = message.content as unknown
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
        .map((part) => {
            if (typeof part === 'string') return part
            if (part && typeof part === 'object' && 'text' in part) {
                const text = (part as { text?: unknown }).text
                return typeof text === 'string' ? text : ''
            }
            return ''
        })
        .filter(Boolean)
        .join('\n')
}

/** 提取 tool 执行结果的文本摘要（截取前 200 字符） */
function summarizeToolResult(result: unknown): string {
    if (!result || typeof result !== 'object') return String(result ?? '')
    const r = result as { content?: unknown }
    if (!Array.isArray(r.content)) return JSON.stringify(result).slice(0, 200)
    const texts = r.content
        .filter((c: unknown) => c && typeof c === 'object' && (c as { type?: string }).type === 'text')
        .map((c: unknown) => ((c as { text?: string }).text ?? ''))
        .join('\n')
    return texts.slice(0, 200) || JSON.stringify(result).slice(0, 200)
}


/** 规范化前端消息：system 折叠到 extraSystemPrompt，其余消息在后端截断后进入上下文。 */
function normalizeIncomingMessages(
    messages: readonly { role: string; content: string }[],
    modelId: string,
): {
    promptMessages: AgentMessage[]
    contextMessages: AgentMessage[]
    extraSystemPrompt?: string
} {
    const systemChunks = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content.trim())
        .filter((text) => text.length > 0)

    const llmMessages = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((m): AgentMessage => {
            if (m.role === 'user') {
                const userMsg: UserMessage = {
                    role: 'user',
                    content: m.content,
                    timestamp: Date.now(),
                }
                return userMsg
            }

            const assistantMsg: AssistantMessage = {
                role: 'assistant',
                content: [{ type: 'text', text: m.content }],
                api: 'openai-completions',
                provider: 'openai',
                model: modelId,
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: 'stop',
                timestamp: Date.now(),
            }
            return assistantMsg
        })

    const lastUserIndex = (() => {
        for (let i = llmMessages.length - 1; i >= 0; i -= 1) {
            if (llmMessages[i].role === 'user') return i
        }
        return -1
    })()

    const promptMessages = lastUserIndex >= 0 ? [llmMessages[lastUserIndex]] : []
    const contextMessages =
        lastUserIndex > 0 ? llmMessages.slice(0, lastUserIndex) : []

    return {
        promptMessages,
        contextMessages,
        extraSystemPrompt: systemChunks.length > 0 ? systemChunks.join('\n\n') : undefined,
    }
}

/** POST /api/v1/chat - 对话（同步或流式） */
router.post('/chat', async (req, res, next) => {
    let requestContext: {
        body?: unknown
        parsed?: {
            messagesCount: number
            mode?: 'simple' | 'thinking'
            stream?: boolean
            model?: string
            baseUrl?: string
            apiKey?: string
            options?: { temperature?: number; maxTokens?: number }
        }
        resolved?: {
            apiKey?: string
            modelId?: string
            baseUrl?: string
            maxTokens?: number
        }
    } = {}

    try {
        const parsed = chatRequestSchema.safeParse(req.body)
        if (!parsed.success) {
            throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
        }

        const config = getConfig()
        const {
            messages,
            mode,
            stream: isStream,
            model: modelId,
            baseUrl,
            apiKey: reqApiKey,
            options,
        } = parsed.data

        requestContext = {
            body: req.body,
            parsed: {
                messagesCount: messages.length,
                mode,
                stream: isStream,
                model: modelId,
                baseUrl,
                apiKey: reqApiKey ? `${reqApiKey.slice(0, 6)}****` : undefined,
                options,
            },
        }

        const piModel = createVllmModel({
            modelId,
            baseUrl,
            maxTokens: options?.maxTokens,
        })
        const apiKey = reqApiKey ?? config.LLM_API_KEY

        if (mode === 'thinking') {
            throw createHttpError(400, 'HTTP 接口仅支持 simple 模式，thinking 模式请使用 WebSocket /api/v1/chat/ws')
        }

        const { promptMessages, contextMessages, extraSystemPrompt } = normalizeIncomingMessages(messages, piModel.id)
        if (promptMessages.length === 0) {
            throw createHttpError(400, '至少需要一条 user 消息')
        }

        requestContext.resolved = {
            apiKey: apiKey ? `${apiKey.slice(0, 6)}****` : '[not set]',
            modelId: piModel.id,
            baseUrl: piModel.baseUrl,
            maxTokens: piModel.maxTokens,
        }

        logger.debug('chat 模型配置:', {
            apiKey: apiKey ? `${apiKey.slice(0, 6)}****` : '[not set]',
            apiUrl: piModel.baseUrl,
            modelName: piModel.id,
            maxTokens: piModel.maxTokens,
            temperature: options?.temperature,
            stream: isStream,
            mode,
            messages,
        })

        const requestTodoManager = createTodoManager()

        if (isStream) {
            initSSE(res)
            let hasDelta = false

            await runMainAgent({
                messages: promptMessages,
                contextMessages,
                model: piModel,
                apiKey,
                temperature: options?.temperature,
                extraSystemPrompt,
                signal: req.socket.destroyed ? AbortSignal.abort() : undefined,
                autoRunTodos: mode !== 'simple',
                todoManager: requestTodoManager,
                onEvent: (event) => {
                    // 1. 流式推送 text_delta（已有）
                    if (
                        event.type === 'message_update' &&
                        event.assistantMessageEvent.type === 'text_delta'
                    ) {
                        const delta = event.assistantMessageEvent.delta
                        if (delta) {
                            hasDelta = true
                            sendSSEEvent(res, 'message', {content: delta})
                        }
                        return
                    }

                    // 2. tool 调用参数完成 → 日志
                    if (
                        event.type === 'message_update' &&
                        event.assistantMessageEvent.type === 'toolcall_end'
                    ) {
                        const tc = (event.assistantMessageEvent as { toolCall?: { name?: string; arguments?: unknown } }).toolCall
                        if (tc) {
                            logger.info(`[tool call] ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 300)})`)
                        }
                        return
                    }

                    // 3. tool 执行开始 → 日志 + SSE
                    if (event.type === 'tool_execution_start') {
                        const ev = event as { toolName?: string; args?: unknown }
                        logger.info(`[tool exec] 开始执行 ${ev.toolName}`)
                        sendSSEEvent(res, 'tool_start', {
                            toolName: ev.toolName,
                            args: ev.args,
                        })
                        return
                    }

                    // 4. tool 执行结束 → 日志 + SSE
                    if (event.type === 'tool_execution_end') {
                        const ev = event as { toolName?: string; isError?: boolean; result?: unknown }
                        const summary = summarizeToolResult(ev.result)
                        logger.info(`[tool exec] ${ev.toolName} 完成 (isError=${ev.isError}), 结果: ${summary}`)
                        sendSSEEvent(res, 'tool_end', {
                            toolName: ev.toolName,
                            isError: ev.isError,
                            summary,
                        })
                        return
                    }

                    // 5. message_end → 日志 + fallback
                    if (event.type === 'message_end') {
                        const msg = event.message
                        if (msg.role === 'assistant') {
                            logger.info(`[message_end] stopReason=${(msg as { stopReason?: string }).stopReason}`)
                        }
                        if (msg.role === 'assistant' && !hasDelta) {
                            const fallbackText = extractAssistantText(msg)
                            if (fallbackText.trim()) {
                                sendSSEEvent(res, 'message', { content: fallbackText })
                            }
                        }
                    }
                },
            })

            sendSSEEvent(res, 'done', {done: true})
            res.end()
        } else {
            const result = await runMainAgent({
                messages: promptMessages,
                contextMessages,
                model: piModel,
                apiKey,
                temperature: options?.temperature,
                extraSystemPrompt,
                autoRunTodos: mode !== 'simple',
                todoManager: requestTodoManager,
            })

            // 提取最后一条 assistant 消息的文本
            const lastAssistant = [...result.messages]
                .reverse()
                .find((m) => m.role === 'assistant')

            let content = ''
            if (lastAssistant && 'content' in lastAssistant) {
                const parts = lastAssistant.content as Array<{ type: string; text?: string }>
                content = parts
                    .filter((c) => c.type === 'text' && c.text)
                    .map((c) => c.text!)
                    .join('\n')
            }

            res.json({
                success: true,
                data: {
                    content,
                    model: piModel.id,
                },
            })
        }
    } catch (error) {
        if (res.headersSent) {
            logger.error('流式响应过程中出错:', error)
            res.end()
        } else {
            logger.error('chat 请求处理错误，参数上下文:', requestContext)
            next(error)
        }
    }
})

export {router as chatRouter}
