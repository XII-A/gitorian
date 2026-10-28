import { app, ipcMain } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { tsImport } from 'tsx/esm/api'

const { weekOf } = await tsImport('../src/shared/model.ts', import.meta.url)

// Real Electron, NSIS updater, loopback HTTP, editor, IPC and SQLite. Only the
// final installer launch is intercepted: these bytes must never be executed.
const directory = resolve(process.env.GITORIAN_VERIFY_STATE)
const output = resolve(process.env.GITORIAN_VERIFY_OUTPUT)
mkdirSync(join(directory, 'profile'), { recursive: true })
mkdirSync(join(directory, 'cache'), { recursive: true })
app.setPath('userData', join(directory, 'profile'))
// Launching a script rather than an installed app otherwise reports Electron's version.
app.getVersion = () => '0.1.4'
process.env.LOCALAPPDATA = join(directory, 'cache')
const record = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
// Capture the real startup check at the timer seam. Fixtures can advance that
// callback without adding a test-only manual-check command to the application.
let scheduledCheck
const scheduleTimeout = globalThis.setTimeout
globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 15000) {
        scheduledCheck = callback
        globalThis.setTimeout = scheduleTimeout
    }
    return scheduleTimeout(callback, delay, ...args)
}
let feed = 'offline'
let failSave = false
let failLaunch = false
let releaseImage
let holdImage = false
const requests = []
const installer = Buffer.alloc(12 * 1024 * 1024, 71)
const hash = createHash('sha512').update(installer).digest('base64')
const server = createServer((request, response) => {
    requests.push({ path: request.url, feed, time: Date.now() })
    if (request.url.startsWith('/latest.yml')) {
        if (feed === 'offline') return response.writeHead(503).end('Fixture offline')
        const version = feed === 'current' ? '0.1.4' : feed === 'older' ? '0.1.3' : '0.1.5'
        response.writeHead(200, { 'Content-Type': 'application/yaml' }).end(
            JSON.stringify({
                version,
                files: [{ url: 'update.exe', sha512: hash, size: installer.length }],
                path: 'update.exe',
                sha512: hash,
                releaseDate: '2026-10-25T00:00:00Z'
            })
        )
    } else if (request.url.startsWith('/update.exe')) {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installer.length })
        if (feed === 'corrupt') return response.end(Buffer.alloc(installer.length, 88))
        let offset = 0
        const timer = setInterval(() => {
            const end = Math.min(offset + 65536, installer.length)
            response.write(installer.subarray(offset, end))
            offset = end
            if (offset >= installer.length) {
                clearInterval(timer)
                response.end()
            }
        }, 65)
        response.on('close', () => clearInterval(timer))
    } else response.writeHead(404).end()
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const config = join(directory, 'app-update.yml')
writeFileSync(config, `provider: generic\nurl: ${origin}\nupdaterCacheDirName: fixture-updates\n`)
const require = createRequire(import.meta.url)
const imageBytes = await require('sharp')({ create: { width: 32, height: 24, channels: 3, background: '#75816a' } })
    .png()
    .toBuffer()
