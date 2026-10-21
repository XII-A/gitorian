import { app, dialog } from 'electron'
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import fsPromises from 'node:fs/promises'
import childProcess from 'node:child_process'
import { promisify } from 'node:util'
import { syncBuiltinESMExports } from 'node:module'

// Uses the real Electron renderer, IPC, repository discovery and Git inspection.
// The native picker is automated against an isolated fixture folder.
const managed = process.env.WEEKLY_J_VERIFY_STATE
const directory = managed ? resolve(managed) : mkdtempSync(join(tmpdir(), 'weekly-j-import-'))
app.setPath('userData', join(directory, 'profile'))
const folder = join(directory, 'Projects')
const names = ['api-server', 'archived-tools', 'design-system', 'playground', 'team/website', 'tools/website']
for (const name of names) {
    const path = join(folder, name)
    mkdirSync(path, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: path, windowsHide: true, stdio: 'ignore' })
}
// Real directories make discovery long enough to capture its transient state.
for (let i = 0; i < 300; i++) mkdirSync(join(folder, 'scan-fixture', String(i)), { recursive: true })
const output = resolve(process.env.WEEKLY_J_VERIFY_OUTPUT || '.ai-docs/screenshots/repository-import')
mkdirSync(output, { recursive: true })
const record = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
// Slow real filesystem/Git work in this isolated capture process so transient
// screens can finish painting. No repository results or UI state are mocked.
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

