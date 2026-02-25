/**
 * HTTP 服务器启动入口
 * 加载配置 → 初始化 Provider → 启动服务
 */

import 'dotenv/config'
import { loadConfig } from './config/index.js'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { logger } from './utils/logger.js'
import { initChatWebSocketServer } from './ws/chat-ws.js'

function main(): void {
  // 1. 加载并校验配置
  const config = loadConfig()

  // 2. 创建 Express 应用
  const app = createApp()
  const server = createServer(app)

  initChatWebSocketServer(server)

  // 4. 启动服务器
  server.listen(config.PORT, () => {
    logger.info(`服务器已启动: http://localhost:${config.PORT}`)
    logger.info(`环境: ${config.NODE_ENV}`)
    logger.info(`日志: ${config.LOG_LEVEL}`)
  })
}

main()
