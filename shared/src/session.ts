/**
 * 会话相关类型定义
 */

/** 会话 ID（品牌类型，增强类型安全） */
export type SessionId = string & { readonly __brand: 'SessionId' }

/** 创建 SessionId */
export function createSessionId(id?: string): SessionId {
  return (id ?? generateId()) as SessionId
}

/** 生成随机 ID */
function generateId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** 序列化的 todo 项 */
export interface SerializedTodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly activeForm: string
  readonly result?: string
  readonly errorMessage?: string
}

/** 会话快照（持久化用） */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly mode: 'simple' | 'plan'
  readonly contextMessages: Array<{
    role: string
    content: string
    timestamp?: number
  }>
  readonly todoItems: SerializedTodoItem[]
  readonly memoryTurnCounter: number
  readonly createdAt: number
  readonly lastActiveAt: number
}

/** WS 连接参数（URL query 携带） */
export interface WsConnectParams {
  readonly sessionId: string
}
