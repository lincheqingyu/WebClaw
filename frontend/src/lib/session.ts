/**
 * 会话 ID 管理
 * 使用 localStorage 持久化，支持页面刷新后恢复
 * 隐身模式或 localStorage 不可用时回退到内存级 ID
 */

const SESSION_ID_KEY = 'webclaw.sessionId'

/** 内存回退：localStorage 不可用时使用 */
let memorySessionId: string | null = null

/** 生成随机会话 ID */
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** 获取当前会话 ID（不存在则创建） */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY)
    if (existing) return existing

    const id = generateSessionId()
    localStorage.setItem(SESSION_ID_KEY, id)
    return id
  } catch {
    // localStorage 不可用（隐身模式等），回退内存
    if (memorySessionId) return memorySessionId
    memorySessionId = generateSessionId()
    return memorySessionId
  }
}

/** 重置会话 ID（新对话时调用） */
export function resetSessionId(): string {
  const id = generateSessionId()
  try {
    localStorage.setItem(SESSION_ID_KEY, id)
  } catch {
    // localStorage 不可用，回退内存
    memorySessionId = id
  }
  return id
}