let updater
const nsis = require('electron-updater').NsisUpdater.prototype
const checkForUpdates = nsis.checkForUpdates
nsis.checkForUpdates = function () {
    updater = this
    this.forceDevUpdateConfig = true
    this.updateConfigPath = config
    this.disableDifferentialDownload = true
    this.logger = console
    this.spawnLog = launchInstaller
    return checkForUpdates.call(this)
}
// Enable only the isolated development fixture, before the first check.
Object.defineProperty(nsis, 'forceDevUpdateConfig', {
    get: () => true,
    set() {
        // Keep the production constructor's default from disabling this fixture.
    },
    configurable: true
})
const handoffs = []
let quitAttempts = 0
const quit = app.quit.bind(app)
app.quit = () => {
    quitAttempts++
    if (!failLaunch) setTimeout(quit, 500)
}
const launchInstaller = async (_file, args) => {
    await pause(10)
    if (failLaunch) throw Object.assign(new Error('Simulated asynchronous installer launch failure'), { code: 'EPERM' })
    const db = new DatabaseSync(join(directory, 'profile', 'journal.sqlite'), { readOnly: true })
    const drafts = db
        .prepare(
            "SELECT json_object('id',id,'title',title,'body',json(body),'week',week,'version',version,'updatedAt',updatedAt) AS json FROM drafts"
        )
        .all()
        .map((row) => JSON.parse(row.json))
    db.close()
    handoffs.push({ silent: args.includes('/S'), restart: args.includes('--force-run'), drafts })
    writeFileSync(join(output, 'installer-handoff.json'), JSON.stringify({ simulated: true, handoffs }, null, 2))
    return true
}
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, ...args) => {
        if (channel === 'journal:updates' && args[0].command.type === 'draft' && failSave)
            throw new Error('Simulated local save failure')
        if (channel === 'journal:image-import' && holdImage)
            await new Promise((done) => {
                releaseImage = done
            })
        return listener(event, ...args)
    })

