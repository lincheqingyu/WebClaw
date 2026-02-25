/**
 * API 请求/响应类型定义
 */

import { z } from 'zod'

/** 错误响应体 */
export interface ErrorResponse {
  readonly success: false
  readonly error: string
  readonly code?: string
}

/** API 统一响应类型 */
export type ApiResponse<T = unknown> =
  | { readonly success: true; readonly data: T }
  | ErrorResponse

/** 健康检查响应 */
export interface HealthResponse {
  readonly status: 'ok'
  readonly timestamp: string
}

export const chatRequestSchema = z.object({
  messages: z
      .array(
          z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string().min(1, '消息内容不能为空'),
          }),
      )
      .min(1, '至少需要一条消息'),
  mode: z.enum(['simple', 'thinking']).default('simple'),
  stream: z.boolean().optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  options: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).optional(),
      })
      .optional(),
})