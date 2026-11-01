import { app, ipcMain } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
let fail = ''
let delay = 0
let stateDelay = 0
app.on('workspace-error-fixture-delay', (milliseconds) => {
    stateDelay = milliseconds
})
app.on('workspace-error-fixture', (_event) => {
    if (typeof _event === 'number') delay = _event
    else fail = _event
})
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, payload) => {
        const command = channel === 'journal:updates' ? payload.command : payload
        const wait = command?.type === 'state' ? stateDelay : delay
        if (wait) await new Promise((done) => setTimeout(done, wait))
        if (command?.type === fail || (fail === 'draft' && channel === 'journal:writing-submit'))
            throw new Error('Fixture: repository is unavailable')
        return listener(event, payload)
    })
await import(pathToFileURL(resolve('out/main/index.js')).href)
