import type { Env } from '../config/index.js'
import type { SessionEntry } from '@webclaw/shared'

function getDailyBoundary(now: Date, atHour: number): number {
  const boundary = new Date(now)
  boundary.setHours(atHour, 0, 0, 0)
  if (now.getTime() < boundary.getTime()) {
    boundary.setDate(boundary.getDate() - 1)
  }
  return boundary.getTime()
}

export function shouldRotateSession(entry: SessionEntry, cfg: Env, nowTs = Date.now()): boolean {
  const now = new Date(nowTs)

  const byDaily = cfg.SESSION_RESET_MODE === 'daily'
    ? entry.updatedAt < getDailyBoundary(now, cfg.SESSION_RESET_AT_HOUR)
    : false

  const byIdle = nowTs - entry.updatedAt > cfg.SESSION_IDLE_MINUTES * 60 * 1000

  if (cfg.SESSION_RESET_MODE === 'daily') {
    return byDaily || byIdle
  }
  return byIdle
}
