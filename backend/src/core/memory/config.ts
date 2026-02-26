import path from 'node:path'
import { promises as fs } from 'node:fs'

export interface MemoryConfig {
  flushTurns: number
  embeddingBaseUrl: string
}

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  flushTurns: 20,
  embeddingBaseUrl: '',
}

const MEMORY_DIR = path.join(process.cwd(), '.memory')
const CONFIG_FILE = path.join(MEMORY_DIR, 'config.json')

let cachedConfig: MemoryConfig | null = null

function normalizeConfig(input: Partial<MemoryConfig> | null | undefined): MemoryConfig {
  return {
    flushTurns:
      typeof input?.flushTurns === 'number' && Number.isFinite(input.flushTurns) && input.flushTurns > 0
        ? Math.floor(input.flushTurns)
        : DEFAULT_MEMORY_CONFIG.flushTurns,
    embeddingBaseUrl: typeof input?.embeddingBaseUrl === 'string' ? input.embeddingBaseUrl.trim() : '',
  }
}

async function ensureMemoryDir(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true })
}

export async function getMemoryConfig(): Promise<MemoryConfig> {
  if (cachedConfig) return cachedConfig
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<MemoryConfig>
    cachedConfig = normalizeConfig(parsed)
    return cachedConfig
  } catch {
    cachedConfig = { ...DEFAULT_MEMORY_CONFIG }
    return cachedConfig
  }
}

export async function saveMemoryConfig(patch: Partial<MemoryConfig>): Promise<MemoryConfig> {
  const current = await getMemoryConfig()
  const next = normalizeConfig({ ...current, ...patch })
  await ensureMemoryDir()
  await fs.writeFile(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  cachedConfig = next
  return next
}

export function resetMemoryConfigCache(): void {
  cachedConfig = null
}
