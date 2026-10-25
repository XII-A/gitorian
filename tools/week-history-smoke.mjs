import { app, dialog } from 'electron'
import { mkdtempSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = mkdtempSync(join(tmpdir(), 'gitorian-week-history-'))
const repositories = join(directory, 'repositories')
app.setPath('userData', directory)
const authored = new Date()
authored.setUTCDate(authored.getUTCDate() - 14)
authored.setUTCHours(12, 0, 0, 0)
for (let index = 0; index < 5; index++) {
    const path = join(repositories, `project-${index}`)
    mkdirSync(path, { recursive: true })
    for (const args of [
        ['init', '-b', 'main'],
        ['config', 'user.name', 'Smoke author'],
        ['config', 'user.email', 'smoke@example.com'],
        ['commit', '--allow-empty', '-m', 'Earlier authored work']
    ])
        execFileSync('git', args, {
            cwd: path,
            windowsHide: true,
            stdio: 'ignore',
            env: { ...process.env, GIT_AUTHOR_DATE: authored.toISOString() }
        })
}
dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repositories] })
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let checking = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.hide()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (checking) return
        checking = true
        const evaluate = (expression) => window.webContents.executeJavaScript(expression)
        const waitFor = async (expression) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await evaluate(expression)) return
                await pause(100)
            }
            throw new Error(`Timed out: ${expression}`)
        }
        try {
            await waitFor('!!document.querySelector(".hub-topbar")')
            await evaluate(`(async()=>{
                const scan=(await window.journal.invoke({type:'addRepositories'})).repositoryScan;
                await window.journal.invoke({type:'importRepositories',scanId:scan.id,paths:scan.repositories.map(item=>item.path)});
            })()`)
            await waitFor(
                `(async()=> (await window.journal.invoke({type:'state'})).state.repositoryImport?.status==='done')()`
            )
            await evaluate(`document.querySelector('[aria-label="Refresh activity"]').click()`)
            await waitFor(`document.querySelector('.journal-notifications')?.textContent.includes('No activity found')`)
            const emptyToast = await evaluate(`document.querySelector('.journal-notifications').innerText`)
            if (await evaluate(`!!document.querySelector('[aria-label="Activity sources"]')`))
                throw new Error('Healthy sources button is visible')

            await evaluate(`document.querySelector('[aria-label^="Week:"]').click()`)
            await waitFor(`!!document.querySelector('[aria-label="Presets"]')`)
            const started = Date.now()
            await evaluate(
                `Array.from(document.querySelectorAll('[aria-label="Presets"] button')).find(button=>button.textContent==='2 weeks ago').click()`
            )
            await pause(100)
            await evaluate(
                `Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Apply').click()`
            )
            await waitFor(`document.querySelectorAll('.hub-activity').length===5`)
            const historicalWeekMs = Date.now() - started
            if (await evaluate(`!!document.querySelector('[aria-label="Activity sources"]')`))
                throw new Error('Cached history exposes healthy sources')

            const original = join(repositories, 'project-0')
            const moved = join(repositories, 'project-0-unavailable')
            renameSync(original, moved)
            await evaluate(`document.querySelector('[aria-label="Refresh activity"]').click()`)
            await waitFor(`!!document.querySelector('[aria-label="Activity sources"]')`)
            await evaluate(`document.querySelector('[aria-label="Activity sources"]').click()`)
            await waitFor(`!!document.querySelector('.acquisition-sources')`)
            const errorsOnly = await evaluate(`(()=>{
                const sources=document.querySelector('.acquisition-sources');
                return sources.children.length===1 && sources.textContent.includes('project-0') && !sources.textContent.includes('Pause') && !sources.textContent.includes('Refreshing');
            })()`)
            if (!errorsOnly) throw new Error('Source dialog did not restrict itself to the failed repository')
            renameSync(moved, original)
            await evaluate(
                `Array.from(document.querySelectorAll('.acquisition-sources button')).find(button=>button.textContent==='Retry').click()`
            )
            await waitFor(
                `!document.querySelector('[role="dialog"]') && !document.querySelector('[aria-label="Activity sources"]')`
            )
            await waitFor(
                `(async()=> Object.values((await window.journal.invoke({type:'state'})).state.acquisition).every(status=>status.status==='idle'))()`
            )
            console.info(
                JSON.stringify({
                    emptyToast,
                    historicalWeekMs,
                    localRepositories: 5,
                    errorsOnly,
                    retryClosesDialog: true
                })
            )
            app.exit(0)
        } catch (error) {
            console.error(error)
            app.exit(1)
        }
    })
})
app.on('will-quit', () => {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('gitorian-week-history-')) return
    try {
        rmSync(target, { recursive: true, force: true })
    } catch {
        /* Chromium may retain locks until exit. */
    }
})
setTimeout(() => {
    console.error('Week history smoke timed out')
    app.exit(1)
}, 45000).unref()
await import(pathToFileURL(resolve('out/main/index.js')).href)
