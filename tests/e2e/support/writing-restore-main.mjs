import { app } from 'electron'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

let armed = false
let release
app.on('writing-restore-hold', () => {
    armed = true
})
app.on('writing-restore-state', (state) => {
    state.held = !!release
})
app.on('writing-restore-release', (fail) => {
    release?.(fail)
    release = undefined
})
const send = Worker.prototype.postMessage
Worker.prototype.postMessage = function (message, ...args) {
    if (armed && message.operation === 'finishCredentialCleanup') {
        armed = false
        release = (fail) => {
            if (fail)
                this.emit('message', {
                    id: message.id,
                    error: { code: 'storage', message: 'Fixture post-restore cleanup failure' }
                })
            else send.call(this, message, ...args)
        }
        return
    }
    return send.call(this, message, ...args)
}
await import(pathToFileURL(resolve('out/main/index.js')).href)
