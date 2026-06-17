import { BrowserWindow, dialog, IpcMainInvokeEvent } from 'electron'
import * as fs from 'fs/promises'

async function handleSaveScenario(
  _event: IpcMainInvokeEvent,
  content: string
): Promise<string | boolean> {
  void _event
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Simulation Topology',
    defaultPath: 'scenario.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
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
  _event: Electron.IpcMainInvokeEvent
): Promise<{ data: string; path: string } | null> {
  void _event
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Simulation Topology',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
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
