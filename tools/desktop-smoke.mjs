import { app, BrowserWindow } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = mkdtempSync(join(tmpdir(), 'weekly-j-desktop-'))
app.setPath('userData', directory)
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
let checking = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(event.message)
    })
    window.webContents.once('did-finish-load', async () => {
        if (checking || window.webContents.getURL().includes('reference=')) return
        checking = true
        let passed = false
        try {
            await pause(600)
            const result = await window.webContents.executeJavaScript(`(async () => {
                const before = await window.journal.invoke({type:'state'})
                const opensOnHub = !!document.querySelector('.hub-topbar')
                document.querySelector('[aria-label="Open journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 150))
                const workspaceImplemented = !!document.querySelector('.ws-frame') && document.querySelector('.writing-workspace').dataset.layout === 'three-panes' && !document.querySelector('.variant-picker')
                const noDraftCreated = (await window.journal.invoke({type:'state'})).state.drafts.length === before.state.drafts.length
                document.querySelector('[aria-label="Back to weekly hub"]').click()
                await new Promise(resolve => setTimeout(resolve, 100))
                const returnsToHub = !!document.querySelector('.hub-topbar')
                document.querySelector('[aria-label="Open journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 100))
                Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Start this week')).click()
                await new Promise(resolve => setTimeout(resolve, 200))
                document.querySelector('[aria-label="Journal body"]').focus()
                return {opensOnHub,workspaceImplemented,noDraftCreated,returnsToHub,node:typeof require,version:before.state.version}
            })().catch(error => ({failure:String(error),stack:error.stack,text:document.body.innerText}))`)
            if ('failure' in result) throw new Error(JSON.stringify(result))
            await window.webContents.insertText('The draft survives a restart.')
            await pause(700)
            result.draftSaved = await window.webContents.executeJavaScript(
                `(async () => JSON.stringify((await window.journal.invoke({type:'state'})).state.drafts[0].body).includes('The draft survives a restart.'))()`
            )
            const base = window.webContents.getURL().split('?')[0]
            await window.loadURL(base + '?workspace=true')
            await pause(400)
            result.draftRecovered = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('The draft survives a restart.')`
            )
            // A newer recovery copy must win over an older backend draft, then persist.
            await window.webContents.executeJavaScript(`(async () => {
                const state = (await window.journal.invoke({type:'state'})).state
                const draft = {...state.drafts[0],updatedAt:new Date(Date.now()+1000).toISOString(),body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Recovered an interrupted save.'}]}]}}
                localStorage.setItem('weekly-j:recovery:'+(state.restoreId??'local')+':'+draft.week,JSON.stringify(draft))
            })()`)
            await window.loadURL(base + '?workspace=true')
            await pause(650)
            result.interruptedSaveRecovered = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('Recovered an interrupted save.')`
            )
            await window.loadURL(base + '?workspace=true&data=sample&week=2026-10-05')
            await pause(500)
            const realDraftsBefore = await window.webContents.executeJavaScript(
                `(async () => (await window.journal.invoke({type:'state'})).state.drafts.length)()`
            )
            await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Pop out diff"]').click()`)
            await pause(600)
            const reference = BrowserWindow.getAllWindows().find((candidate) =>
                candidate.webContents.getURL().includes('reference=activity')
            )
            if (!reference) throw new Error('The native diff window did not open')
            result.nativeDiffWindow = await reference.webContents.executeJavaScript(
                `!!document.querySelector('.ws-reference') && document.querySelector('.diff').textContent.includes('BASE_DELAY_MS')`
            )
            result.referenceIsReadOnly = await reference.webContents.executeJavaScript(
                `(async () => { try { await window.journal.invoke({type:'newDraft',week:'2026-10-05'}); return false } catch(error) { return String(error).includes('read-only') } })()`
            )
            await reference.webContents.executeJavaScript(
                `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Cite in entry')).click()`
            )
            await pause(400)
            result.secondWindowCitation = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('Retry failed sync batches with backoff')`
            )
            await reference.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Note for your entry"]')?.focus() ?? document.querySelector('input').focus()`
            )
            await reference.webContents.insertText('Different failures need different answers.')
            await reference.webContents.executeJavaScript(
                `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Add note')).click()`
            )
            await pause(400)
            result.secondWindowNote = await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Journal body"]').textContent.includes('Different failures need different answers.')`
            )
            result.sampleIsolated = await window.webContents.executeJavaScript(
                `(async () => (await window.journal.invoke({type:'state'})).state.drafts.length === ${realDraftsBefore})()`
            )
            await reference.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Dock back to workspace"]').click()`
            )
            await pause(250)
            result.dockedBack =
                reference.isDestroyed() &&
                (await window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Pop out diff"]')`))
            passed = Object.entries(result).every(([key, value]) =>
                key === 'node' ? value === 'undefined' : key === 'version' ? value === 1 : value === true
            )
            console.info(JSON.stringify({ ...result, electron: process.versions.electron, passed }))
        } catch (error) {
            console.error(error)
        }
        app.exit(passed ? 0 : 1)
    })
})
app.on('will-quit', () => {
    // Check the absolute temporary target before removing smoke-test data on Windows.
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + '\\') || !target.includes('weekly-j-desktop-')) return
    try {
        rmSync(target, { recursive: true, force: true })
    } catch {
        /* Chromium may retain its user-data lock until exit. */
    }
})
setTimeout(() => {
    console.error('Desktop workspace smoke test timed out')
    app.exit(1)
}, 30000).unref()
import(pathToFileURL(resolve('out/main/index.js')).href).catch(
    /** @param {unknown} error */ (error) => {
        console.error(error)
        app.exit(1)
    }
)
