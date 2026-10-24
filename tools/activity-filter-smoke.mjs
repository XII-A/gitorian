import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkActivityFilterReset } from './activity-filter-check.mjs'

const temporaryRoot = resolve(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'gitorian-filter-check-'))
app.setPath('userData', directory)
app.on('will-quit', () => {
    if (!resolve(directory).startsWith(temporaryRoot + sep)) throw new Error('Unexpected smoke test directory')
    rmSync(directory, { recursive: true, force: true })
})
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        try {
            const base = window.webContents.getURL().split('?')[0]
            await window.loadURL(base + '?workspace=true&data=sample&week=2026-10-05')
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await window.webContents.executeJavaScript(`!!document.querySelector('.ws-activity-filters')`))
                    break
                await new Promise((resolve) => setTimeout(resolve, 25))
            }
            const result = await window.webContents.executeJavaScript(`(${checkActivityFilterReset.toString()})()`)
            console.info(JSON.stringify(result))
            app.exit(result.passed ? 0 : 1)
        } catch (error) {
            console.error(error)
            app.exit(1)
        }
    })
})
setTimeout(() => {
    console.error('Activity filter smoke test timed out')
    app.exit(1)
}, 30000).unref()
await import(pathToFileURL(resolve('out/main/index.js')).href)
