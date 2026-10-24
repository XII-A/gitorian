// Historical production fixture: its legacy reply-only churn does not exercise compact updates.
// Use `pnpm smoke:writing` for the current true-Store development replay and performance guard.
import { app, ipcMain, BrowserWindow } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Diagnostic only: production app, isolated database, no credentials or network providers.
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'baseline'
const cacheDates = process.argv.includes('--cache-dates')
const assertPerformance = process.argv.includes('--assert')
mkdirSync(resolve('.ai-docs'), { recursive: true })
execFileSync(
    process.execPath,
    [fileURLToPath(import.meta.resolve('tsx/cli')), resolve('tools/workspace-writing-fixture.ts')],
    {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: 'pipe'
    }
)
const finish = (code) => {
    app.quit()
    // Offscreen windows may defer the normal close handshake; the synchronous before-quit
    // handlers have closed the store, and diagnostics should return their recorded status.
    app.exit(code)
}
const directory = mkdtempSync(join(tmpdir(), 'gitorian-writing-profile-'))
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const fixture = JSON.parse(readFileSync('.ai-docs/workspace-writing-profile-fixture.json', 'utf8'))
fixture.repositories.forEach((repo) => {
    repo.available = false
    repo.path = ''
    repo.remote = ''
})
const db = new DatabaseSync(join(directory, 'gitorian.sqlite'))
db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)')
db.prepare('INSERT INTO state VALUES(1, ?)').run(JSON.stringify(fixture))
db.close()
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const events = []
const handle = ipcMain.handle.bind(ipcMain)
let version = 1000
ipcMain.handle = (channel, listener) =>
    handle(channel, async (...args) => {
        const start = performance.now()
        const result = await listener(...args)
        if (channel === 'journal:command' && result?.state) {
            // Synthetic refreshed snapshots use the real service/IPC, without contacting a provider.
            result.state.snapshotVersion = version++
            result.state.acquisition = { 'git:sample-repo-0': { status: 'running' } }
            result.state.activities[0].description = `Synthetic acquisition update ${version}`
            events.push({ type: args[1]?.type, start, duration: performance.now() - start })
        }
        return result
    })
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.on('console-message', (event) => {
        if (['error', 'warning'].includes(event.level)) console.error('Renderer:', event.message)
    })
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        try {
            const base = window.webContents.getURL().split('?')[0]
            const initialWindow = window
            window = new BrowserWindow({
                show: false,
                width: 1560,
                height: 1000,
                useContentSize: true,
                webPreferences: {
                    offscreen: true,
                    backgroundThrottling: false,
                    preload: resolve('out/preload/index.cjs'),
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false
                }
            })
            window.webContents.on('paint', () => {
                // Keep Chromium's offscreen compositor producing frames while the window stays hidden.
            })
            window.webContents.setFrameRate(60)
            await window.loadURL(`${base}?workspace=true&week=2026-10-12`)
            initialWindow.destroy()
            const js = (source) => window.webContents.executeJavaScript(source)
            for (let i = 0; i < 100 && !(await js(`!!document.querySelector('.tiptap')`)); i++) await pause(50)
            if (process.argv.includes('--setup-only')) {
                if ((await js(`document.querySelectorAll('[data-type="toggleContent"]').length`)) !== 10)
                    throw Error('Expected the generated ten-toggle fixture')
                console.info(
                    'Writing profile setup passed: generated fixture, isolated store, production app and real IPC'
                )
                finish(0)
                return
            }
            await pause(1200)
            if (cacheDates)
                await js(
                    `(()=>{const cache=new Map();Date.prototype.toLocaleDateString=function(locales,options){const key=JSON.stringify([locales,options]);let formatter=cache.get(key);if(!formatter){formatter=new Intl.DateTimeFormat(locales,options);cache.set(key,formatter)}return formatter.format(this)}})()`
                )
            console.info(
                'Initial editor',
                await js(
                    `JSON.stringify({editors:document.querySelectorAll('.tiptap').length,toggles:document.querySelectorAll('[data-type="toggleContent"]').length,text:document.querySelector('.tiptap')?.textContent?.slice(0,150),html:document.querySelector('.tiptap')?.innerHTML?.slice(0,250),words:document.querySelector('.ws-writing-footer')?.textContent})`
                )
            )
            console.info(
                'Insert template',
                await js(
                    `(async()=>{const editor=document.querySelector('.tiptap').editor;const before=editor.getJSON();const reply=await window.journal.invoke({type:'state'});editor.commands.setContent(reply.state.settings.template);return {before,afterBlocks:editor.getJSON().content.length,toggles:document.querySelectorAll('[data-type="toggleContent"]').length}})()`
                )
            )
            await pause(1200)
            await js(
                `window.__writingProfile={keys:[],longTasks:[],phase:'setup'};new PerformanceObserver(l=>window.__writingProfile.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration,phase:window.__writingProfile.phase})))).observe({type:'longtask'});document.addEventListener('beforeinput',e=>{if(!e.target.closest('.tiptap'))return;const row={type:e.inputType,phase:window.__writingProfile.phase,start:performance.now()};window.__writingProfile.keys.push(row);requestAnimationFrame(()=>{row.nextFrame=performance.now()-row.start;setTimeout(()=>row.afterFrame=performance.now()-row.start,0)})},true)`
            )
            window.webContents.debugger.attach('1.3')
            const cdp = (method, params = {}) => window.webContents.debugger.sendCommand(method, params)
            await cdp('Profiler.enable')
            await cdp('Profiler.start')
            const place = async (selector, index, end = true) =>
                js(
                    `(()=>{const editor=document.querySelector('.tiptap');editor.focus();const block=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!block)throw Error('Missing target');const range=document.createRange();range.selectNodeContents(block);range.collapse(${!end});const selection=getSelection();selection.removeAllRanges();selection.addRange(range);block.scrollIntoView({block:'nearest'});return block.textContent.length})()`
                )
            const phase = async (name) => js(`window.__writingProfile.phase=${JSON.stringify(name)}`)
            for (const target of ['paragraph', 'toggle']) {
                console.info('Profiling target', target)
                console.info(
                    'Toggle count',
                    await js(`document.querySelectorAll('[data-type="toggleContent"]').length`)
                )
                await place(target === 'toggle' ? '.tiptap [data-type="toggleContent"] > p' : '.tiptap > p', 0)
                await phase(`${target}-burst`)
                for (let i = 0; i < 85; i++) {
                    await cdp('Input.insertText', { text: 'x' })
                    await pause(70)
                }
                for (let i = 0; i < 8; i++) {
                    await phase(`${target}-idle`)
                    await pause(1450)
                    await phase(`${target}-resume`)
                    await cdp('Input.insertText', { text: 'r' })
                    await pause(80)
                    await phase(`${target}-newblock`)
                    await cdp('Input.dispatchKeyEvent', {
                        type: 'keyDown',
                        key: 'Enter',
                        code: 'Enter',
                        windowsVirtualKeyCode: 13
                    })
                    await cdp('Input.dispatchKeyEvent', {
                        type: 'keyUp',
                        key: 'Enter',
                        code: 'Enter',
                        windowsVirtualKeyCode: 13
                    })
                    await cdp('Input.insertText', { text: 'New block writing' })
                }
            }
            await pause(1300)
            const { profile } = await cdp('Profiler.stop')
            writeFileSync(`.ai-docs/workspace-writing-${label}.cpuprofile`, JSON.stringify(profile))
            const result = await js('window.__writingProfile')
            const savedMatchesEditor = await js(
                `(async()=>{const reply=await window.journal.invoke({type:'state'});return JSON.stringify(reply.state.drafts[0].body)===JSON.stringify(document.querySelector('.tiptap').editor.getJSON())})()`
            )
            const groups = {}
            for (const row of result.keys) (groups[row.phase] ??= []).push(row.nextFrame)
            const stats = (xs) => {
                const values = xs.filter(Number.isFinite).sort((a, b) => a - b)
                return {
                    n: values.length,
                    p50: values[Math.floor(values.length * 0.5)],
                    p95: values[Math.floor(values.length * 0.95)],
                    p99: values[Math.floor(values.length * 0.99)],
                    max: values.at(-1)
                }
            }
            const output = {
                label,
                cacheDates,
                savedMatchesEditor,
                fixture: {
                    words: 2100,
                    activities: 600,
                    template: true,
                    background: 'synthetic updated state via actual app IPC'
                },
                phases: Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, stats(values)])),
                mainCommands: events,
                ...result
            }
            writeFileSync(`.ai-docs/workspace-writing-${label}.json`, JSON.stringify(output, null, 2))
            console.info(
                JSON.stringify({
                    label,
                    phases: output.phases,
                    savedMatchesEditor,
                    longTasks: result.longTasks,
                    commands: events.map((e) => ({ type: e.type, duration: e.duration }))
                })
            )
            if (!savedMatchesEditor) throw Error('Saved draft differs from the final editor document')
            if (
                assertPerformance &&
                (result.longTasks.length || Object.values(output.phases).some((value) => value.p99 >= 33))
            )
                throw Error('Writing performance guard failed: expected p99 <33 ms and zero renderer long tasks')
            finish(0)
        } catch (error) {
            console.error(error)
            finish(1)
        }
    })
})
app.on('will-quit', () => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected profile directory')
    rmSync(directory, { recursive: true, force: true })
})
setTimeout(() => {
    console.error('Writing profile timeout')
    finish(1)
}, 90000).unref()
await import(pathToFileURL(resolve('out/main/index.js')).href)
