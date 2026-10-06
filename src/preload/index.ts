import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '../shared/model'

const bridge: DesktopBridge = { invoke: (command) => ipcRenderer.invoke('journal:command', command) }
contextBridge.exposeInMainWorld('journal', bridge)
