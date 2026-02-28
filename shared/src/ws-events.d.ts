/**
 * WebSocket 事件类型定义
 * 前后端共享，确保事件名和 payload 类型一致
 */
/** 服务端 → 客户端 事件类型 */
export type ServerEventType = 'message_delta' | 'message_end' | 'todo_write' | 'subagent_start' | 'subagent_result' | 'subagent_error' | 'todo_update' | 'need_user_input' | 'waiting' | 'done' | 'error' | 'ping' | 'session_restored';
/** 客户端 → 服务端 事件类型 */
export type ClientEventType = 'chat' | 'pong';
/** 服务端事件 payload 映射 */
export interface ServerEventPayloadMap {
    message_delta: {
        content: string;
    };
    message_end: Record<string, never>;
    todo_write: {
        content: string;
    };
    subagent_start: {
        todoIndex: number;
        content: string;
    };
    subagent_result: {
        todoIndex: number;
        result: string;
    };
    subagent_error: {
        todoIndex: number;
        error: string;
    };
    todo_update: {
        todoIndex: number;
        status: string;
        summary: string;
    };
    need_user_input: {
        prompt: string;
    };
    waiting: Record<string, never>;
    done: Record<string, never>;
    error: {
        message: string;
    };
    ping: {
        timestamp: number;
    };
    session_restored: {
        sessionId: string;
        messageCount: number;
    };
}
/** 客户端事件 payload 映射 */
export interface ClientEventPayloadMap {
    chat: {
        messages: Array<{
            role: string;
            content: string;
        }>;
        [key: string]: unknown;
    };
    pong: {
        timestamp: number;
    };
}
/** 服务端发送的事件 */
export interface ServerEvent<T extends ServerEventType = ServerEventType> {
    readonly event: T;
    readonly payload: ServerEventPayloadMap[T];
}
/** 客户端发送的事件 */
export interface ClientEvent<T extends ClientEventType = ClientEventType> {
    readonly event: T;
    readonly payload: ClientEventPayloadMap[T];
}