let checking = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(event.message)
    })
    window.setContentSize(1280, 900)
    window.webContents.debugger.attach('1.3')
    void window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
    })
    window.webContents.once('did-finish-load', async () => {
        if (checking) return
        checking = true
        const js = (expression) => {
            record({ action: expression })
            return window.webContents.executeJavaScript(expression).catch(
                /** @param {unknown} error */ (error) => {
                    console.error('Failed expression:', expression)
                    throw error
                }
            )
        }
        const wait = async (expression) => {
            for (let i = 0; i < 150; i++) {
                if (await js(expression)) return
                await window.webContents.capturePage()
                await pause(40)
            }
            throw new Error(`Timed out: ${String(expression)}`)
        }
        const click = async (text) => {
            await js(
                `Array.from(document.querySelectorAll('.settings button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`
            )
            await pause(220)
        }
        const shot = async (name) => {
            for (let frame = 0; frame < 5; frame++) {
                await window.webContents.capturePage()
                await pause(100)
            }
            writeFileSync(join(output, `${String(name)}.png`), (await window.webContents.capturePage()).toPNG())
            record({ screenshot: `${String(name)}.png`, text: await js('document.body.innerText') })
        }
        try {
            await pause(400)
            await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
            const doctor = {
                url: window.webContents.getURL(),
                profile: app.getPath('userData'),
                version: app.getVersion(),
                electron: process.versions.electron,
                state: await js(`window.journal.invoke({type:'state'})`)
            }
            if (
                doctor.profile !== join(directory, 'profile') ||
                !doctor.url.startsWith(pathToFileURL(resolve('out/renderer/index.html')).href) ||
                doctor.state.state.repositories.length !== 0 ||
                doctor.state.connections.github ||
                doctor.state.connections.notion
            )
                throw new Error('Doctor rejected the build, isolated profile, or initial state')
            writeFileSync(join(output, 'doctor.json'), JSON.stringify(doctor, null, 2))
            for (const name of names.slice(0, 2)) {
                dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [join(folder, name)] })
                await js(`window.journal.invoke({type:'addRepository'})`)
            }
            await js(`(async()=>{
                const {state}=await window.journal.invoke({type:'state'});
                await window.journal.invoke({type:'settings',settings:{...state.settings,refreshMinutes:0}});
                await window.journal.invoke({type:'repository',repository:{...state.repositories[1],removed:true}});
            })()`)
            dialog.showOpenDialog = async () => {
                await pause(1800)
                return { canceled: false, filePaths: [folder] }
            }
            await js(`document.querySelector('[aria-label="Open settings"]').click()`)
            await wait(`!!document.querySelector('.settings-import-button')`)
            await shot('01-choose-folder')
            await click('Add repositories from folder')
            await wait(`document.querySelector('.repository-import-wait')?.textContent.includes('Waiting')`)
            await shot('02-folder-selection')
            await wait(
                `document.querySelector('.repository-scan-status[data-status=loading]')?.textContent.includes('Scanning')`
            )
            await shot('03-scanning')
            await wait(`!!document.querySelector('.repository-scan-status[data-status=success]')`)
            // The mark remains readable briefly before the list enters.
            await shot('03b-scan-success')
            await wait(`document.querySelectorAll('.repository-import-row').length===6`)
            await shot('04-review-all-selected')
            const assert = async (expression, message) => {
                if (!(await js(expression))) throw new Error(message)
            }
            await assert(
                `document.querySelectorAll('.repository-import-row [role="checkbox"][data-state="checked"]').length===5`,
                'Eligible repositories must start checked'
            )
            await assert(
                `document.querySelector('.repository-import-row [role="checkbox"][disabled]')?.getAttribute('data-state')==='unchecked'`,
                'Tracked repository must be disabled'
            )
            await click('Deselect all')
            await assert(
                `Array.from(document.querySelectorAll('.repository-import-footer button')).find(b=>b.textContent==='Import 0 repositories').disabled`,
                'Empty selection must disable import'
            )
            await click('Select all')
            await js(`document.querySelector('.repository-import-row [role="checkbox"][aria-labelledby]')?.focus()`)
            await js(
                `Array.from(document.querySelectorAll('.repository-import-row')).find(row=>row.textContent.includes('playground')).querySelector('[role="checkbox"]').click()`
            )
            await js(`(() => {
                const input=document.querySelector('.repository-import-tools input');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'website');
                input.dispatchEvent(new Event('input',{bubbles:true}));
            })()`)
            await wait(`document.querySelectorAll('.repository-import-row').length===2`)
            await shot('05-search-preserves-selection')
            await assert(
                `document.querySelector('.repository-import-footer').textContent.includes('4 of 5')`,
                'Search must preserve hidden selection'
            )
            await click('Cancel')
            await wait(`!!document.querySelector('.settings-import-button')`)
            await assert(
                `(async()=> (await window.journal.invoke({type:'state'})).state.repositories.length===2)()`,
                'Cancellation must not import'
            )
            await click('Add repositories from folder')
            await wait(`document.querySelectorAll('.repository-import-row').length===6`)
            await js(
                `Array.from(document.querySelectorAll('.repository-import-row')).find(row=>row.textContent.includes('playground')).querySelector('[role="checkbox"]').click()`
            )
            await shot('06-ready-to-import')
            for (const width of [390, 768, 1024, 1440]) {
                await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
                    width,
                    height: 900,
                    deviceScaleFactor: 1,
                    mobile: false
                })
                await pause(80)
                await assert(
                    `(() => { const panel=document.querySelector('.repository-import-review'); return panel.scrollWidth<=panel.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth })()`,
                    `Selection overflows at ${width}px`
                )
            }
            await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')

            await js(
                `Array.from(document.querySelectorAll('.repository-import-footer button')).find(b=>b.textContent==='Import 4 repositories').click()`
            )
            await wait(
                `document.querySelector('.settings-import-button')?.textContent.includes('Processing repositories')`
            )
            await shot('07-importing')
            await wait(
                `(async()=> (await window.journal.invoke({type:'state'})).state.repositoryImport?.status==='done')()`
            )
            await wait(
                `document.querySelector('.settings-import-button')?.textContent.includes('Add repositories from folder')`
            )
            await shot('08-complete')
            await assert(
                `(async()=> {
                const {state}=await window.journal.invoke({type:'state'});
                return state.repositories.length===5 && !state.repositories.some(r=>r.name==='playground') && state.repositories.find(r=>r.name==='archived-tools').removed===false && state.repositoryImport.total===4;
            })()`,
                'Import must add only selected repositories and resume stopped tracking'
            )
            writeFileSync(
                join(output, 'imported-state.json'),
                JSON.stringify(await js(`window.journal.invoke({type:'state'})`), null, 2)
            )
            // A single-repository folder also receives the review step.
            dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [join(folder, 'playground')] })
            await click('Add repositories from folder')
            await wait(`document.querySelectorAll('.repository-import-row').length===1`)
            await assert(
                `document.querySelector('.repository-import-footer').textContent.includes('Import 1 repository')`,
                'Single repository must still require review'
            )
            await js(
                `document.querySelector('.repository-import-heading h3').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))`
            )
            await wait(`!!document.querySelector('.settings-import-button')`)
            // A real failed scan morphs to an X, then reveals the actionable error.
            dialog.showOpenDialog = () =>
                Promise.resolve({ canceled: false, filePaths: [join(directory, 'missing-folder')] })
            await click('Add repositories from folder')
            await wait(`!!document.querySelector('.repository-scan-status[data-status=error]')`)
            await shot('09-scan-failed')
            await wait(`!!document.querySelector('.repository-import-results [role=alert]')`)
            await shot('10-error-details')
            await click('Back to Settings')
            await wait(`!!document.querySelector('.settings-import-button')`)
            // Reduced motion stops the loading loop. Cancelling a terminal
            // status also clears its delayed transition into the results.
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
            })
            dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] })
            await click('Add repositories from folder')
            await wait(`!!document.querySelector('.repository-scan-status[data-status=loading]')`)
            if (
                !(await js(
                    `getComputedStyle(document.querySelector('.repository-scan-status svg')).animationName==='none'`
                ))
            )
                throw new Error('Reduced motion still rotates the loader')
            await wait(`!!document.querySelector('.repository-scan-status[data-status=success]')`)
            await click('Cancel')
            await pause(1000)
            if (
                !(await js(
                    `!!document.querySelector('.settings-import-button') && !document.querySelector('.repository-import-review')`
                ))
            )
                throw new Error('Cancelled status revealed its results')
            console.info(
                JSON.stringify({
                    scanSuccessTransition: true,
                    scanErrorTransition: true,
                    reducedMotion: true,
                    selectedOnly: true,
                    cancelWithoutChanges: true,
                    searchPreservesSelection: true,
                    trackedDisabled: true,
                    stoppedResumed: true,
                    emptySelectionDisabled: true,
                    singleRepositoryReview: true,
                    escapeReturnsToSettings: true,
                    screenshots: output
                })
            )
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: true, feature: 'repository-import' }))
            app.exit(0)
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: false, error: String(error) }))
            await shot('failure')
            app.exit(1)
        }
    })
})
app.on('will-quit', () => {
    if (managed) return // The runner cleans up after Electron releases all profile locks.
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('weekly-j-import-')) return
    try {
        rmSync(target, { recursive: true, force: true })
    } catch {
        /* Chromium can retain profile locks. */
    }
})
setTimeout(() => {
    console.error('Repository import smoke timed out')
    app.exit(1)
}, 65000).unref()
await import(pathToFileURL(resolve('out/main/index.js')).href)
