import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'
import { tsImport } from 'tsx/esm/api'
import { seedJournal } from './seed-journal.mjs'

const output = process.env.GITORIAN_VERIFY_OUTPUT
const profile = join(process.env.GITORIAN_VERIFY_STATE, 'profile')
app.setPath('userData', profile)
const { sampleState } = await tsImport('../tests/workspace-fixture.ts', import.meta.url)
const week = '2026-10-05'
const fixture = sampleState(week)
const activity = fixture.activities[0]
fixture.repositories[0].remote = ''
const legacy = 'https://example.org/previous'
fixture.drafts[0].body = {
    type: 'doc',
    content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before selected after.' }] },
        {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Earlier citation', marks: [{ type: 'link', attrs: { href: legacy } }] }]
        }
    ]
}
await seedJournal(profile, fixture)
const opened = []
shell.openExternal = async (url) => {
    opened.push(url)
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(check, message) {
    for (let i = 0; i < 100; i++) {
        if (await check()) return
        await pause(50)
    }
    throw new Error(message)
}
app.once('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', async () => {
        try {
            const wc = win.webContents
            const js = (source) => wc.executeJavaScript(source)
            const capture = async (name) => writeFileSync(join(output, name + '.png'), (await wc.capturePage()).toPNG())
            const click = async (selector) => {
                const point = await js(
                    `(() => {const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
                )
                await until(() => js(`(() => {
                    if (document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))) return true
                    for (const toast of document.querySelectorAll('[aria-label="Dismiss notification"]')) toast.click()
                    return false
                })()`), 'Cannot reach ' + selector)
                wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
                wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
                await pause(100)
            }
            const key = async (keyCode, modifiers = []) => {
                wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
                wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
                await pause(80)
            }
            await win.loadURL(wc.getURL().split('?')[0] + '?workspace=true&week=' + week)
            win.focus()
            await until(
                () => js("!!document.querySelector('.tiptap p') && !!document.querySelector('.ws-activity-row')"),
                'Workspace did not open'
            )
            await click('.tiptap p:nth-child(2) a')
            assert.deepEqual(opened, [legacy])
            const select = async (from, to = from) => {
                await js(
                    `{const el=document.querySelector('.tiptap');el.focus(); const t=el.querySelector('p').firstChild;getSelection().setBaseAndExtent(t,${from},t,${to})}`
                )
                await pause(100)
            }
            await select(7, 15)
            await click('.ws-activity-row')
            await until(
                () => js("!!document.querySelector('.ws-inspector-footer button:not(:disabled)')"),
                'Inspector did not open'
            )
            await js(
                `for(const toast of document.querySelectorAll('[aria-label="Dismiss notification"]')) toast.click()`
            )
            await pause(450)
            await click('.ws-inspector-footer button')
            const title = activity.title + ' (' + activity.sha.slice(0, 7) + ')'
            const paragraph = () => js("document.querySelector('.tiptap p').textContent")
            assert.equal(await paragraph(), 'Before ' + title + ' after.')
            await wc.insertText('!')
            assert.equal(await paragraph(), 'Before ' + title + '! after.')
            assert.equal(await js("document.querySelector('.tiptap p a').textContent"), title)
            await key('Z', ['control'])
            assert.equal(await paragraph(), 'Before ' + title + ' after.')
            await key('Z', ['control'])
            assert.equal(await paragraph(), 'Before selected after.')
            await click('.ws-inspector-footer button')
            await capture('cited')
            await click('.tiptap p a')
            const reference = () =>
                BrowserWindow.getAllWindows().find(
                    (w) => w !== win && w.webContents.getURL().includes('reference=activity')
                )
            await until(
                async () =>
                    reference() &&
                    (await reference().webContents.executeJavaScript(
                        "!!document.querySelector('.ws-details-content')"
                    )),
                'Activity reference did not open'
            )
            assert.equal(new URL(reference().webContents.getURL()).searchParams.get('id'), activity.id)
            await pause(350)
            writeFileSync(join(output, 'destination.png'), (await reference().webContents.capturePage()).toPNG())
            reference().close()
            await until(
                () =>
                    js(
                        `window.journal.invoke({type:'state'}).then(r => r.state.drafts.some(d => d.body.content[0].content.some(n => n.text === ${JSON.stringify(title)})))`
                    ),
                'Citation did not save'
            )
            win.focus()
            const dropPoint = await js(`(() => {
                const text = document.querySelector('.tiptap p').firstChild
                const r = document.createRange()
                r.setStart(text, 3)
                r.collapse(true)
                const rect = r.getBoundingClientRect()
                return {x: Math.round(rect.x), y: Math.round(rect.y + rect.height / 2)}
            })()`)
            const transfer = await js(`(() => {
                const data = new DataTransfer()
                document.querySelector('.ws-activity-row').dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:data}))
                return data.types.map(mimeType => ({mimeType, data:data.getData(mimeType)}))
            })()`)
            assert.equal(transfer[0].data, activity.id)
            wc.debugger.attach('1.3')
            const drag = (type, items) =>
                wc.debugger.sendCommand('Input.dispatchDragEvent', {
                    type,
                    ...dropPoint,
                    data: { items, dragOperationsMask: 1 }
                })
            const beforeDrop = await paragraph()
            for (const [items, finish] of [
                [transfer, 'dragCancel'],
                [[{ ...transfer[0], data: 'missing-activity' }], 'drop'],
                [transfer, 'drop'],
                [[{ mimeType: 'text/plain', data: 'plain' }], 'drop']
            ]) {
                await drag('dragEnter', items)
                await drag('dragOver', items)
                await drag(finish, items)
                if (finish === 'dragCancel' || items[0].data === 'missing-activity') {
                    assert.equal(await paragraph(), beforeDrop)
                } else {
                    const inserted = items === transfer ? title : 'plain'
                    assert.equal(await paragraph(), beforeDrop.slice(0, 3) + inserted + beforeDrop.slice(3))
                    await key('Z', ['control'])
                    assert.equal(await paragraph(), beforeDrop)
                }
            }
            wc.debugger.detach()
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: true, title, opened }))
            win.close()
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG())
            win.close()
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
