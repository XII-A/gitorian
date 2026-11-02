import type { WritingState } from '../shared/writing'
import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { SpellingContext, DesktopBridge, RepositoryImportProgress, NotionDiscoveryEvent } from '../shared/model'
import type { AppUpdateState } from '../shared/app-updates'

const bridge: DesktopBridge = {
    writing: {
        claim: (client) => ipcRenderer.invoke('journal:writing-claim', client),
        release: (client) => ipcRenderer.invoke('journal:writing-release', client),
        open: (draftId, generation, field) =>
            ipcRenderer.invoke('journal:writing-open', { draftId, generation, field }),
        submit: (request) => ipcRenderer.invoke('journal:writing-submit', request),
        onChange: (listener) => {
            const receive = (_event: Electron.IpcRendererEvent, state: WritingState) => listener(state)
            ipcRenderer.on('journal:writing-change', receive)
            return () => ipcRenderer.removeListener('journal:writing-change', receive)
        },
        onPrepare: (listener) => {
            const receive = (_event: Electron.IpcRendererEvent, id: string) => {
                void listener(id).then(
                    () => ipcRenderer.send('journal:writing-prepared', { id }),
                    (error: unknown) =>
                        ipcRenderer.send('journal:writing-prepared', {
                            id,
                            error: error instanceof Error ? error.message : 'Could not save writing'
                        })
                )
            }
            ipcRenderer.on('journal:writing-prepare', receive)
            return () => ipcRenderer.removeListener('journal:writing-prepare', receive)
        },
        onResume: (listener) => {
            ipcRenderer.on('journal:writing-resume', listener)
            return () => ipcRenderer.removeListener('journal:writing-resume', listener)
        }
    },
    spelling: {
        onContext: (listener) => {
            const receive = (_event: Electron.IpcRendererEvent, context: SpellingContext) => listener(context)
            ipcRenderer.on('journal:spelling-context', receive)
            return () => ipcRenderer.removeListener('journal:spelling-context', receive)
        },
        act: (id, action, word) => ipcRenderer.invoke('journal:spelling-action', { id, action, word })
    },
    readEntry: (id, restoreId) => ipcRenderer.invoke('journal:entry', { id, restoreId }),
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
