import { app, dialog } from 'electron'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const directory = mkdtempSync(join(tmpdir(), 'gitorian-acquisition-'))
const repositories = join(directory, 'repositories')
app.setPath('userData', directory)
for (let index = 0; index < 24; index++) {
    const path = join(repositories, `project-${index}`)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'work.txt'), 'A real change to inspect.\n')
    for (const args of [
        ['init', '-b', 'main'],
        ['config', 'user.name', 'Smoke author'],
        ['config', 'user.email', 'smoke@example.com'],
        ['add', 'work.txt'],
        ['commit', '-m', 'Recorded work']
    ])
        execFileSync('git', args, { cwd: path, windowsHide: true, stdio: 'ignore' })
}
dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repositories] })
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds))
let checking = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error(event.message)
    })
    window.webContents.once('did-finish-load', async () => {
        if (checking) return
        checking = true
        try {
            const result = await window.webContents.executeJavaScript(`(async () => {
                const scan=(await window.journal.invoke({type:'addRepositories'})).repositoryScan;
                const started=performance.now();
                const imported=await window.journal.invoke({type:'importRepositories',scanId:scan.id,paths:scan.repositories.map(item=>item.path)});
                const acknowledgmentMs=performance.now()-started;
                if(imported.state.repositoryImport?.status!=='running') throw new Error('Import did not acknowledge before completion');
                const baseline=await window.journal.invoke({type:'state'});
                const readStarted=performance.now();
                await window.journal.invoke({type:'state'});
                const cachedStateMs=performance.now()-readStarted;
                const settings=baseline.state.settings;
                const parts=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
                const part=type=>parts.find(value=>value.type===type).value;
                const date=new Date(part('year')+'-'+part('month')+'-'+part('day')+'T12:00:00Z');
                date.setUTCDate(date.getUTCDate()-((date.getUTCDay()-settings.weekStart+7)%7));
                const week=date.toISOString().slice(0,10);
                const created=await window.journal.invoke({type:'newDraft',week});
                const draft=created.state.drafts.at(-1);
                const saveStarted=performance.now();
                const saved=await window.journal.invoke({type:'draft',draft:{...draft,title:'Writing during import'}});
                const saveDuringImportMs=performance.now()-saveStarted;
                if(saved.state.repositoryImport?.status!=='running') throw new Error('Import finished before the concurrent writing check');
                if(!saved.state.drafts.some(item=>item.title==='Writing during import')) throw new Error('Draft was not persisted');
                return {acknowledgmentMs,cachedStateMs,saveDuringImportMs,week};
            })()`)
            console.info('Import acknowledged and concurrent draft saved', JSON.stringify(result))
            const base = window.webContents.getURL().split('?')[0]
            await window.loadURL(`${base}?workspace=true&week=${result.week}`)
            for (let attempt = 0; attempt < 100; attempt++) {
                if (
                    await window.webContents.executeJavaScript(
                        `!!document.querySelector('[aria-label="Journal body"][contenteditable="true"]')`
                    )
                )
                    break
                await pause(50)
            }
            result.editorReady = await window.webContents.executeJavaScript(
                `!!document.querySelector('[aria-label="Journal body"][contenteditable="true"]')`
            )
            await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Journal body"]').focus()`)
            await window.webContents.insertText('Writing remains available.')
            // Autosave debounces for one second. Observe the saved draft rather
            // than checking before that timer has had a chance to run.
            const typingStarted = Date.now()
            for (let attempt = 0; attempt < 30; attempt++) {
                await pause(100)
                result.typingSaved = await window.webContents.executeJavaScript(
                    `(async()=>JSON.stringify((await window.journal.invoke({type:'state'})).state.drafts[0].body).includes('Writing remains available.'))()`
                )
                if (result.typingSaved) break
            }
            result.typingSaveMs = Date.now() - typingStarted
            for (let attempt = 0; attempt < 200; attempt++) {
                if (
                    await window.webContents.executeJavaScript(
                        `(async()=>{const state=(await window.journal.invoke({type:'state'})).state;return state.repositories.length===24&&state.repositoryImport.status==='done'})()`
                    )
                )
                    break
                await pause(100)
            }
            console.info('Repository import finished')
            await window.webContents.executeJavaScript(`window.journal.invoke({type:'refresh'})`)
            for (let attempt = 0; attempt < 100; attempt++) {
                if (
                    await window.webContents.executeJavaScript(
                        `(async()=>(await window.journal.invoke({type:'state'})).state.activities.length>=24)()`
                    )
                )
                    break
                await pause(100)
            }
            result.repositoryCount = await window.webContents.executeJavaScript(
                `(async()=>(await window.journal.invoke({type:'state'})).state.repositories.length)()`
            )
            const activityId = await window.webContents.executeJavaScript(
                `(async()=>(await window.journal.invoke({type:'state'})).state.activities.find(item=>item.kind==='commit')?.id)()`
            )
            if (!activityId) throw new Error('No activity acquired')
            await window.loadURL(base)
            for (let attempt = 0; attempt < 100; attempt++) {
                if (
                    await window.webContents.executeJavaScript(
                        `!!document.querySelector('[aria-label="Dismiss setup"]')`
                    )
                )
                    break
                await pause(50)
            }
            await window.webContents.executeJavaScript(
                `document.querySelector('[aria-label="Dismiss setup"]')?.click()`
            )
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await window.webContents.executeJavaScript(`!!document.querySelector('.hub-activity')`)) break
                await pause(50)
            }
            console.info('Opening hub activity details')
            await window.webContents.executeJavaScript(`document.querySelector('.hub-activity').click()`)
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await window.webContents.executeJavaScript(`!!document.querySelector('.hub-detail-files')`)) break
                await pause(50)
            }
            result.hubFilesWithoutPatch = await window.webContents.executeJavaScript(
                `(async()=>{const state=(await window.journal.invoke({type:'state'})).state;return !!document.querySelector('.hub-detail-files') && Object.keys(state.diffs).length===0})()`
            )
            const database = new DatabaseSync(join(directory, 'journal.sqlite'))
            result.hubFilesWithoutPatch &&= database.prepare('SELECT count(*) AS count FROM patches').get().count === 0
            database.close()
            console.info('Opening selected activity in workspace')
            await window.webContents.executeJavaScript(`document.querySelector('.hub-detail-footer button').click()`)
            for (let attempt = 0; attempt < 100; attempt++) {
                if (
                    await window.webContents.executeJavaScript(`!!document.querySelector('.ws-inspector [role="tab"]')`)
                )
                    break
                await pause(50)
            }
            const diffTab = await window.webContents.executeJavaScript(
                `(()=>{const rect=Array.from(document.querySelectorAll('.ws-inspector [role="tab"]')).find(tab=>tab.textContent==='Diff').getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()`
            )
            window.webContents.sendInputEvent({ type: 'mouseDown', ...diffTab, button: 'left', clickCount: 1 })
            window.webContents.sendInputEvent({ type: 'mouseUp', ...diffTab, button: 'left', clickCount: 1 })
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await window.webContents.executeJavaScript(`!!document.querySelector('.diff-viewer .file-diff')`))
                    break
                await pause(50)
            }
            result.workerDiffRendered = await window.webContents.executeJavaScript(
                `!!document.querySelector('.diff-viewer .file-diff') && document.querySelector('.diff-viewer').textContent.includes('A real change to inspect.')`
            )
            result.cachedWorkspaceDetailsOpenImmediately = await window.webContents.executeJavaScript(`(async()=>{
                const inspector=document.querySelector('.ws-inspector')
                let loading=false
                const observer=new MutationObserver(records=>{
                    if(records.some(record=>record.oldValue==='false'&&inspector.getAttribute('aria-busy')==='true')) loading=true
                })
                observer.observe(inspector,{attributes:true,attributeFilter:['aria-busy'],attributeOldValue:true})
                document.querySelector('.ws-activity-row[aria-pressed="true"]').click()
                await new Promise(resolve=>setTimeout(resolve,100))
                observer.disconnect()
                return !loading&&inspector.getAttribute('aria-busy')==='false'
            })()`)
            if (
                !result.editorReady ||
                !result.typingSaved ||
                result.repositoryCount !== 24 ||
                !result.hubFilesWithoutPatch ||
                !result.workerDiffRendered ||
                !result.cachedWorkspaceDetailsOpenImmediately
            )
                throw new Error(JSON.stringify(result))
            console.info(JSON.stringify(result))
            app.exit(0)
        } catch (error) {
            console.error(error)
            console.error(await window.webContents.executeJavaScript(`document.body.innerText.slice(0,4000)`))
            app.exit(1)
        }
    })
})
app.on('will-quit', () => {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('gitorian-acquisition-')) return
    try {
        rmSync(target, { recursive: true, force: true })
    } catch {
        /* Chromium can retain locks until exit. */
    }
})
setTimeout(() => {
    console.error('Acquisition smoke timed out')
    app.exit(1)
}, 45000).unref()
await import(pathToFileURL(resolve('out/main/index.js')).href)
