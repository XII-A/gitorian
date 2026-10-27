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
            const reducedMotion = process.env.GITORIAN_VERIFY_MOTION === 'stress'
            window.webContents.debugger.attach('1.3')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }]
            })
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
            await js(`(() => {
                window.summaryLabels=Array.from(document.querySelectorAll('.hub-stats > div > span'));
                const frames=[];window.__countMotion={frames};
                const moving=root=>root && Array.from(root.querySelectorAll('span')).some(node=>{
                    if(node.childElementCount || !/^[0-9]$/.test(node.textContent))return false;
                    const style=getComputedStyle(node);
                    return style.position==='absolute' && style.visibility==='visible' && Number(style.opacity)>.01 && Math.abs(new DOMMatrixReadOnly(style.transform).m42)>.05;
                });
                const sample=time=>{
                    frames.push({time,summary:moving(document.querySelector('.hub-stats strong')),chip:moving(document.querySelector('.hub-filter-chip')),labels:window.summaryLabels.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,transform:getComputedStyle(node).transform}})});
                    window.__countMotion.frame=requestAnimationFrame(sample);
                };window.__countMotion.frame=requestAnimationFrame(sample);
            })()`)
            await js(`document.querySelector('[aria-label="Refresh activity"]').click()`)
            await wait(
                `document.querySelector('.activity-day-toggle')?.getAttribute('aria-label').includes('Show 5 more') && document.querySelectorAll('.hub-activity').length === 5`
            )
            await pause(500)
            const motion = await js(`(() => {
                cancelAnimationFrame(window.__countMotion.frame);
                const stats=Array.from(document.querySelectorAll('.hub-stats > div'));
                return {frames:window.__countMotion.frames,labelsRetained:window.summaryLabels.every((node,i)=>node===stats[i].lastElementChild),stats:stats.map(node=>{
                    const strong=node.querySelector('strong'),counter=strong.querySelector('[data-variant="inline"]');
                    const text=counter?.querySelector(':scope > span:not([aria-hidden])')?.textContent ?? strong.textContent;
                    const size=getComputedStyle(strong).fontSize;
                    return {text,size,glyphSizes:Array.from(strong.querySelectorAll('span')).filter(n=>!n.childElementCount&&/^[0-9]$/.test(n.textContent)&&getComputedStyle(n).position==='absolute').map(n=>getComputedStyle(n).fontSize)};
                })};
            })()`)
            writeFileSync(
                join(output, 'summary-counter-motion.json'),
                JSON.stringify({ reducedMotion, ...motion }, null, 2)
            )
            assert.deepEqual(
                motion.stats.map((stat) => stat.text),
                ['10', '0', '1', '1']
            )
            assert.ok(motion.labelsRetained, 'Summary labels must remain mounted during counter updates')
            assert.ok(
                motion.stats.every(
                    (stat) => stat.glyphSizes.length && stat.glyphSizes.every((size) => size === stat.size)
                ),
                'Counter digits must retain summary typography'
            )
            const movingSummary = motion.frames.filter((frame) => frame.summary).length
            const movingChips = motion.frames.filter((frame) => frame.chip).length
            assert.ok(
                reducedMotion ? movingSummary === 0 && movingChips === 0 : movingSummary >= 2 && movingChips >= 2,
                'Summary and chip counts must both roll in normal motion and remain still in reduced motion'
            )
            assert.ok(
                motion.frames.every((frame) =>
                    frame.labels.every(
                        (label, i) =>
                            Math.abs(label.left - motion.frames[0].labels[i].left) < 0.5 &&
                            Math.abs(label.top - motion.frames[0].labels[i].top) < 0.5 &&
                            label.transform === 'none'
                    )
                ),
                'Summary labels must stay still while digits roll'
            )
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
            assert.equal(await js(`document.querySelectorAll('.hub-activity').length`), 5)
            assert.equal(
                await js(`document.querySelector('.activity-day-toggle').textContent.includes('Show 5 more')`),
                true
            )
            window.setMinimumSize(0, 0)
            window.setContentSize(390, 900)
            await pause(200)
            assert.ok(
                await js(`Array.from(document.querySelectorAll('.hub-stats strong')).every(strong=>{
                const size=getComputedStyle(strong).fontSize;
                return Array.from(strong.querySelectorAll('span')).filter(n=>!n.childElementCount&&/^[0-9]$/.test(n.textContent)&&getComputedStyle(n).position==='absolute').every(n=>getComputedStyle(n).fontSize===size);
            })`),
                'Summary digits must retain their larger typography at narrow widths'
            )
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
