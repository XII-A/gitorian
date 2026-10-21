import { app, BrowserWindow, ipcMain } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Session } from 'node:inspector'
// Diagnostic runtime: no user journal, credentials, providers or live development session are consumed.
// User-data and profiles are retained under .ai-docs for investigation; this tool never recursively deletes files.
const label = process.env.WRITING_PROFILE_LABEL ?? 'dev-current'
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(label)) throw Error('Invalid profile label')
const assertPerformance = process.env.WRITING_PROFILE_ASSERT === '1'
const directory = mkdtempSync(resolve('.ai-docs', 'dev-writing-userdata-'))
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const fixture = JSON.parse(readFileSync('.ai-docs/workspace-writing-profile-fixture.json', 'utf8'))
fixture.repositories.forEach((repo) => {
    repo.available = false
    repo.path = ''
    repo.remote = ''
})
const entryCount = Number(process.env.WRITING_ENTRIES_COUNT ?? '1')
fixture.entries = Array.from({ length: entryCount }, (_, i) => ({
    ...fixture.entries[0],
    id: `entry-${i}`,
    body: fixture.settings.template
}))
const activityCount = Number(process.env.WRITING_ACTIVITIES_COUNT ?? '4603')
fixture.activities = Array.from({ length: activityCount }, (_, i) => ({
    ...fixture.activities[i % fixture.activities.length],
    id: `dev-writing-${i}`
}))
const branchCount = Number(process.env.WRITING_BRANCHES_COUNT ?? '76')
if (branchCount)
    fixture.activities.forEach((activity, i) => {
        activity.branches = Array.from(
            { length: branchCount },
            (_, j) => `fixture-branch-${String(j).padStart(3, '0')}-xxxxxxxx`
        )
        if (i >= 600) activity.date = '2026-09-01T12:00:00Z'
    })
const fixtureBytes = Buffer.byteLength(JSON.stringify(fixture))
const db = new DatabaseSync(join(directory, 'weekly-j.sqlite'))
db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)')
db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify(fixture))
if (Number(process.env.WRITING_IMAGES_COUNT ?? 0) > 0) {
    db.exec(
        'CREATE TABLE images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL)'
    )
    const insert = db.prepare('INSERT INTO images VALUES(?,?,?,?,?)')
    for (const image of JSON.parse(readFileSync('.ai-docs/workspace-writing-images.json', 'utf8')))
        insert.run(image.id, image.mime, image.width, image.height, Buffer.from(image.bytes, 'base64'))
}
db.close()
const churn = process.env.WRITING_CHURN !== '0'
const activityChurn = process.env.WRITING_ACTIVITY_CHURN !== '0'
const legacyIPC = process.env.WRITING_LEGACY_IPC === '1'
const exposedMain = resolve('.ai-docs', `writing-main-${label}.mjs`)
let mainSource = readFileSync('out/main/index.js', 'utf8')
if (!mainSource.includes('store = new Store(')) throw Error('Cannot expose diagnostic Store: compiled entry changed')
mainSource = mainSource
    .replace('store = new Store(', 'store = globalThis.__writingStore = new Store(')
    .replace(
        /const directory = fileURLToPath\(new URL\("\.", import.meta.url\)\);/,
        `const directory = ${JSON.stringify(resolve('out/main'))};`
    )
mainSource = mainSource
    .replace(
        'new URL("./store-writer.js", import.meta.url)',
        `new URL(${JSON.stringify(pathToFileURL(resolve('out/main/store-writer.js')).href)})`
    )
    .replace(
        /from "(\.\/chunks\/[^"]+)"/g,
        (_, relative) => `from ${JSON.stringify(pathToFileURL(resolve('out/main', relative)).href)}`
    )
