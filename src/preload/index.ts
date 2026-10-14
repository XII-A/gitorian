import { contextBridge, ipcRenderer } from 'electron'

import type { DesktopBridge, RepositoryImportProgress } from '../shared/model'

const bridge: DesktopBridge = {
    invoke: (command) => Promise.resolve(ipcRenderer.invoke('journal:command', command)),
    onRepositoryImportProgress: (listener) => {
        const receive = (_event: Electron.IpcRendererEvent, progress: RepositoryImportProgress) => {
            listener(progress)
        }
        ipcRenderer.on('journal:repository-import', receive)
        return () => ipcRenderer.removeListener('journal:repository-import', receive)
    }
}
contextBridge.exposeInMainWorld('journal', bridge)
