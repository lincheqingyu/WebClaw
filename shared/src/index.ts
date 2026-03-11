/**
 * @webclaw/shared — 前后端共享类型
 */

export type {
  ServerEventType,
  ClientEventType,
  ServerEventPayloadMap,
  ClientEventPayloadMap,
  ServerEvent,
  ClientEvent,
} from './ws-events.js'

export type {
  SessionId,
  SessionKey,
  SessionKind,
  SessionChannel,
  SessionOrigin,
  SessionStats,
  SessionEntry,
  SessionRouteContext,
  SerializedTodoItem,
  SessionSnapshot,
  WsConnectParams,
} from './session.js'

export { createSessionId } from './session.js'
