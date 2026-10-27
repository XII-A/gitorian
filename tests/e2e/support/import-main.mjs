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

// Slow real discovery/inspection so transient states can be observed. Results remain real.
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const readDirectory = fsPromises.readdir
fsPromises.readdir = async (...args) => {
    await pause(5)
    return await readDirectory(...args)
}
const execute = childProcess.execFile
const executeAsync = promisify(execute)
childProcess.execFile = (...args) => execute(...args)
childProcess.execFile[promisify.custom] = async (...args) => {
    await pause(750)
    return await executeAsync(...args)
}
syncBuiltinESMExports()

app.on('browser-window-created', (_, window) => {
    window.setContentSize(1280, 900)
    window.webContents.setBackgroundThrottling(false)
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
