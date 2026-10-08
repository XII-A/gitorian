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
    window.show = () => window.hide()
    window.webContents.once('did-finish-load', async () => {
        if (checking || window.webContents.getURL().includes('reference=')) return
        checking = true
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            window.webContents.debugger.attach('1.3')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
            })
            const reducedMotion = await window.webContents.executeJavaScript(`(async () => {
                document.querySelector('.hub-thread').scrollIntoView()
                await new Promise(resolve => setTimeout(resolve, 100))
                const value = matchMedia('(prefers-reduced-motion: reduce)').matches && document.querySelectorAll('.pin-spacer').length === 0
                return value
            })()`)
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
            window.webContents.debugger.detach()
            window.webContents.setBackgroundThrottling(false)
            const stablePickerHeight = await window.webContents.executeJavaScript(`(async () => {
                document.querySelector('.hub-date-controls > div > button').click()
                await new Promise(resolve => setTimeout(resolve, 700))
                const panel = document.querySelector('[role="dialog"]')
                const surface = panel.parentElement
                const initial = panel.offsetHeight
                const heights = []
                const start = performance.now()
                panel.querySelector('[aria-label="Previous month"]').click()
                await new Promise(resolve => {
                    const sample = () => {
                        heights.push(panel.offsetHeight, surface.getBoundingClientRect().height)
                        if (performance.now() - start < 1000) requestAnimationFrame(sample)
                        else resolve()
                    }
                    requestAnimationFrame(sample)
                })
                panel.querySelector('button').focus()
                Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click()
                await new Promise(resolve => setTimeout(resolve, 300))
                return { passed: heights.every(height => Math.abs(height - initial) < 2), initial, min: Math.min(...heights), max: Math.max(...heights) }
            })()`)
            const result = await window.webContents.executeJavaScript(`(async () => {
                const initial = await window.journal.invoke({ type: 'state' })
                const opensOnHub = !!document.querySelector('.weekly-hub')
                const date = new Date(new Date().toLocaleDateString('en-CA', { timeZone: initial.state.settings.timezone }) + 'T12:00:00Z')
                date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - initial.state.settings.weekStart + 7) % 7) - 7)
                const expectedWeek = date.toISOString().slice(0, 10)
                const chooseLastWeek = async () => {
                    document.querySelector('.hub-date-controls > div > button').click()
                    await new Promise(resolve => setTimeout(resolve, 600))
                    const panel = document.querySelector('[role="dialog"]')
                    Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Last week').click()
                    await new Promise(resolve => requestAnimationFrame(resolve))
                    Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Apply').click()
                    await new Promise(resolve => setTimeout(resolve, 300))
                }
                await chooseLastWeek()
                document.querySelector('[aria-label="Open journal"]').click()
                const deadline = Date.now() + 3000
                while (!document.querySelector('.workspace') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50))
                const fullWorkspace = document.querySelectorAll('.pane').length === 3 && !document.querySelector('.hub-writing')
                const opened = await window.journal.invoke({ type: 'state' })
                const autoCreatedDraft = opened.state.drafts.length === 1
                const expectedDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(expectedWeek + 'T12:00:00'))
                const selectedWeek = document.querySelector('.week-picker [aria-haspopup="dialog"] > span').textContent.trim() === expectedDate && opened.state.drafts.at(-1).week === expectedWeek
                const weekView = document.querySelector('[aria-label="Workspace navigation"] [aria-pressed="true"]').getAttribute('aria-label') === 'This week’s work'
                document.querySelector('.app-header button').click()
                await new Promise(resolve => setTimeout(resolve, 100))
                await chooseLastWeek()
                document.querySelector('[aria-label="Open journal"]').click()
                await new Promise(resolve => setTimeout(resolve, 200))
                const reopened = await window.journal.invoke({ type: 'state' })
                const reusedDraft = reopened.state.drafts.length === 1 && reopened.state.drafts[0].id === opened.state.drafts[0].id
                const created = await window.journal.invoke({ type: 'newDraft', week: '2026-10-05' })
                const draft = created.state.drafts.at(-1)
                const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Desktop recovery check' }] }] }
                await window.journal.invoke({ type: 'draft', draft: { ...draft, body } })
                const recovered = await window.journal.invoke({ type: 'state' })
                await window.journal.invoke({ type: 'popout', kind: 'activity', id: 'reference-check' })
                return { version: initial.state.version, node: typeof require,
                    opensOnHub, fullWorkspace, selectedWeek, weekView, autoCreatedDraft, reusedDraft,
                    panes: document.querySelectorAll('.pane').length,
                    recovered: recovered.state.drafts.at(-1).body.content[0].content[0].text }
            })()`)
            const reference = BrowserWindow.getAllWindows().find((item) => item.id !== window.id)
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const referenceResult = await reference.webContents.executeJavaScript(
                `window.journal.invoke({type:'newDraft',week:'2026-10-05'}).then(()=>false,()=>true)`
            )
            await window.webContents.executeJavaScript(`document.querySelector('.app-header button').click()`)
            await new Promise((resolve) => setTimeout(resolve, 100))
            passed =
                result.version === 1 &&
                result.node === 'undefined' &&
                result.opensOnHub &&
                result.fullWorkspace &&
                result.selectedWeek &&
                result.weekView &&
                result.autoCreatedDraft &&
                result.reusedDraft &&
                reducedMotion &&
                stablePickerHeight.passed &&
                result.panes === 3 &&
                result.recovered === 'Desktop recovery check' &&
                referenceResult
            console.info(
                JSON.stringify({
                    ...result,
                    reducedMotion,
                    stablePickerHeight,
                    referenceReadOnly: referenceResult,
                    electron: process.versions.electron,
                    passed
                })
            )
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
/** @param {unknown} error */
function fail(error) {
    console.error(error)
    process.exitCode = 1
    app.quit()
}
import(pathToFileURL(resolve('out/main/index.js')).href).catch(fail)
