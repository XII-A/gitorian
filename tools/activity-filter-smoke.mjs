import { tsImport } from 'tsx/esm/api'
import { seedJournal } from './seed-journal.mjs'
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkActivityFilterReset } from './activity-filter-check.mjs'

const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!process.env.GITORIAN_VERIFY_STATE || !output) throw new Error('Run pnpm verify activity-filters')
const directory = join(process.env.GITORIAN_VERIFY_STATE, 'profile')
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        const js = (source) => window.webContents.executeJavaScript(source)
        const wait = async (source) => {
            for (let i = 0; i < 100; i++) {
                if (await js(source)) return
                await new Promise((done) => setTimeout(done, 25))
            }
            throw new Error(`Keyboard filter check timed out: ${source}`)
        }
        const key = (keyCode) => {
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
            if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
        }
        try {
            const base = window.webContents.getURL().split('?')[0]
            await window.loadURL(base + '?workspace=true&week=2026-10-05')
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await window.webContents.executeJavaScript(`!!document.querySelector('.ws-activity-filters')`))
                    break
                await new Promise((resolve) => setTimeout(resolve, 25))
            }
            // Keep the real pointer off the toolbar to prove that its resting cue is visible.
            window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
            const result = await window.webContents.executeJavaScript(`(${checkActivityFilterReset.toString()})()`)
            window.focus()
            window.webContents.focus()
            await js(
                `document.querySelector('.ws-activity-filters').style.width='320px';document.querySelector('.activity-day-filter [role="combobox"]').focus()`
            )
            key('Down')
            await wait(`document.activeElement?.getAttribute('aria-expanded')==='true'`)
            const originalSize = window.getContentSize()
            window.setContentSize(originalSize[0], 420)
            await new Promise((done) => setTimeout(done, 500))
            const menuFitsAfterResize = await js(
                `(()=>{const list=document.getElementById(document.activeElement.getAttribute('aria-controls'));const option=list.querySelectorAll('[role="option"]')[7];const r=option.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(hit===option||option.contains(hit))})()`
            )
            key('Escape')
            await wait(`document.activeElement===document.querySelector('.activity-day-filter [role="combobox"]')`)
            window.setContentSize(...originalSize)
            const visibleFocus = await js(`getComputedStyle(document.activeElement).outlineStyle!=='none'`)
            key('Down')
            await wait(`document.activeElement?.getAttribute('aria-expanded')==='true'`)
            key('Tab')
            await wait(`document.activeElement===document.querySelector('.project-filter [role="combobox"]')`)
            key('Down')
            await wait(
                `document.activeElement?.tagName==='INPUT' && document.activeElement.getAttribute('role')==='combobox'`
            )
            window.webContents.insertText('developer')
            await wait(`document.activeElement.value==='developer'`)
            key('Return')
            await wait(`document.querySelector('.project-filter [role="combobox"]')?.title==='developer-docs'`)
            const selectionRestoresFocus = await js(
                `document.activeElement===document.querySelector('.project-filter [role="combobox"]')`
            )
            key('Down')
            await wait(`document.activeElement?.tagName==='INPUT'`)
            key('Home')
            key('Return')
            await wait(`document.querySelector('.project-filter [role="combobox"]')?.title==='All projects'`)
            result.keyboard = {
                visibleFocus,
                tabToProjects: true,
                selectionRestoresFocus,
                searchAndReset: true,
                menuFitsAfterResize
            }
            // A close can still be moving when the next keyboard action arrives. Keep
            // the new menu usable, and never restore old focus after Tab has moved on.
            key('Down')
            await wait(`document.activeElement?.tagName==='INPUT'`)
            key('Escape')
            await wait(
                `document.activeElement?.tagName==='BUTTON' && document.activeElement.getAttribute('aria-expanded')==='false'`
            )
            key('Down')
            await wait(
                `document.activeElement?.tagName==='INPUT' && document.activeElement.getAttribute('aria-expanded')==='true'`
            )
            await new Promise((done) => setTimeout(done, 1000))
            const reopenedMenuUsable = await js(
                `document.activeElement?.tagName==='INPUT' && document.activeElement.getAttribute('aria-expanded')==='true'`
            )
            if (!reopenedMenuUsable) throw new Error('A previous close interrupted the reopened project menu')
            key('Escape')
            await wait(
                `document.activeElement?.tagName==='BUTTON' && document.activeElement.getAttribute('aria-expanded')==='false'`
            )
            key('Tab')
            await wait(`document.activeElement===document.querySelector('.ws-history-chip')`)
            await new Promise((done) => setTimeout(done, 1000))
            const tabFocusRetained = await js(`document.activeElement===document.querySelector('.ws-history-chip')`)
            if (!tabFocusRetained) throw new Error('Closing the project menu stole focus back after Tab')
            result.keyboard.reopenedMenuUsable = reopenedMenuUsable
            result.keyboard.tabFocusRetained = tabFocusRetained
            result.passed &&= visibleFocus && selectionRestoresFocus && menuFitsAfterResize
            const hoverPoint = await js(
                `(()=>{const r=document.querySelector('.activity-filter-viewport').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
            )
            window.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint })
            await wait(
                `Number(getComputedStyle(document.querySelector('.activity-filter-scroll [data-axis="x"]')).opacity)>.9`
            )
            result.scrollbarRevealedOnHover = true
            window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
            await wait(
                `Number(getComputedStyle(document.querySelector('.activity-filter-scroll [data-axis="x"]')).opacity)<.01`
            )
            result.scrollbarHidesAfterHover = true
            writeFileSync(join(output, 'actions.jsonl'), JSON.stringify(result) + '\n')
            writeFileSync(join(output, 'journey.json'), JSON.stringify(result, null, 2))
            await window.webContents.executeJavaScript(
                `document.querySelector('.ws-frame').style.gridTemplateColumns='480px minmax(0, 1fr) 320px';document.querySelector('.ws-activity-filters').style.width='';document.querySelector('.activity-filter-viewport').scrollLeft=0`
            )
            await new Promise((done) => setTimeout(done, 500))
            writeFileSync(join(output, 'grouped-filters.png'), (await window.webContents.capturePage()).toPNG())
            // Appearance evidence only: keep timing and surface polish a manual review.
            await window.loadURL(base + '?week=2026-10-05')
            await wait(`!!document.querySelector('.hub-filter-dock')`)
            // Reserve a long timeline for the scroll capture.
            await js(`document.querySelector('.hub-timeline').style.minHeight='1200px'`)
            window.setContentSize(originalSize[0], 420)
            await new Promise((done) => setTimeout(done, 500))
            writeFileSync(join(output, 'hub-filters-resting.png'), (await window.webContents.capturePage()).toPNG())
            await wait(`!!document.querySelector('.hub-header-sky canvas[data-ready]')`)
            await js(`window.skyCanvasBeforeScroll=document.querySelector('.hub-header-sky canvas')`)
            await js(
                `(()=>{const v=document.querySelector('.hub-scroll').firstElementChild;v.scrollTop+=document.querySelector('.hub-filter-sentinel').getBoundingClientRect().top-v.getBoundingClientRect().top+20})()`
            )
            await wait(`document.querySelector('.hub-filter-dock').hasAttribute('data-stuck')`)
            await new Promise((done) => setTimeout(done, 300))
            await js(
                `(()=>{const row=document.querySelector('.hub-filters .activity-filter-items');const style=getComputedStyle(row);document.querySelector('.hub-filter-dock').style.width=(Array.from(row.children).reduce((sum,n)=>sum+n.getBoundingClientRect().width,0)+(row.children.length-1)*parseFloat(style.columnGap)+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+8)+'px'})()`
            )
            await new Promise((done) => setTimeout(done, 100))
            await js(`document.querySelector('.hub-filters .activity-day-filter [role="combobox"]').click()`)
            await wait(
                `!!Array.from(document.querySelectorAll('[role="option"]')).find(n=>n.textContent.includes('Wednesday'))`
            )
            await js(
                `Array.from(document.querySelectorAll('[role="option"]')).find(n=>n.textContent.includes('Wednesday')).click()`
            )
            await new Promise((done) => setTimeout(done, 500))
            const changedLabelStart = await js(
                `(()=>{const v=document.querySelector('.hub-filters .activity-filter-viewport');v.scrollLeft=0;return v.querySelector('.activity-filter-items').firstElementChild.getBoundingClientRect().left-v.getBoundingClientRect().left})()`
            )
            writeFileSync(
                join(output, 'hub-filter-label-change.json'),
                JSON.stringify({ start: changedLabelStart }, null, 2)
            )
            if (changedLabelStart < 0) throw new Error('Changing the day makes the first chip unreachable')
            await wait(`!!document.querySelector('.hub-filters .activity-day-filter [role="combobox"]')`)
            const dayLabel = await js(
                `(()=>{const trigger=document.querySelector('.hub-filters .activity-day-filter [role="combobox"]');const label=Array.from(trigger.querySelectorAll('span')).find(n=>!n.children.length&&n.textContent.includes('Wednesday'));return label?{text:label.textContent,width:label.clientWidth,fullWidth:label.scrollWidth}:null})()`
            )
            writeFileSync(join(output, 'hub-day-label.json'), JSON.stringify(dayLabel, null, 2))
            if (!dayLabel || Number(dayLabel.fullWidth) > Number(dayLabel.width) + 1)
                throw new Error('Selected day label is truncated')
            const reachability = await js(`(async()=>{
                const dock=document.querySelector('.hub-filter-dock');
                const viewport=dock.querySelector('.activity-filter-viewport');
                const row=dock.querySelector('.activity-filter-items');
                const observations=[];
                for(const width of [320,480,630,760]) {
                    dock.style.width=width+'px';
                    await new Promise(resolve=>setTimeout(resolve,100));
                    viewport.scrollLeft=viewport.scrollWidth;
                    viewport.scrollLeft=0;
                    await new Promise(resolve=>setTimeout(resolve,100));
                    observations.push({width,start:row.firstElementChild.getBoundingClientRect().left-viewport.getBoundingClientRect().left});
                }
                dock.style.width='';
                return observations;
            })()`)
            writeFileSync(join(output, 'hub-filter-reachability.json'), JSON.stringify(reachability, null, 2))
            if (reachability.some((value) => value.start < 0))
                throw new Error('First hub chip is unreachable at scroll start')
            writeFileSync(join(output, 'hub-filters-docked.png'), (await window.webContents.capturePage()).toPNG())
            writeFileSync(
                join(output, 'hub-filter-spacing.json'),
                JSON.stringify(
                    await js(`(()=>{
                const dock=document.querySelector('.hub-filter-dock').getBoundingClientRect();
                const items=document.querySelector('.hub-filters .activity-filter-items');
                return {leading:items.firstElementChild.getBoundingClientRect().left-dock.left,
                    trailing:dock.right-items.lastElementChild.getBoundingClientRect().right};
            })()`),
                    null,
                    2
                )
            )
            await js(`document.querySelector('.hub-filter-dock').style.width='320px'`)
            await new Promise((done) => setTimeout(done, 300))
            writeFileSync(
                join(output, 'hub-filters-docked-overflow.png'),
                (await window.webContents.capturePage()).toPNG()
            )
            await js(`document.querySelector('.hub-scroll').firstElementChild.scrollTop=0`)
            await wait(`!document.querySelector('.hub-filter-dock').hasAttribute('data-stuck')`)
            await wait(`!!document.querySelector('.hub-header-sky canvas[data-ready]')`)
            const skyResume = await js(
                `({retainedCanvas:window.skyCanvasBeforeScroll===document.querySelector('.hub-header-sky canvas')})`
            )
            writeFileSync(join(output, 'sky-scroll-resume.json'), JSON.stringify(skyResume, null, 2))
            if (!skyResume.retainedCanvas) throw new Error('Sky scroll return recreated the WebGL canvas')
            console.info(JSON.stringify(result))
            if (result.passed) window.close()
            else app.exit(1)
        } catch (error) {
            console.error(error)
            writeFileSync(
                join(output, 'focus-diagnostic.json'),
                JSON.stringify(
                    await js(
                        `({active:document.activeElement?.outerHTML, controls:Array.from(document.querySelectorAll('[role="combobox"]')).map(n=>({name:n.getAttribute('aria-labelledby'),expanded:n.getAttribute('aria-expanded'),title:n.title,focused:n===document.activeElement, inToolbar:!!n.closest('.activity-filter-strip')}))})`
                    ),
                    null,
                    2
                )
            )
            writeFileSync(join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG())
            app.exit(1)
        }
    })
})
setTimeout(() => {
    console.error('Activity filter smoke test timed out')
    app.exit(1)
}, 45000).unref()
const { sampleState } = await tsImport('../tests/workspace-fixture.ts', import.meta.url)
const fixture = sampleState('2026-10-05')
for (const repository of fixture.repositories) {
    repository.path = join(directory, 'repositories', repository.name)
    mkdirSync(repository.path, { recursive: true })
    for (const args of [
        ['init', '-b', 'main'],
        ['config', 'user.name', 'Alex'],
        ['config', 'user.email', 'alex@example.com'],
        ['commit', '--allow-empty', '-m', 'Filter history fixture'],
        ['branch', 'feat/offline-queue'],
        ['branch', 'fix/rtl-toolbar']
    ])
        execFileSync('git', args, { cwd: repository.path, windowsHide: true, stdio: 'ignore' })
}
await seedJournal(directory, fixture)
await import(pathToFileURL(resolve('out/main/index.js')).href)