let checking = false
let passed = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.setContentSize(1280, 900)
    window.webContents.debugger.attach('1.3')
    window.webContents.once('did-finish-load', async () => {
        if (checking) return
        checking = true
        const js = (code) => window.webContents.executeJavaScript(code)
        const wait = async (code, limit = 300) => {
            for (let i = 0; i < limit; i++) {
                if (await js(code)) return
                await window.webContents.capturePage().catch(() => {
                    // The first compositor frame may not exist yet; the wait retries.
                })
                await pause(50)
            }
            throw new Error(`Timed out: ${code}`)
        }
        const assert = (value, description) => {
            record({ assertion: description, passed: !!value })
            if (!value) throw new Error(description)
        }
        const click = async (selector) => {
            record({ click: selector })
            await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
            await pause(100)
        }
        const button = async (label) => {
            record({ button: label })
            await wait(
                `Array.from(document.querySelectorAll('button')).some(b=>!b.disabled && b.textContent.trim()===${JSON.stringify(label)})`
            )
            await js(
                `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`
            )
            await pause(100)
        }
        const escape = async () => {
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
            await pause(200)
            await wait(`!document.querySelector('.app-update-popover')`)
            await pause(50)
        }
        const shot = async (name) => {
            for (let i = 0; i < 5; i++) {
                await window.webContents.capturePage()
                await pause(100)
            }
            writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
            record({ screenshot: `${name}.png`, text: await js('document.body.innerText') })
        }
        const status = () => js('window.journal.appUpdates.state()')
        const waitStatus = (value) =>
            wait(`(async()=>(await window.journal.appUpdates.state()).status===${JSON.stringify(value)})()`)
        const check = () => {
            record({ fixture: 'Advance the real automatic startup-check callback at the timer seam' })
            if (!scheduledCheck) throw new Error('Automatic update check was not scheduled')
            scheduledCheck()
        }
        const hidden = async (description) =>
            assert(await js(`!document.querySelector('.app-update-trigger')`), description)
        try {
            await wait(`!!document.querySelector('[aria-label="Open settings"]') && !!window.journal.appUpdates`)
            const initial = await js(`window.journal.invoke({type:'state'})`)
            assert(
                initial.state.repositories.length === 0 && !initial.connections.github && !initial.connections.notion,
                'Empty journal-only fixture without personal accounts'
            )
            await hidden('Hub has no update button before an update is ready')
            check()
            await hidden('Checking for updates does not reveal a header button')
            await waitStatus('error')
            writeFileSync(
                join(output, 'doctor.json'),
                JSON.stringify(
                    {
                        profile: app.getPath('userData'),
                        origin,
                        realUpdater: updater.constructor.name,
                        renderer: window.webContents.getURL(),
                        version: updater.currentVersion.version,
                        initial
                    },
                    null,
                    2
                )
            )
            await hidden('A check failure leaves the update button hidden')
            await shot('01-check-failed')
            feed = 'current'
            check()
            await waitStatus('current')
            await hidden('Current versions have no update button')
            await shot('02-current')
            feed = 'older'
            check()
            await waitStatus('current')
            assert((await status()).status === 'current', 'An older feed never offers a downgrade')
            feed = 'corrupt'
            check()
            await waitStatus('error')
            await hidden('A corrupt download never reveals an update button')
            assert(
                (await status()).status === 'error' && !handoffs.length,
                'Corrupt installer rejected without installation or ready notification'
            )
            await shot('03-download-rejected')

            // Explicit setup: 200 paragraphs exercise snapshot/save cost without repositories.
            const fixtureState = await js(`window.journal.invoke({type:'state'})`)
            const week = weekOf(new Date(), fixtureState.state.settings)
            const created = await js(`window.journal.invoke(${JSON.stringify({ type: 'newDraft', week })})`)
            const draft = created.state.drafts.find((item) => item.week === week)
            assert(draft, 'Fixture creates a draft for the current journal week')
            record({
                fixture: 'Current-week writing draft',
                week,
                draftId: draft.id,
                timezone: fixtureState.state.settings.timezone,
                weekStart: fixtureState.state.settings.weekStart
            })
            draft.body = {
                type: 'doc',
                content: Array.from({ length: 200 }, (_, i) => ({
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text:
                                i === 199
                                    ? 'This week I shipped a quieter writing experience. '
                                    : `Journal note ${i + 1}: Investigated the import flow, reviewed changes, and recorded what I learned.`
                        }
                    ]
                }))
            }
            draft.title = 'A week of steady progress'
            await js(`window.journal.invoke(${JSON.stringify({ type: 'draft', draft })})`)
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait(`!!document.querySelector('[aria-label="Open journal"]')`)
            await click('[aria-label="Open journal"]')
            await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
            assert(
                await js(
                    `(()=>{const text=document.querySelector('[aria-label="Journal body"]').innerText;return text.includes('Journal note 1:') && text.includes('This week I shipped a quieter writing experience.')})()`
                ),
                'Writing opens the seeded 200-paragraph draft before measuring download responsiveness'
            )
            await js(
                `window.__editor=document.querySelector('[aria-label="Journal body"]'); window.__inputLatencies=[]; window.__frameGaps=[]; window.__editor.addEventListener('beforeinput',()=>{const start=performance.now(); requestAnimationFrame(()=>window.__inputLatencies.push(performance.now()-start))})`
            )
            await hidden('Workspace has no button before a ready update')
            feed = 'valid'
            check()
            await waitStatus('downloading')
            await hidden('Background downloading leaves the workspace header clear')
            const checks = requests.filter((request) => request.path.startsWith('/latest.yml')).length
            for (let i = 0; i < 5; i++) check()
            assert(
                requests.filter((request) => request.path.startsWith('/latest.yml')).length === checks,
                'Repeated checks share one in-flight download'
            )
            await shot('04-background-download')
            await js(
                `window.__editor.focus();const selection=getSelection();const range=document.createRange();range.selectNodeContents(window.__editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range)`
            )
            await js(
                `window.__measuring=true; let last=performance.now(); const frame=now=>{if(!window.__measuring)return;window.__frameGaps.push(now-last);last=now;requestAnimationFrame(frame)};requestAnimationFrame(frame)`
            )
            for (let i = 0; i < 90; i++) {
                window.webContents.insertText(`word${i} `)
                // Hidden verification windows need a compositor request to paint;
                // without it Chromium intentionally throttles RAF to one second.
                await window.webContents.capturePage()
                await pause(75)
            }
            await js(`window.__measuring=false`)
            assert(
                (await status()).status === 'downloading',
                'Sustained writing and autosave occur while bytes are downloading'
            )
            record({
                editor: await js(
                    `({active:document.activeElement?.outerHTML.slice(0,300),same:document.querySelector('[aria-label="Journal body"]')===window.__editor,text:window.__editor.innerText.includes('word89')})`
                )
            })
            assert(
                await js(
                    `document.activeElement===window.__editor && document.querySelector('[aria-label="Journal body"]')===window.__editor && window.__editor.innerText.includes('word89')`
                ),
                'Progress preserves editor identity, keyboard focus and all typed text'
            )
            const savedDuringDownload = await js(`window.journal.invoke({type:'state'})`)
            const savedDraft = savedDuringDownload.state.drafts.find((item) => item.id === draft.id)
            assert(
                savedDraft && JSON.stringify(savedDraft.body).includes('word0'),
                'Continuous typing crosses a durable autosave checkpoint during download'
            )
            await wait(`!!document.querySelector('[aria-label="Update ready"]')`)
            await wait(`document.body.innerText.includes('Gitorian 0.1.5 is ready')`)
            assert(await js(`document.activeElement===window.__editor`), 'Ready toast does not steal writing focus')
            await shot('05-update-ready-toast')
            assert(
                await js(
                    `(()=>{const b=document.querySelector('[aria-label="Update ready"]');return !b.textContent.trim() && !!b.querySelector('svg') && !!b.querySelector('.app-update-dot') && b.scrollWidth<=b.clientWidth+1})()`
                ),
                'Workspace update control stays icon-only with a ready status dot'
            )
            const measurements = await js(
                `window.__measuring=false;({latencies:window.__inputLatencies,gaps:window.__frameGaps})`
            )
            const p95 = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]
            const metrics = {
                inputCount: measurements.latencies.length,
                inputPaintP95Ms: p95(measurements.latencies),
                maxInputPaintMs: Math.max(...measurements.latencies),
                frameGapP95Ms: p95(measurements.gaps),
                maxFrameGapMs: Math.max(...measurements.gaps)
            }
            writeFileSync(join(output, 'writing-performance.json'), JSON.stringify(metrics, null, 2))
            assert(
                metrics.inputCount >= 90 &&
                    metrics.inputPaintP95Ms < 100 &&
                    metrics.maxInputPaintMs < 350 &&
                    metrics.maxFrameGapMs < 500,
                'Writing remains responsive under the throttled real download'
            )
            assert(handoffs.length === 0, 'Download completion never launches the installer')
            await click('[aria-label="Update ready"]')
            await shot('06-update-popover')
            await escape()
            await js(`document.querySelector('[aria-label="Journal breadcrumb"] button').click()`)
            await wait(`!!document.querySelector('.hub-utility-icons [aria-label="Update ready"]')`)
            assert(
                await js(
                    `(()=>{const b=document.querySelector('.hub-utility-icons [aria-label="Update ready"]');return !b.textContent.trim() && !!b.querySelector('svg') && !!b.querySelector('.app-update-dot')})()`
                ),
                'Hub exposes the same icon-only ready control and status dot'
            )
            await click('.hub-utility-icons [aria-label="Update ready"]')
            await wait(`document.querySelector('.app-update-popover')?.textContent.includes('Ready to update')`)
            await shot('06-hub-update-popover')
            await escape()
            await click('[aria-label="Open journal"]')
            await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
            await js(`window.__editor=document.querySelector('[aria-label="Journal body"]')`)
            await js(`window.__editor.focus()`)

            // A real pending image import must block restart, then recover.
            holdImage = true
            await js(
                `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(imageBytes.toString('base64'))}),c=>c.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'fixture.png',{type:'image/png'}));window.__editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`
            )
            await wait(
                `!!document.querySelector('.journal-image-pending') || !!document.querySelector('[data-image-import]') || document.body.innerText.includes('Cancel image import')`
            )
            await button('Update now')
            await wait(`document.body.innerText.includes('Finish or cancel image imports')`)
            assert(!handoffs.length, 'Pending images block installer handoff')
            holdImage = false
            releaseImage?.()
            await wait(`!!document.querySelector('.journal-image img')`)

            await click('[aria-label="Update ready"]')
            await shot('06-image-import-paused')
            await escape()
            await js(`window.__editor.focus()`)
            window.webContents.insertText(' Unsaved writing must survive.')
            failSave = true
            await click('[aria-label="Update ready"]')
            await button('Update now')
            await wait(`document.body.innerText.includes('Could not save your writing')`)
            assert(
                !handoffs.length && (await js(`window.__editor.getAttribute('contenteditable')==='true'`)),
                'A failed checkpoint blocks installation and unlocks writing'
            )
            await shot('07-save-blocks-update')
            failSave = false
            failLaunch = true
            const quitsBeforeFailure = quitAttempts
            await button('Update now')
            await wait(`document.body.innerText.includes('Could not start the installer')`)
            assert(
                !handoffs.length && (await js(`window.__editor.getAttribute('contenteditable')==='true'`)),
                'Installer preparation failure restores journal commands and editing'
            )
            await pause(200)
            assert(
                quitAttempts === quitsBeforeFailure,
                'An asynchronous launch failure never schedules application quit'
            )
            failLaunch = false
            await escape()

            // Dismissal remains quiet through navigation and a renderer reload.
            await js(`for(const b of document.querySelectorAll('[aria-label="Dismiss notification"]'))b.click()`)
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait(`!!document.querySelector('[aria-label="Open journal"]')`)
            await click('[aria-label="Open journal"]')
            await wait(
                `!!document.querySelector('[aria-label="Update ready"]') && !!document.querySelector('[aria-label="Journal body"]')`
            )
            assert(
                !(await js(
                    `document.querySelector('.journal-notifications')?.innerText.includes('Gitorian 0.1.5 is ready')`
                )),
                'Renderer reload preserves header access without repeating the ready toast'
            )
            window.setMinimumSize(0, 0)
            window.setContentSize(390, 780)
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
            })
            // Opening writing schedules the editor's initial focus. Let that
            // finish before starting a separate keyboard interaction.
            await wait(`document.activeElement?.getAttribute('aria-label')==='Journal body'`)
            await js(`document.querySelector('[aria-label="Update ready"]').focus()`)
            window.webContents.focus()
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
            window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
            await wait(`!!document.querySelector('.app-update-popover')`)
            assert(
                await js(
                    `(()=>{const r=document.querySelector('.app-update-popover').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})()`
                ),
                'Keyboard popover fits at 390px with reduced motion'
            )
            await shot('08-narrow-popover')
            await escape()
            await wait(`document.activeElement?.getAttribute('aria-label')==='Update ready'`)
            assert(
                await js(`document.activeElement?.getAttribute('aria-label')==='Update ready'`),
                'Escape restores update-trigger focus'
            )
            window.setContentSize(1280, 900)
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
            })
            await js(
                `const e=document.querySelector('[aria-label="Journal body"]');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r)`
            )
            window.webContents.insertText(' Final keystroke before updating.')
            await click('[aria-label="Update ready"]')
            await button('Update now')
            await hidden('The ready button disappears once installation starts')
            assert(
                handoffs.length === 1 &&
                    JSON.stringify(handoffs[0].drafts).includes('Final keystroke before updating.'),
                'Final keystroke is independently durable in SQLite before installer handoff'
            )
            passed = true
            writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify(
                    {
                        passed,
                        real: [
                            'Electron',
                            'preload',
                            'IPC',
                            'NSIS check/download/hash verification',
                            'editor input',
                            'autosave',
                            'SQLite'
                        ],
                        simulated: ['provider responses', 'installer launch', 'save/launch failures'],
                        metrics
                    },
                    null,
                    2
                )
            )
        } catch (error) {
            console.error(error)
            record({ error: String(error) })
            await shot('failure').catch(() => {
                // Keep the original journey failure if the window already closed.
            })
            writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify({ passed: false, error: String(error) }, null, 2)
            )
            server.closeAllConnections()
            server.close()
            app.exit(1)
        }
    })
})
app.on('will-quit', () => {
    server.closeAllConnections()
    server.close()
    if (!passed) process.exitCode = 1
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
