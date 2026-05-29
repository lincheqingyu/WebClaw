// 中文：本文件（dev-full.mjs）位于 scripts/dev-full.mjs，负责启动前后端联调开发进程。
// English: This file (dev-full.mjs) starts the full-stack frontend/backend dev loop.

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function spawnDevProcess() {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm dev'], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
    })
  }

  return spawn('pnpm', ['dev'], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  })
}

const child = spawnDevProcess()

let finalized = false

function finalize(exitCode) {
  if (finalized) return
  finalized = true

  process.exit(exitCode)
}

function forwardSignal(signal, fallbackExitCode) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal)
    return
  }

  finalize(fallbackExitCode)
}

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  finalize(1)
})

child.on('exit', (code, signal) => {
  if (signal === 'SIGINT') {
    finalize(130)
    return
  }

  if (signal === 'SIGTERM') {
    finalize(143)
    return
  }

  finalize(code ?? 1)
})

process.on('SIGINT', () => forwardSignal('SIGINT', 130))
process.on('SIGTERM', () => forwardSignal('SIGTERM', 143))
