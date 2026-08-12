import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  onOpenFile: (callback: (filePath: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, filePath: string): void => callback(filePath)
    ipcRenderer.on('open-file', subscription)
    return (): void => {
      ipcRenderer.removeListener('open-file', subscription)
    }
  },
  rendererReady: () => ipcRenderer.invoke('renderer-ready') as Promise<void>,
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFileDialog: (defaultPath?: string) => ipcRenderer.invoke('save-file-dialog', defaultPath),
  setCurrentFile: (filePath: string | null) => ipcRenderer.send('set-current-file', filePath)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI

