import { app, nativeTheme } from 'electron'
import fsPromises from 'node:fs/promises'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

if (!process.env.GITORIAN_E2E_PROFILE) throw new Error('An owned desktop test profile is required')
app.setPath('userData', process.env.GITORIAN_E2E_PROFILE)
nativeTheme.themeSource = 'light'

// Hold only the operation whose transient UI the journey is observing.
// Releasing the hold resumes real filesystem/Git work without slowing every command.
let hold
app.on('gitorian-e2e-hold-io', (kind) => {
    if (hold) throw new Error('Release the previous import I/O hold first')
    let release
    const pending = new Promise((done) => {
        release = done
    })
    hold = { kind, pending, release }
})
const releaseIO = () => {
    hold?.release()
    hold = undefined
}
app.on('gitorian-e2e-release-io', releaseIO)
app.on('before-quit', releaseIO)
const readDirectory = fsPromises.readdir
fsPromises.readdir = async (...args) => {
    if (hold?.kind === 'discovery') await hold.pending
    return await readDirectory(...args)
}
const execute = childProcess.execFile
const executeAsync = promisify(execute)
childProcess.execFile = (...args) => execute(...args)
childProcess.execFile[promisify.custom] = async (...args) => {
    if (hold?.kind === 'inspection') await hold.pending
    return await executeAsync(...args)
}
syncBuiltinESMExports()

app.on('browser-window-created', (_, window) => {
    window.setContentSize(1280, 900)
    window.webContents.setBackgroundThrottling(false)
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
