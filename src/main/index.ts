import { app, shell, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipcHandlers'
import {
  callLlmGradeAPI,
  resolveProviderConfig,
  type LlmGradeRequest,
  type LlmProviderConfig,
  type LlmProviderId
} from '../engine/analysis/llmGrader'

function createWindow(): void {
  const CLOSE_RESPONSE_TIMEOUT_MS = 5000

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Electron has no default context menu, so right-click gives no cut/copy/paste.
  // Provide a minimal editing menu for editable fields and selected text.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { editFlags, isEditable, selectionText } = params
    const hasSelection = selectionText.trim().length > 0
    const template: MenuItemConstructorOptions[] = []

    if (isEditable) {
      template.push(
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    } else if (hasSelection) {
      template.push(
        { role: 'copy', enabled: editFlags.canCopy },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      )
    }

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow })
    }
  })

  let isQuitting = false
  let awaitingCloseResponse = false
  let closeResponseTimer: ReturnType<typeof setTimeout> | null = null

  const clearCloseResponseTimeout = (): void => {
    if (closeResponseTimer) {
      clearTimeout(closeResponseTimer)
      closeResponseTimer = null
    }
  }

  const forceCloseWindow = (): void => {
    if (mainWindow.isDestroyed()) return
    isQuitting = true
    awaitingCloseResponse = false
    clearCloseResponseTimeout()
    mainWindow.close()
  }

  const handleCloseResponse = async (_event, isUnsaved) => {
    if (mainWindow.isDestroyed() || !awaitingCloseResponse) return

    awaitingCloseResponse = false
    clearCloseResponseTimeout()

    if (mainWindow.isDestroyed()) return

    const unsaved = Boolean(isUnsaved)

    if (unsaved) {
      let confirm = false
      try {
        confirm = await registerIpcHandlers.handleConfirmDiscardChanges(mainWindow)
      } catch (error) {
        console.log(error)
        confirm = false
      }

      if (confirm && !mainWindow.isDestroyed()) {
        forceCloseWindow()
      }
    } else {
      forceCloseWindow()
    }
  }

  ipcMain.on('window-close-response', handleCloseResponse)

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()

    if (awaitingCloseResponse) return

    if (mainWindow.webContents.isDestroyed() || mainWindow.webContents.isCrashed()) {
      forceCloseWindow()
      return
    }

    awaitingCloseResponse = true
    closeResponseTimer = setTimeout(() => {
      if (mainWindow.isDestroyed() || isQuitting) return

      console.warn(
        `Renderer did not respond to close request within ${CLOSE_RESPONSE_TIMEOUT_MS}ms; forcing close.`
      )
      forceCloseWindow()
    }, CLOSE_RESPONSE_TIMEOUT_MS)

    try {
      mainWindow.webContents.send('window-close-attempt')
    } catch (error) {
      console.error('Failed to dispatch close request to renderer:', error)
      forceCloseWindow()
    }
  })

  mainWindow.on('closed', () => {
    awaitingCloseResponse = false
    clearCloseResponseTimeout()
    ipcMain.removeListener('window-close-response', handleCloseResponse)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  ipcMain.handle('dialog:save', async (event, content) => {
    const filepath = await registerIpcHandlers.handleSaveScenario(event, content)

    console.log('Saved to', filepath)
    return filepath
  })

  ipcMain.handle('dialog:open', async (event) => {
    const content = await registerIpcHandlers.handleOpenScenario(event)
    return content
  })

  ipcMain.handle('dialog:confirm-discard', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      console.warn('No window found for confirm-discard dialog')
      return false
    }

    const result = await registerIpcHandlers.handleConfirmDiscardChanges(win)
    return result
  })

  ipcMain.on('nssimulator:run-simulation', (_, config) => {
    console.log('Received simulation config:', config)
  })

  // ── LLM justification grading (provider-agnostic proxy) ──────────────────
  // The API key lives exclusively in the main process; the renderer never sees
  // it. Settings-provided credentials are session-only and override environment
  // configuration for the lifetime of this app process.
  const environmentLlmConfig = resolveProviderConfig(process.env)
  let sessionLlmConfig: LlmProviderConfig | null = null

  const activeLlmConfig = (): LlmProviderConfig | null => sessionLlmConfig ?? environmentLlmConfig

  ipcMain.handle('llm:getGradingConfig', () => {
    const config = activeLlmConfig()
    return config
      ? {
          configured: true,
          providerId: config.providerId,
          source: sessionLlmConfig ? 'session' : 'environment'
        }
      : { configured: false }
  })

  ipcMain.handle('llm:setGradingConfig', (_event, payload: unknown) => {
    const value = payload as { providerId?: unknown; apiKey?: unknown }
    const providerId = value?.providerId
    const apiKey = typeof value?.apiKey === 'string' ? value.apiKey.trim() : ''

    if (providerId !== 'gemini' && providerId !== 'anthropic' && providerId !== 'openai') {
      return { error: 'Choose a supported LLM provider.' }
    }
    if (!apiKey) return { error: 'Enter an API key.' }

    sessionLlmConfig = { providerId: providerId as LlmProviderId, apiKey }
    return { ok: true, providerId, source: 'session' }
  })

  ipcMain.handle('llm:clearSessionGradingConfig', () => {
    sessionLlmConfig = null
    const config = activeLlmConfig()
    return config
      ? { configured: true, providerId: config.providerId, source: 'environment' }
      : { configured: false }
  })

  ipcMain.handle('llm:gradeJustification', async (_event, payload: LlmGradeRequest) => {
    const llmConfig = activeLlmConfig()
    if (!llmConfig) {
      return { error: 'No LLM grading provider configured.' }
    }
    try {
      const result = await callLlmGradeAPI(llmConfig, payload)
      return { ok: true, data: result }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[llm:gradeJustification] (${llmConfig.providerId}) error:`, message)
      return { error: message }
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
