import { app, dialog } from 'electron'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const scratch = process.env.GITORIAN_VERIFY_STATE
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!scratch || !output) throw new Error('Run pnpm verify hub-dialog')
app.setPath('userData', join(scratch, 'profile'))
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const samples = [
    { name: 'weekly-j', count: 18, title: 'Polish the weekly overview' },
    { name: 'design-system', count: 11, title: 'Refine chart interactions' },
    { name: 'api-service', count: 7, title: 'Improve request validation' },
    { name: 'docs-site', count: 4, title: 'Document the new workflow' }
]
const repositories = samples.map((sample) => {
    const repository = join(scratch, sample.name)
    mkdirSync(repository)
    const git = (...args) => execFileSync('git', args, { cwd: repository, windowsHide: true, stdio: 'ignore' })
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture author')
    git('config', 'user.email', 'fixture@example.com')
    for (let i = 0; i < sample.count; i++) git('commit', '--allow-empty', '-m', `${sample.title} (${i + 1})`)
    return repository
})
let importIndex = 0
dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repositories[importIndex++]] })
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
            await js(
                `Object.keys(localStorage).filter(key => key.startsWith('gitorian:onboarding:v1:')).forEach(key => localStorage.setItem(key, 'dismissed')); localStorage.setItem('gitorian:onboarding:v1:local', 'dismissed')`
            )
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait('!!document.querySelector(".hub-filters")')
            for (const sample of samples)
                record({ sample, setup: await js(`window.journal.invoke({type:'addRepository'})`) })
            await new Promise((done) => {
                window.webContents.once('did-finish-load', done)
                window.webContents.reload()
            })
            await wait(`!!document.querySelector('[aria-label="Refresh activity"]')`)
            await js(`document.querySelector('[aria-label="Refresh activity"]').click()`)
            await wait(`document.querySelectorAll('.hub-activity').length >= 5`)
            await wait(`document.querySelectorAll('.repository-chart button').length === 4`)
            const fixture = await js(`window.journal.invoke({type:'state'})`)
            assert.equal(fixture.state.activities.length, 40, 'Sample activity count')
            assert.equal(fixture.state.repositories.length, 4, 'Sample repository count')
            record({ fixture: samples, totalActivities: fixture.state.activities.length })
            await pause(500)
            window.setSize(1440, 1000)
            await js(`document.querySelector('.repository-activity').scrollIntoView({block:'center'})`)
            await pause(900)
            writeFileSync(join(output, 'repository-waffle.png'), (await window.webContents.capturePage()).toPNG())
            // Expand the real timeline to give the sidebar room to remain docked.
            await js(
                `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Show 35 more')).click()`
            )
            await wait(`document.querySelectorAll('.hub-activity').length === 40`)
            await pause(700)
            const dock = await js(`(() => {
                const card = document.querySelector('.repository-activity')
                const viewport = document.querySelector('.hub-scroll').firstElementChild
                const top = card.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
                viewport.scrollTop = top + 180
                return { top, inset: parseFloat(getComputedStyle(card).top) }
            })()`)
            await pause(500)
            const firstDock = await js(`document.querySelector('.repository-activity').getBoundingClientRect().top`)
            await js(`document.querySelector('.hub-scroll').firstElementChild.scrollTop += 160`)
            await pause(500)
            const secondDock = await js(`document.querySelector('.repository-activity').getBoundingClientRect().top`)
            assert.ok(Math.abs(firstDock - secondDock) < 2, 'Repository card stays docked while activity scrolls')
            record({ action: 'Scroll expanded activity with sticky repository card', dock, firstDock, secondDock })
            writeFileSync(join(output, 'repository-sticky.png'), (await window.webContents.capturePage()).toPNG())
            await js(`document.querySelector('.hub-scroll').firstElementChild.scrollTop = 0`)
            const measure = () =>
                js(`(() => {
                const rect = node => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} }
                return {root:rect(document.querySelector('#root')), hub:rect(document.querySelector('.hub-scroll')),
                    body:rect(document.body), margin:getComputedStyle(document.body).margin,
                    padding:getComputedStyle(document.body).padding, scrollWidth:document.documentElement.scrollWidth,
                    width:innerWidth, height:innerHeight, scrollHeight:document.documentElement.scrollHeight,
                    overlays:Array.from(document.querySelectorAll('[data-backdrop]')).map(rect)}
            })()`)
            for (const presentation of ['windowed', 'maximized', 'restored']) {
                if (presentation === 'maximized') window.maximize()
                if (presentation === 'restored') {
                    window.unmaximize()
                    window.setSize(1000, 720)
                }
                await js(`document.querySelector('.hub-activity').scrollIntoView({block:'center'})`)
                await pause(400)
                const before = await measure()
                const beforeImage = await window.webContents.capturePage()
                writeFileSync(join(output, `hub-before-${presentation}.png`), beforeImage.toPNG())
                await js(`document.querySelector('.hub-activity').click()`)
                await wait(`!!document.querySelector('.hub-detail-dialog')`)
                await pause(650)
                const after = await measure()
                record({ action: 'Open activity details', presentation, before, after })
                const afterImage = await window.webContents.capturePage()
                writeFileSync(join(output, `hub-dialog-${presentation}.png`), afterImage.toPNG())
                const edgePixels = (image) => {
                    const { width, height } = image.getSize()
                    const pixels = image.toBitmap()
                    return [3, width - 4].map((x) =>
                        Array.from(
                            pixels.subarray(
                                (Math.floor(height / 2) * width + x) * 4,
                                (Math.floor(height / 2) * width + x) * 4 + 4
                            )
                        )
                    )
                }
                record({ beforeEdges: edgePixels(beforeImage), afterEdges: edgePixels(afterImage) })
                assert.deepEqual(
                    edgePixels(afterImage),
                    edgePixels(beforeImage),
                    'Dialog backdrop darkened the native side frame'
                )
                assert.deepEqual(after.root, before.root, 'Opening a dialog shifted the app frame')
                assert.equal(after.scrollWidth, before.scrollWidth, 'Dialog changed horizontal overflow')
                assert.equal(after.scrollHeight, before.scrollHeight, 'Dialog changed vertical overflow')
                await js(`document.querySelector('.hub-detail-dialog [aria-label="Close dialog"]').click()`)
                await pause(500)
                assert.deepEqual((await measure()).root, before.root, 'Closing changed the app frame')
            }
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
