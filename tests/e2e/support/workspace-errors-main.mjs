import { app, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
let fail = ''
let delay = 0
app.on('workspace-error-fixture', (_event) => {
    if (typeof _event === 'number') delay = _event
    else fail = _event
})
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, payload) => {
        const command = channel === 'journal:updates' ? payload.command : payload
        if (delay && command?.type !== 'state') await new Promise((resolve) => setTimeout(resolve, delay))
        if (command?.type === fail) throw new Error('Fixture: repository is unavailable')
        return listener(event, payload)
    })
await import(pathToFileURL(resolve('out/main/index.js')).href)
