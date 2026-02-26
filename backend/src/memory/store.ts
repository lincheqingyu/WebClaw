import path from 'node:path'
import { promises as fs } from 'node:fs'
import { logger } from '../utils/logger.js'

export const MEMORY_DIR = path.join(process.cwd(), '.memory')
export const MAIN_MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md')

function formatDate(date = new Date()): string {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function getDailyMemoryFilePath(date = new Date()): string {
  return path.join(MEMORY_DIR, `memory-${formatDate(date)}.md`)
}

function isMemoryFileName(name: string): boolean {
  return name === 'MEMORY.md' || /^memory-\d{4}-\d{2}-\d{2}\.md$/.test(name)
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

export async function ensureMemoryFiles(): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true })
  try {
    await fs.access(MAIN_MEMORY_FILE)
  } catch {
    const boilerplate = '# MEMORY\n\n长期稳定记忆（偏好、习惯、关键事实）。\n'
    await fs.writeFile(MAIN_MEMORY_FILE, boilerplate, 'utf8')
  }
}

export async function appendDailyMemoryEntry(entry: string): Promise<void> {
  if (!entry.trim()) return
  await ensureMemoryFiles()
  const dailyPath = getDailyMemoryFilePath()
  const timestamp = new Date().toISOString()
  const block = `\n## ${timestamp}\n\n${entry.trim()}\n`
  await fs.appendFile(dailyPath, block, 'utf8')
}

export async function loadMemoryInjectionText(): Promise<string> {
  await ensureMemoryFiles()

  const mainText = await readTextIfExists(MAIN_MEMORY_FILE)
  const todayPath = getDailyMemoryFilePath(new Date())
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayPath = getDailyMemoryFilePath(yesterday)

  const todayText = await readTextIfExists(todayPath)
  const yesterdayText = await readTextIfExists(yesterdayPath)

  const sections: string[] = []
  if (mainText.trim()) {
    sections.push(`## MEMORY.md\n\n${mainText.trim()}`)
  }
  if (todayText.trim()) {
    sections.push(`## ${path.basename(todayPath)}\n\n${todayText.trim()}`)
  }
  if (yesterdayText.trim()) {
    sections.push(`## ${path.basename(yesterdayPath)}\n\n${yesterdayText.trim()}`)
  }

  if (sections.length === 0) return ''

  const text = [
    '## Memory Recall',
    '以下是可用于回答的已保存记忆，请优先保持一致性：',
    '',
    ...sections,
  ].join('\n')

  logger.debug(`memory 注入完成: sections=${sections.length}`)
  return text
}

export interface MemoryFileMeta {
  name: string
  size: number
  updatedAt: string
}

export async function listMemoryFiles(): Promise<MemoryFileMeta[]> {
  await ensureMemoryFiles()
  const entries = await fs.readdir(MEMORY_DIR, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isMemoryFileName(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(MEMORY_DIR, entry.name)
        const stat = await fs.stat(fullPath)
        return {
          name: entry.name,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        }
      }),
  )

  return files.sort((a, b) => {
    if (a.name === 'MEMORY.md') return -1
    if (b.name === 'MEMORY.md') return 1
    return b.name.localeCompare(a.name)
  })
}

export async function readMemoryFile(name: string): Promise<string> {
  await ensureMemoryFiles()
  if (!isMemoryFileName(name)) {
    throw new Error('非法记忆文件名')
  }
  const fullPath = path.join(MEMORY_DIR, name)
  const normalized = path.normalize(fullPath)
  if (!normalized.startsWith(path.normalize(MEMORY_DIR))) {
    throw new Error('非法文件路径')
  }
  return await fs.readFile(normalized, 'utf8')
}
