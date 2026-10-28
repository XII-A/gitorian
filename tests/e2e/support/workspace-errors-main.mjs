import { app, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
let fail = ''
app.on('workspace-error-fixture', (_event) => {
    fail = _event
})
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, payload) => {
        const command = channel === 'journal:updates' ? payload.command : payload
        if (command?.type === fail) throw new Error('Fixture: repository is unavailable')
        return listener(event, payload)
    })
await import(pathToFileURL(resolve('out/main/index.js')).href)
