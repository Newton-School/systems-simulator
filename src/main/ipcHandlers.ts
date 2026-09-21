import { BrowserWindow, dialog, IpcMainInvokeEvent } from 'electron'
import * as fs from 'fs/promises'

interface JsonFileDialogOptions {
  title?: string
  suggestedName?: string
  fileDescription?: string
}

function safeDialogText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, 160)
    : fallback
}

function safeSuggestedName(value: unknown): string {
  if (typeof value !== 'string') return 'scenario.json'
  const fileName = value.trim().split(/[\\/]/).pop()
  return fileName && fileName.length <= 200 ? fileName : 'scenario.json'
}

async function handleSaveScenario(
  _event: IpcMainInvokeEvent,
  content: string,
  options?: JsonFileDialogOptions
): Promise<string | boolean> {
  void _event
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: safeDialogText(options?.title, 'Save Simulation Topology'),
    defaultPath: safeSuggestedName(options?.suggestedName),
    filters: [
      { name: safeDialogText(options?.fileDescription, 'JSON Files'), extensions: ['json'] }
    ]
  })

  if (canceled || !filePath) {
    return false
  }

  try {
    await fs.writeFile(filePath, content, 'utf8')
    return filePath
  } catch (error) {
    console.error('Save Error:', error)
    throw error
  }
}

async function handleOpenScenario(
  _event: Electron.IpcMainInvokeEvent,
  options?: JsonFileDialogOptions
): Promise<{ data: string; path: string } | null> {
  void _event
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: safeDialogText(options?.title, 'Open Simulation Topology'),
    filters: [
      { name: safeDialogText(options?.fileDescription, 'JSON Files'), extensions: ['json'] }
    ],
    properties: ['openFile']
  })

  if (canceled || filePaths.length === 0) {
    return null
  }

  try {
    const filePath = filePaths[0]
    const content = await fs.readFile(filePath, 'utf8')

    return {
      data: content,
      path: filePath
    }
  } catch (error) {
    console.error('Read Error:', error)
    throw new Error('Failed to read the selected file.')
  }
}

async function handleConfirmDiscardChanges(win: BrowserWindow): Promise<boolean> {
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Discard Changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Unsaved Changes',
    message: 'You have unsaved changes.',
    detail: 'Discard changes and continue?'
  })

  return result.response === 0
}

export const registerIpcHandlers = {
  handleOpenScenario,
  handleSaveScenario,
  handleConfirmDiscardChanges
}
