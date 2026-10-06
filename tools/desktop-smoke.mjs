import { app, BrowserWindow } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = mkdtempSync(join(tmpdir(), 'weekly-j-desktop-'))
app.setPath('userData', directory)
let passed = false
let checking = false
app.on('browser-window-created', (_, window) => {
    window.webContents.once('did-finish-load', async () => {
        if (checking || window.webContents.getURL().includes('reference=')) return
        checking = true
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const result = await window.webContents.executeJavaScript(`(async () => {
                const initial = await window.journal.invoke({ type: 'state' })
                const created = await window.journal.invoke({ type: 'newDraft', week: '2026-10-05' })
                const draft = created.state.drafts.at(-1)
                const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Desktop recovery check' }] }] }
                await window.journal.invoke({ type: 'draft', draft: { ...draft, body } })
                const recovered = await window.journal.invoke({ type: 'state' })
                await window.journal.invoke({ type: 'popout', kind: 'activity', id: 'reference-check' })
                return { version: initial.state.version, node: typeof require,
                    panes: document.querySelectorAll('.pane').length,
                    recovered: recovered.state.drafts.at(-1).body.content[0].content[0].text }
            })()`)
            const reference = BrowserWindow.getAllWindows().find((item) => item.id !== window.id)
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const referenceResult = await reference.webContents.executeJavaScript(
                `window.journal.invoke({type:'newDraft',week:'2026-10-05'}).then(()=>false,()=>true)`
            )
            passed =
                result.version === 1 &&
                result.node === 'undefined' &&
                result.panes === 3 &&
                result.recovered === 'Desktop recovery check' &&
                referenceResult
            console.info(
                JSON.stringify({
                    ...result,
                    referenceReadOnly: referenceResult,
                    electron: process.versions.electron,
                    passed
                })
            )
        } catch (error) {
            console.error(error)
        }
        process.exitCode = passed ? 0 : 1
        app.quit()
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
/** @param {unknown} error */
function fail(error) {
    console.error(error)
    process.exitCode = 1
    app.quit()
}
import(pathToFileURL(resolve('out/main/index.js')).href).catch(fail)
