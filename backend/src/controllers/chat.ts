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
                apiKey: reqApiKey,
                options,
            },
        }

        const piModel = createVllmModel({
            modelId,
            baseUrl,
            maxTokens: options?.maxTokens,
        })
        const apiKey = reqApiKey ?? config.LLM_API_KEY

        const { promptMessages, contextMessages, extraSystemPrompt } = normalizeIncomingMessages(messages, piModel.id)
        if (promptMessages.length === 0) {
            throw createHttpError(400, '至少需要一条 user 消息')
        }

        requestContext.resolved = {
            apiKey,
            modelId: piModel.id,
            baseUrl: piModel.baseUrl,
            maxTokens: piModel.maxTokens,
        }

        logger.debug('chat 模型配置:', {
            apiKey,
            apiUrl: piModel.baseUrl,
            modelName: piModel.id,
            maxTokens: piModel.maxTokens,
            temperature: options?.temperature,
            stream: isStream,
            mode,
            messages,
        })

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
                onEvent: (event) => {
                    // 输出模型流式返回的完整事件，便于定位流式中断/无内容问题
                    logger.debug('chat stream event:', event)

                    // 流式推送 text_delta
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

                    // 部分模型/适配器可能不发 text_delta，只在 message_end 给完整文本
                    if (event.type === 'message_end' && event.message.role === 'assistant' && !hasDelta) {
                        const fallbackText = extractAssistantText(event.message)
                        if (fallbackText.trim()) {
                            sendSSEEvent(res, 'message', { content: fallbackText })
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