writeFileSync(exposedMain, mainSource)
const legacyPreload = resolve('.ai-docs', `writing-preload-${label}.cjs`)
writeFileSync(
    legacyPreload,
    `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('journal',{invoke:command=>ipcRenderer.invoke('journal:command',command),onRepositoryImportProgress:listener=>{const handler=(_,value)=>listener(value);ipcRenderer.on('journal:repository-import',handler);return()=>ipcRenderer.removeListener('journal:repository-import',handler)}})`
)
const commands = []
const sqliteExecs = []
const nativeExec = DatabaseSync.prototype.exec
DatabaseSync.prototype.exec = function (sql) {
    const start = performance.now()
    try {
        nativeExec.call(this, sql)
    } finally {
        sqliteExecs.push({ sql: sql.slice(0, 100), start, duration: performance.now() - start })
    }
}
const original = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    original(channel, async (...args) => {
        const start = performance.now()
        const result = await listener(...args)
        if (['journal:command', 'journal:updates'].includes(channel))
            commands.push({
                channel,
                type: channel === 'journal:updates' ? args[1]?.command?.type : args[1]?.type,
                start,
                duration: performance.now() - start,
                replyBytes: result?.stateUpdates ? Buffer.byteLength(JSON.stringify(result)) : undefined,
                version: result?.state?.snapshotVersion ?? result?.stateUpdates?.values?.snapshotVersion,
                records: result?.stateUpdates
                    ? Object.fromEntries(
                          Object.entries(result.stateUpdates.records).map(([key, value]) => [
                              key,
                              { upsert: value.upsert.length, remove: value.remove.length }
                          ])
                      )
                    : undefined
            })
        return result
    })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let started = false
