import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DesktopBridge, RepositoryImportProgress, NotionDiscoveryEvent } from '../shared/model'
import type { AppUpdateState } from '../shared/app-updates'
import type { Appearance } from '../shared/appearance'

const initialAppearance: Appearance = ipcRenderer.sendSync('journal:appearance-initial')
const bridge: DesktopBridge = {
    appearance: {
        initial: initialAppearance,
        select: (value) => ipcRenderer.invoke('journal:appearance', value),
        onChange: (listener) => {
            const receive = (_event: Electron.IpcRendererEvent, value: Appearance) => listener(value)
            ipcRenderer.on('journal:appearance', receive)
            return () => ipcRenderer.removeListener('journal:appearance', receive)
        }
    },
    clipboard: (action) => ipcRenderer.invoke('journal:clipboard', action),
    writeClipboardText: (text) => ipcRenderer.invoke('journal:clipboard-text', text),
    appUpdates: {
        state: () => ipcRenderer.invoke('journal:app-update-state'),
        install: () => ipcRenderer.invoke('journal:app-update-install'),
        onState: (listener) => {
            const receive = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => listener(state)
            ipcRenderer.on('journal:app-update-state', receive)
            return () => ipcRenderer.removeListener('journal:app-update-state', receive)
        }
    },
    images: {
        choose: (restoreId) => ipcRenderer.invoke('journal:image-choose', { restoreId }),
        import: (bytes, restoreId) => ipcRenderer.invoke('journal:image-import', { bytes, restoreId }),
        save: (id) => ipcRenderer.invoke('journal:image-save', id)
    },
    ...(process.platform === 'win32'
        ? {
              windowControls: {
                  action: (action) => ipcRenderer.invoke('journal:window', action),
                  setHoverExclusion: (bounds) => {
                      const zoom = webFrame.getZoomFactor()
                      ipcRenderer.send(
                          'journal:window-hover-exclusion',
                          bounds && {
                              x: bounds.x * zoom,
                              y: bounds.y * zoom,
                              width: bounds.width * zoom,
                              height: bounds.height * zoom
                          }
                      )
                  },
                  onHover: (listener) => {
                      const receive = (_event: Electron.IpcRendererEvent, hovered: boolean) => listener(hovered)
                      ipcRenderer.on('journal:window-hover', receive)
                      return () => ipcRenderer.removeListener('journal:window-hover', receive)
                  },
                  onState: (listener) => {
                      const receive = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }) =>
                          listener(state)
                      ipcRenderer.on('journal:window-state', receive)
                      return () => ipcRenderer.removeListener('journal:window-state', receive)
                  }
              } satisfies DesktopBridge['windowControls']
          }
        : {}),
    invoke: (command) => ipcRenderer.invoke('journal:command', command),
    updates: (command, base) => ipcRenderer.invoke('journal:updates', { command, base }),
    onNotionDiscoveryProgress: (listener) => {
        const receive = (_event: Electron.IpcRendererEvent, event: NotionDiscoveryEvent) => listener(event)
        ipcRenderer.on('journal:notion-discovery', receive)
        return () => ipcRenderer.removeListener('journal:notion-discovery', receive)
    },
    onRepositoryImportProgress: (listener) => {
        const receive = (_event: Electron.IpcRendererEvent, progress: RepositoryImportProgress) => listener(progress)
        ipcRenderer.on('journal:repository-import', receive)
        return () => ipcRenderer.removeListener('journal:repository-import', receive)
    }
}
contextBridge.exposeInMainWorld('journal', bridge)
