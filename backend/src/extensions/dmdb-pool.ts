/**
 * 达梦数据库连接池（懒初始化单例）
 * dmdb 包由用户手动安装，此模块做可选加载
 */

import { createRequire } from 'node:module'
import { getConfig } from '../config/index.js'
import { logger } from '../utils/logger.js'

const require = createRequire(import.meta.url)

let pool: unknown = null
let dmdb: { createPool: (opts: Record<string, unknown>) => Promise<unknown> } | null = null
let dmdbLoaded = false

/** 获取 dmdb 模块（可选依赖，未安装时返回 null） */
function loadDmdb(): typeof dmdb {
  if (dmdbLoaded) return dmdb
  dmdbLoaded = true

  try {
    dmdb = require('dmdb') as typeof dmdb
    return dmdb
  } catch {
    dmdb = null
    logger.warn('dmdb 包未安装，达梦数据库功能不可用')
    return null
  }
}

/** 获取连接池（懒初始化） */
export async function getDmPool(): Promise<unknown> {
  if (pool) return pool

  const db = loadDmdb()
  if (!db) {
    throw new Error('dmdb 包未安装，请运行: pnpm -F @webclaw/backend add dmdb')
  }

  const config = getConfig()
  if (!config.DM_CONNECT_STRING) {
    throw new Error('DM_CONNECT_STRING 未配置，请在 .env 中设置达梦数据库连接字符串')
  }
  logger.info("DM_CONNECT_STRING:", config.DM_CONNECT_STRING)
  pool = await db.createPool({
    connectString: config.DM_CONNECT_STRING,
    poolMax: 5,
    poolMin: 1,
  })
  logger.info('达梦数据库连接池已创建')
  return pool
}

/** 关闭连接池（优雅退出时调用） */
export async function closeDmPool(): Promise<void> {
  if (pool) {
    await (pool as { close: () => Promise<void> }).close()
    pool = null
    logger.info('达梦数据库连接池已关闭')
  }
}