app.on('browser-window-created', (_, initial) => {
    if (!globalThis.__writingChurnTimer) {
        const store = globalThis.__writingStore
        store.state.acquisition = { 'git:sample-repo-0': { status: 'running', offset: 0 } }
        store.state.snapshotVersion++
        globalThis.__writingChurnTimer = setInterval(() => {
            if (churn) {
                if (activityChurn) store.state.activities[0].description = `Background update ${Date.now()}`
                store.state.acquisition['git:sample-repo-0'].offset++
                store.state.snapshotVersion++
            }
        }, 2000)
    }
    initial.show = () => initial.hide()
    initial.webContents.setBackgroundThrottling(false)
    initial.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        try {
            const win = new BrowserWindow({
                show: false,
                width: 1560,
                height: 1000,
                useContentSize: true,
                webPreferences: {
                    offscreen: true,
                    backgroundThrottling: false,
                    preload: legacyIPC ? legacyPreload : resolve('out/preload/index.cjs'),
                    sandbox: true,
                    contextIsolation: true
                }
            })
            win.webContents.on('paint', () => {
                /* Keep hidden offscreen rendering active at its configured frame rate. */
            })
            win.webContents.setFrameRate(60)
            win.webContents.on('console-message', (event) => {
                if (event.level === 'error') console.error(event.message)
            })
            await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?workspace=true&week=2026-10-12`)
            initial.destroy()
            const js = (source) => win.webContents.executeJavaScript(source)
            for (let i = 0; i < 100 && !(await js(`!!document.querySelector('.tiptap')`)); i++) await pause(50)
            await pause(1200)
            const setup = await js(
                `({toggles:document.querySelectorAll('[data-type="toggleContent"]').length,development:!!document.querySelector('script[src="/@vite/client"]')})`
            )
            if (setup.toggles !== 10 || !setup.development)
                throw Error('Expected the ten-toggle Vite development fixture')
            win.webContents.debugger.attach('1.3')
            const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params)
            const rows = [],
                heartbeats = [],
                mainTicks = [],
                pending = []
            let phase = 'setup'
            win.webContents.debugger.on('message', (_, method, params) => {
                if (method !== 'Runtime.bindingCalled' || params.name !== '__writingAck') return
                const value = JSON.parse(params.payload)
                if (value.kind === 'heartbeat') heartbeats.push({ hostAt: performance.now(), ...value })
                else if (value.kind === 'key') {
                    const row = pending.shift()
                    if (row) Object.assign(row, { ackAt: performance.now(), rendererAt: value.at })
                }
            })
            await cdp('Runtime.addBinding', { name: '__writingAck' })
            await js(
                `window.__devWriting={longTasks:[],phase:'setup'};new PerformanceObserver(list=>window.__devWriting.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration,phase:window.__devWriting.phase})))).observe({type:'longtask'});setInterval(()=>window.__writingAck(JSON.stringify({kind:'heartbeat',at:performance.now()})),20);document.addEventListener('beforeinput',e=>{if(e.target.closest('.tiptap'))window.__writingAck(JSON.stringify({kind:'key',at:performance.now()}))},true)`
            )
            await cdp('Profiler.enable')
            await cdp('Profiler.start')
            await cdp('Performance.enable')
            const mainProfiler = new Session()
            mainProfiler.connect()
            const mainPost = (method) =>
                new Promise((resolve, reject) =>
                    mainProfiler.post(method, (error, result) => {
                        if (error) reject(error)
                        else resolve(result)
                    })
                )
            await mainPost('Profiler.enable')
            await mainPost('Profiler.start')
            const metrics = await cdp('Performance.getMetrics')
            const mainTimer = setInterval(() => mainTicks.push(performance.now()), 20)
            const setPhase = async (name) => {
                phase = name
                await js(`window.__devWriting.phase=${JSON.stringify(name)}`)
            }
            const locate = async (toggle) =>
                js(
                    `(()=>{const block=document.querySelector(${JSON.stringify(toggle ? '.tiptap [data-type="toggleContent"] > p' : '.tiptap > p')});const editor=document.querySelector('.tiptap');editor.focus();const range=document.createRange();range.selectNodeContents(block);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);block.scrollIntoView({block:'nearest'})})()`
                )
            const burst = async (count, interval) => {
                const start = performance.now()
                const promises = []
                for (let i = 0; i < count; i++) {
                    const scheduledAt = start + i * interval
                    await pause(Math.max(0, scheduledAt - performance.now()))
                    const row = { phase, index: rows.length, scheduledAt, sentAt: performance.now() }
                    rows.push(row)
                    pending.push(row)
                    promises.push(
                        cdp('Input.insertText', { text: String.fromCharCode(97 + (i % 26)) }).then(() => {
                            row.completedAt = performance.now()
                        })
                    )
                }
                await Promise.all(promises)
            }
            for (const toggle of [false, true]) {
                await locate(toggle)
                await setPhase(toggle ? 'toggle-burst' : 'paragraph-burst')
                await burst(180, 45)
                for (let i = 0; i < 5; i++) {
                    await setPhase(toggle ? 'toggle-idle' : 'paragraph-idle')
                    await pause(1350)
                    await setPhase(toggle ? 'toggle-resume' : 'paragraph-resume')
                    await burst(12, 45)
                }
            }
            clearInterval(mainTimer)
            clearInterval(globalThis.__writingChurnTimer)
            await pause(1300)
            await globalThis.__writingStore.flush()
            const { profile } = await cdp('Profiler.stop')
            writeFileSync(`.ai-docs/writing-${label}.cpuprofile`, JSON.stringify(profile))
            const mainProfile = await mainPost('Profiler.stop')
            writeFileSync(`.ai-docs/writing-${label}-main.cpuprofile`, JSON.stringify(mainProfile.profile))
            mainProfiler.disconnect()
            const renderer = await js('window.__devWriting')
            const navigationStart = metrics.metrics.find((metric) => metric.name === 'NavigationStart').value * 1000000
            const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]))
            let sampleAt = profile.startTime
            const classifiedTasks = renderer.longTasks.map((task) => ({
                ...task,
                gcMs: 0,
                totalSampleMs: 0,
                classification: 'app-or-native'
            }))
            for (let index = 0; index < profile.samples.length; index++) {
                sampleAt = Number(sampleAt) + Number(profile.timeDeltas[index])
                const at = (sampleAt - navigationStart) / 1000
                for (const task of classifiedTasks) {
                    if (at < task.start || at >= Number(task.start) + Number(task.duration)) continue
                    const ms = profile.timeDeltas[index] / 1000
                    task.totalSampleMs = Number(task.totalSampleMs) + ms
                    if (frames.get(profile.samples[index]).functionName === '(garbage collector)')
                        task.gcMs = Number(task.gcMs) + ms
                }
            }
            for (const task of classifiedTasks)
                if (task.totalSampleMs > 0 && task.gcMs / task.totalSampleMs >= 0.8) task.classification = 'gc'
            const editorJSON = await js(`JSON.stringify(document.querySelector('.tiptap').editor.getJSON())`)
            const verifyDb = new DatabaseSync(join(directory, 'weekly-j.sqlite'), { readOnly: true })
            const saved = verifyDb
                .prepare('SELECT json FROM state_records WHERE collection=? AND id=?')
                .get('drafts', fixture.drafts[0].id)
            verifyDb.close()
            const savedMatchesEditor = !!saved && JSON.stringify(JSON.parse(saved.json).body) === editorJSON
            const stats = (values) => {
                const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
                return {
                    n: sorted.length,
                    p50: sorted[Math.floor(sorted.length * 0.5)],
                    p95: sorted[Math.floor(sorted.length * 0.95)],
                    p99: sorted[Math.floor(sorted.length * 0.99)],
                    max: sorted.at(-1)
                }
            }
            const phases = {}
            for (const row of rows) (phases[row.phase] ??= []).push(row)
            const phaseStats = Object.fromEntries(
                Object.entries(phases).map(([name, rs]) => [
                    name,
                    {
                        scheduledToAck: stats(rs.map((r) => r.ackAt - r.scheduledAt)),
                        dispatchToAck: stats(rs.map((r) => r.ackAt - r.sentAt)),
                        dispatchToCompletion: stats(rs.map((r) => r.completedAt - r.sentAt)),
                        hostSchedulingDelay: stats(rs.map((r) => r.sentAt - r.scheduledAt))
                    }
                ])
            )
            const gaps = (values) => values.slice(1).map((value, i) => value - values[i])
            const mainTransactionExecs = sqliteExecs.filter(
                (row) => row.start >= mainTicks[0] && ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'].includes(row.sql)
            )
            const summary = {
                label,
                setup,
                churn,
                activityChurn,
                legacyIPC,
                savedMatchesEditor,
                fixtureBytes,
                entries: entryCount,
                activities: activityCount,
                branchCount,
                phaseStats,
                mainTransactionExecs,
                updateRequests: commands.filter((command) => command.channel === 'journal:updates').length,
                patchReplyBytes: stats(commands.map((command) => command.replyBytes)),
                mainCommandMs: stats(commands.map((command) => command.duration)),
                mainDraftMs: stats(
                    commands.filter((command) => command.type === 'draft').map((command) => command.duration)
                ),
                rendererHeartbeatGaps: stats(gaps(heartbeats.map((h) => h.at))),
                mainHeartbeatGaps: stats(gaps(mainTicks)),
                longTasks: classifiedTasks
            }
            writeFileSync(
                `.ai-docs/writing-${label}.json`,
                JSON.stringify({ ...summary, rows, heartbeats, mainTicks, commands, sqliteExecs, metrics }, null, 2)
            )
            console.info(JSON.stringify(summary))
            await globalThis.__writingStore.shutdown()
            if (
                assertPerformance &&
                (!savedMatchesEditor ||
                    rows.some((row) => !Number.isFinite(row.ackAt)) ||
                    Object.values(phaseStats).some((value) => value.dispatchToAck.p95 >= 33) ||
                    classifiedTasks.some((task) => task.classification !== 'gc') ||
                    mainTransactionExecs.length)
            )
                throw Error(
                    'Writing guard failed: saved body, key acknowledgements, p95 input latency, application long tasks or main-thread SQL transaction regression'
                )
            app.exit(0)
        } catch (error) {
            console.error(error)
            app.exit(1)
        }
    })
})
setTimeout(() => {
    console.error('Dev writing profile timed out')
    app.exit(1)
}, 100000).unref()
await import(pathToFileURL(exposedMain).href)
