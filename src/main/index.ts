import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { extractMarkdownPath } from './file-path'

let mainWindow: BrowserWindow | null = null
let pendingFilePath: string | null = null

function sendOrQueueFile(filePath: string): void {
  pendingFilePath = filePath
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('open-file', filePath)
    pendingFilePath = null
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 520,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function registerIpcHandlers(): void {
  ipcMain.handle('renderer-ready', () => {
    if (pendingFilePath && mainWindow) {
      mainWindow.webContents.send('open-file', pendingFilePath)
      pendingFilePath = null
    }
  })

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      return { ok: true, content: await readFile(filePath, 'utf8'), filePath }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
    try {
      await writeFile(filePath, content, 'utf8')
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false }

    const filePath = result.filePaths[0]
    try {
      return { ok: true, content: await readFile(filePath, 'utf8'), filePath }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle('save-file-dialog', async (_event, defaultPath?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return result.canceled || !result.filePath ? { ok: false } : { ok: true, filePath: result.filePath }
  })

  ipcMain.on('set-current-file', (_event, filePath: string | null) => {
    mainWindow?.setTitle(filePath ? `${basename(filePath)} - Markdown Editor` : 'Markdown Editor')
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  pendingFilePath = extractMarkdownPath(process.argv)

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    const filePath = extractMarkdownPath(commandLine, workingDirectory)
    if (filePath) sendOrQueueFile(filePath)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    registerIpcHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
