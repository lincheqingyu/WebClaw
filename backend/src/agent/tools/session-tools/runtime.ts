import type { SessionService } from '../../../session-v2/index.js'

let serviceRef: SessionService | null = null
let currentSessionKeyRef: string | null = null

export function bindSessionService(service: SessionService): void {
  serviceRef = service
}

export function getBoundSessionService(): SessionService {
  if (!serviceRef) throw new Error('SessionService 未绑定到 tools runtime')
  return serviceRef
}

export function setCurrentToolSessionKey(sessionKey: string): void {
  currentSessionKeyRef = sessionKey
}

export function clearCurrentToolSessionKey(): void {
  currentSessionKeyRef = null
}

export function getCurrentToolSessionKey(): string | null {
  return currentSessionKeyRef
}
