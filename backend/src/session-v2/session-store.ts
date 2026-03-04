import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionEntry, SessionSnapshot } from '@webclaw/shared'
import type { SessionStoreShape } from './types.js'

export class SessionStore {
  private readonly root: string
  private readonly indexFile: string
  private readonly snapshotsDir: string
  private readonly transcriptDir: string

  constructor(rootDir: string) {
    this.root = rootDir
    this.indexFile = join(this.root, 'sessions.json')
    this.snapshotsDir = join(this.root, 'snapshots')
    this.transcriptDir = join(this.root, 'transcripts')
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await mkdir(this.snapshotsDir, { recursive: true })
    await mkdir(this.transcriptDir, { recursive: true })
    if (!existsSync(this.indexFile)) {
      await writeFile(this.indexFile, JSON.stringify({ entries: {} } satisfies SessionStoreShape, null, 2), 'utf-8')
    }
  }

  async loadIndex(): Promise<Record<string, SessionEntry>> {
    const raw = await readFile(this.indexFile, 'utf-8')
    const parsed = JSON.parse(raw) as SessionStoreShape
    return parsed.entries ?? {}
  }

  async saveIndex(entries: Record<string, SessionEntry>): Promise<void> {
    await writeFile(this.indexFile, JSON.stringify({ entries }, null, 2), 'utf-8')
  }

  async saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const path = join(this.snapshotsDir, `${sessionId}.json`)
    await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8')
  }

  async loadSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    const path = join(this.snapshotsDir, `${sessionId}.json`)
    if (!existsSync(path)) return null
    try {
      const raw = await readFile(path, 'utf-8')
      return JSON.parse(raw) as SessionSnapshot
    } catch {
      return null
    }
  }

  transcriptPath(sessionId: string): string {
    return join(this.transcriptDir, `${sessionId}.jsonl`)
  }

  async appendTranscript(sessionId: string, messages: AgentMessage[]): Promise<void> {
    if (messages.length === 0) return
    const path = this.transcriptPath(sessionId)
    const lines = messages.map((m) => JSON.stringify({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? Date.now(),
    }))
    await appendFile(path, `${lines.join('\n')}\n`, 'utf-8')
  }

  async readTranscript(sessionId: string, limit = 50): Promise<Array<{ role: string; content: unknown; timestamp?: number }>> {
    const path = this.transcriptPath(sessionId)
    if (!existsSync(path)) return []
    const raw = await readFile(path, 'utf-8')
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    return lines.slice(-Math.max(1, limit)).map((line) => {
      try {
        return JSON.parse(line) as { role: string; content: unknown; timestamp?: number }
      } catch {
        return { role: 'other', content: line }
      }
    })
  }
}
