import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkActivityFilterReset } from './activity-filter-check.mjs'

const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!process.env.GITORIAN_VERIFY_STATE || !output) throw new Error('Run pnpm verify activity-filters')
const directory = join(process.env.GITORIAN_VERIFY_STATE, 'profile')
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
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
            writeFileSync(join(output, 'actions.jsonl'), JSON.stringify(result) + '\n')
            writeFileSync(join(output, 'journey.json'), JSON.stringify(result, null, 2))
            await window.webContents.executeJavaScript(
                `document.querySelector('.ws-frame').style.gridTemplateColumns='480px minmax(0, 1fr) 320px'`
            )
            await new Promise((done) => setTimeout(done, 500))
            writeFileSync(join(output, 'grouped-filters.png'), (await window.webContents.capturePage()).toPNG())
            console.info(JSON.stringify(result))
            if (result.passed) window.close()
            else app.exit(1)
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
            app.exit(1)
        }
    })
})
setTimeout(() => {
    console.error('Activity filter smoke test timed out')
    app.exit(1)
}, 30000).unref()
await import(pathToFileURL(resolve('out/main/index.js')).href)
