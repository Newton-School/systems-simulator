#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let electronBuilderCliPath

try {
  electronBuilderCliPath = require.resolve('electron-builder/out/cli/cli.js')
} catch {
  console.log('[postinstall] Skipping electron-builder install-app-deps because electron-builder is not installed.')
  process.exit(0)
}

const result = spawnSync(process.execPath, [electronBuilderCliPath, 'install-app-deps'], {
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 0)
