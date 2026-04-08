import type { SessionRouteContext } from '@lecquy/shared'

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
    userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
