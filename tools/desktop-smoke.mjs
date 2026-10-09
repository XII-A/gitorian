import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = mkdtempSync(join(tmpdir(), 'weekly-j-desktop-'))
app.setPath('userData', directory)
let checking = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.once('did-finish-load', async () => {
        if (checking || window.webContents.getURL().includes('reference=')) return
        checking = true
        let passed = false
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const result = await window.webContents.executeJavaScript(`(async () => {
                const before = await window.journal.invoke({type:'state'})
                const opensOnHub = !!document.querySelector('.hub-topbar')
                document.querySelector('[aria-label="Open journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 200))
                const workspace = document.querySelector('main[aria-label="Writing workspace"]')
                const blankWorkspace = !!workspace && workspace.children.length === 0 && !document.querySelector('.pane, .variant-picker, .writing-grid')
                const after = await window.journal.invoke({type:'state'})
                const noDraftCreated = after.state.drafts.length === before.state.drafts.length
                return {opensOnHub, blankWorkspace, noDraftCreated, node:typeof require, version:before.state.version}
            })()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
            await new Promise((resolve) => setTimeout(resolve, 200))
            const returnsToHub = await window.webContents.executeJavaScript(`!!document.querySelector('.hub-topbar')`)
            passed =
                result.opensOnHub &&
                result.blankWorkspace &&
                result.noDraftCreated &&
                returnsToHub &&
                result.node === 'undefined' &&
                result.version === 1
            console.info(JSON.stringify({ ...result, returnsToHub, electron: process.versions.electron, passed }))
        } catch (error) {
            console.error(error)
        }
        app.exit(passed ? 0 : 1)
    })
})
app.on('will-quit', () => {
    try {
        rmSync(directory, { recursive: true, force: true })
    } catch {
        // Chromium can retain a Windows user-data lock until the process exits.
    }
})
setTimeout(() => {
    console.error('Desktop launch timed out')
    app.exit(1)
}, 20000).unref()
import(pathToFileURL(resolve('out/main/index.js')).href).catch(
    /** @param {unknown} error */ (error) => {
        console.error(error)
        app.exit(1)
    }
)
