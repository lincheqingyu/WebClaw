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

export type SessionKey = string & { readonly __brand: 'SessionKey' }
export type SessionKind = 'main' | 'group' | 'channel' | 'thread' | 'cron' | 'hook' | 'node' | 'other'
export type SessionChannel = 'webchat' | 'internal' | 'telegram' | 'discord' | 'whatsapp' | 'unknown'
export type SessionTitleSource = 'route' | 'auto' | 'manual'
export type SessionTitleStatus = 'pending' | 'ready' | 'failed'

export interface SessionOrigin {
  readonly label?: string
  readonly provider: SessionChannel
  readonly from?: string
  readonly to?: string
  readonly accountId?: string
  readonly threadId?: string
}

export interface SessionStats {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly contextTokens: number
}

export interface SessionEntry {
  readonly key: string
  readonly sessionId: string
  readonly kind: SessionKind
  readonly channel: SessionChannel
  readonly updatedAt: number
  readonly createdAt: number
  readonly model?: string
  readonly title?: string
  readonly titleSource?: SessionTitleSource
  readonly titleStatus?: SessionTitleStatus
  readonly displayName?: string
  readonly origin?: SessionOrigin
  readonly deliveryContext?: { channel: SessionChannel; to?: string; accountId?: string }
  readonly stats: SessionStats
}

/** 会话快照（持久化用） */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly sessionKey?: string
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
  readonly lastAnthropicCallAt?: number
}

/** WS 连接参数（URL query 携带） */
export interface WsConnectParams {
  readonly sessionId: string
}

export interface SessionRouteContext {
  readonly channel: SessionChannel
  readonly chatType: 'dm' | 'group' | 'channel' | 'thread'
  readonly peerId?: string
  readonly groupId?: string
  readonly channelId?: string
  readonly threadId?: string
  readonly accountId?: string
  readonly senderName?: string
  readonly conversationLabel?: string
}
