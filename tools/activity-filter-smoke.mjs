import { app } from 'electron'
import { writeFileSync } from 'node:fs'
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
            await window.loadURL(base + '?workspace=true&data=sample&week=2026-10-05')
            for (let attempt = 0; attempt < 100; attempt++) {
                if (await window.webContents.executeJavaScript(`!!document.querySelector('.ws-activity-filters')`))
                    break
                await new Promise((resolve) => setTimeout(resolve, 25))
            }
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
            result.passed &&= visibleFocus && selectionRestoresFocus && menuFitsAfterResize
            writeFileSync(join(output, 'actions.jsonl'), JSON.stringify(result) + '\n')
            writeFileSync(join(output, 'journey.json'), JSON.stringify(result, null, 2))
            await window.webContents.executeJavaScript(
                `document.querySelector('.ws-frame').style.gridTemplateColumns='480px minmax(0, 1fr) 320px';document.querySelector('.ws-activity-filters').style.width='';document.querySelector('.activity-filter-viewport').scrollLeft=0`
            )
            await new Promise((done) => setTimeout(done, 500))
            writeFileSync(join(output, 'grouped-filters.png'), (await window.webContents.capturePage()).toPNG())
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
await import(pathToFileURL(resolve('out/main/index.js')).href)
