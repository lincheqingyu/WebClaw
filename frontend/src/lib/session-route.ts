import type { SessionRouteContext } from '@webclaw/shared'

interface BuildRouteOptions {
  peerId: string
  channel?: SessionRouteContext['channel']
  accountId?: string
}

export function buildDefaultRoute(options: BuildRouteOptions): SessionRouteContext {
  return {
    channel: options.channel ?? 'webchat',
    chatType: 'dm',
    peerId: options.peerId,
    accountId: options.accountId ?? 'default',
  }
}
