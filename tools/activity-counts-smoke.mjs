import { app, dialog } from 'electron'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const scratch = process.env.GITORIAN_VERIFY_STATE
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!scratch || !output) throw new Error('Run pnpm verify activity-counts')
app.setPath('userData', join(scratch, 'profile'))
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const repository = join(scratch, 'counted-work')
mkdirSync(repository)
const git = (...args) => execFileSync('git', args, { cwd: repository, windowsHide: true, stdio: 'ignore' })
git('init', '-b', 'main')
git('config', 'user.name', 'Fixture author')
git('config', 'user.email', 'fixture@example.com')
git('commit', '--allow-empty', '-m', 'First activity')
dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repository] })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        const js = (source) => window.webContents.executeJavaScript(source)
        const record = (value) => appendFileSync(join(output, 'actions.jsonl'), JSON.stringify(value) + '\n')
        const wait = async (source) => {
            for (let i = 0; i < 120; i++) {
                if (await js(source)) return
                await pause(50)
            }
            throw new Error(`Timed out: ${source}`)
        }
        try {
            await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
            // Retire onboarding only in this disposable profile. Repository import is fixture setup.
            await js(`localStorage.setItem('gitorian:onboarding:v1:local', 'dismissed')`)
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait('!!document.querySelector(".hub-filters")')
            record({ setup: await js(`window.journal.invoke({type:'addRepository'})`) })
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait(`!!document.querySelector('[aria-label="Refresh activity"]')`)
            await js(`document.querySelector('[aria-label="Refresh activity"]').click()`)
            await wait(`document.querySelectorAll('.hub-activity').length === 1`)
            await pause(500)
            await js(
                `window.countLabel = document.querySelector('.hub-filter-chip').firstElementChild.firstElementChild.firstElementChild`
            )
            record({ action: 'Refresh after adding nine real commits; retain the chip label node' })
            for (let i = 0; i < 9; i++) git('commit', '--allow-empty', '-m', `Activity ${i + 2}`)
            await js(`document.querySelector('[aria-label="Refresh activity"]').click()`)
            await wait(`document.querySelectorAll('.hub-activity').length === 10`)
            await pause(500)
            const retained = await js(
                `window.countLabel === document.querySelector('.hub-filter-chip').firstElementChild.firstElementChild.firstElementChild`
            )
            writeFileSync(join(output, 'activity-counts.png'), (await window.webContents.capturePage()).toPNG())
            assert.ok(retained, 'Count changes remounted the whole chip label')
            const counts = await js(
                `Array.from(document.querySelectorAll('.hub-filter-chip')).map(node => node.getAttribute('aria-label') || node.textContent)`
            )
            record({ retained, counts })
            assert.ok(counts[0].includes('10') && counts[1].includes('10'))
            await js(`document.querySelectorAll('.hub-filter-chip')[1].click()`)
            assert.equal(await js(`document.querySelectorAll('.hub-activity').length`), 10)
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: true }))
            window.close()
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
