/**
 * 对话路由
 * 通过请求体 stream 参数控制同步/流式响应
 * 使用 pi-agent-core agentLoop 驱动 Agent
 */

import {Router, type Router as RouterType} from 'express'
import {z} from 'zod'
import type {UserMessage} from '@mariozechner/pi-ai'
import type {AgentMessage} from '@mariozechner/pi-agent-core'
import {runMainAgent} from '../agent/index.js'
import {createVllmModel} from '../agent/vllm-model.js'
import {getConfig} from '../config/index.js'
import {initSSE, sendSSEEvent} from '../utils/stream.js'
import {createHttpError} from '../middlewares/error-handler.js'
import {logger} from '../utils/logger.js'
import {chatRequestSchema} from '../types/api.js'

const router: RouterType = Router()


/** 将前端消息转为 UserMessage[]（只取 user 角色，pi-ai UserMessage.content 支持 string） */
function toAgentMessages(
    messages: readonly { role: string; content: string }[],
): AgentMessage[] {
    return messages.map((m): UserMessage => ({
        role: 'user',
        content: m.content,
        timestamp: Date.now(),
    }))
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

        const agentMessages = toAgentMessages(messages)

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

            await runMainAgent({
                messages: agentMessages,
                model: piModel,
                apiKey,
                temperature: options?.temperature,
                signal: req.socket.destroyed ? AbortSignal.abort() : undefined,
                autoRunTodos: mode !== 'simple',
                onEvent: (event) => {
                    // 流式推送 text_delta
                    if (
                        event.type === 'message_update' &&
                        event.assistantMessageEvent.type === 'text_delta'
                    ) {
                        const delta = event.assistantMessageEvent.delta
                        if (delta) {
                            sendSSEEvent(res, 'message', {content: delta})
                        }
                    }
                },
            })

            sendSSEEvent(res, 'done', {done: true})
            res.end()
        } else {
            const result = await runMainAgent({
                messages: agentMessages,
                model: piModel,
                apiKey,
                temperature: options?.temperature,
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
