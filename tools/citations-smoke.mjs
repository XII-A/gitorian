import assert from 'node:assert/strict'
import sharp from 'sharp'
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
/** @type {import('../src/shared/model').State} */
const fixture = sampleState(week)
const activity = fixture.activities[0]
fixture.activities[2].title =
    'Mirror survey builder toolbar for RTL ' + 'with extended multilingual labels '.repeat(7).trim()
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
fixture.entries[0].body = {
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: 'Local activity',
                    marks: [{ type: 'link', attrs: { href: '#gitorian-activity=' + encodeURIComponent(activity.id) } }]
                }
            ]
        }
    ]
}
await seedJournal(profile, fixture)
const opened = []
shell.openExternal = (url) => {
    opened.push(url)
    return Promise.resolve()
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
            /** @param {string} name */
            const capture = async (name) => writeFileSync(join(output, name + '.png'), (await wc.capturePage()).toPNG())
            /** @param {string} selector */
            const click = async (selector) => {
                const point = await js(
                    `(() => {const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
                )
                await until(
                    () =>
                        js(`(() => {
                    if (document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))) return true
                    for (const toast of document.querySelectorAll('[aria-label="Dismiss notification"]')) toast.click()
                    return false
                })()`),
                    'Cannot reach ' + selector
                )
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
            assert.ok(activity.sha)
            const title = activity.title + ' (' + activity.sha.slice(0, 7) + ')'
            const paragraph = async () => String(await js("document.querySelector('.tiptap p').textContent"))
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
            await select(2, 5)
            const showPicker = async () => {
                await key('P', [process.platform === 'darwin' ? 'meta' : 'control', 'shift'])
                await until(
                    () => js("document.activeElement.matches('[role=dialog] input[role=combobox]')"),
                    'Picker search did not take focus'
                )
            }
            const activeLabel = () =>
                js(
                    "document.getElementById(document.activeElement.getAttribute('aria-activedescendant'))?.querySelector('[title]')?.title"
                )
            await showPicker()
            await pause(400)
            await capture('palette-open')
            const results = `document.querySelector('[aria-label="Activity results"]')`
            const searchTop = () => js("document.querySelector('[role=dialog] input').getBoundingClientRect().top")
            const fixedTop = await searchTop()
            const wheelPoint = await js(
                `(() => {const r=${results}.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
            )
            wc.sendInputEvent({ type: 'mouseMove', ...wheelPoint })
            wc.sendInputEvent({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -160 })
            await until(() => js(`${results}.scrollTop > 0`), 'Wheel did not scroll the activity results')
            await capture('palette-scrolled')
            /** @type {{x:number, y:number}} */
            const thumbPoint = await js(`(() => {
                const r=${results}.parentElement.querySelector('[data-axis=y] > div').getBoundingClientRect()
                return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}
            })()`)
            const beforeDrag = await js(`${results}.scrollTop`)
            wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...thumbPoint })
            wc.sendInputEvent({
                type: 'mouseMove',
                x: thumbPoint.x,
                y: thumbPoint.y + 35,
                modifiers: ['leftButtonDown']
            })
            wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: thumbPoint.x, y: thumbPoint.y + 35 })
            await until(
                async () => (await js(`${results}.scrollTop`)) > beforeDrag,
                'Dragging the overlay thumb did not move results'
            )
            await key('End')
            const visibleActive = () =>
                js(`(() => {
                const input=document.querySelector('[role=dialog] input')
                const rect=document.getElementById(input.getAttribute('aria-activedescendant')).getBoundingClientRect()
                const bounds=${results}.getBoundingClientRect()
                return input === document.activeElement && rect.top >= bounds.top-1 && rect.bottom <= bounds.bottom+1
            })()`)
            assert.ok(await visibleActive())
            await key('Home')
            assert.ok(await visibleActive())
            assert.equal(await searchTop(), fixedTop)
            await wc.insertText('zzzzzzzzzz')
            await until(
                () =>
                    js(
                        "document.querySelector('[role=dialog] [role=status]')?.textContent === 'No results' && !!document.querySelector('[role=dialog] strong')"
                    ),
                'No empty result feedback'
            )
            await pause(480)
            await capture('palette-empty')
            await key('Enter')
            const inspectModifier = process.platform === 'darwin' ? 'meta' : 'control'
            await key('Enter', [inspectModifier])
            assert.ok(await js("document.activeElement.matches('[role=dialog] input')"))
            assert.equal(await paragraph(), beforeDrop)
            await key('Escape')
            await until(
                () => js("document.activeElement.matches('.tiptap') && !document.querySelector('[role=dialog]')"),
                'Escape did not return focus'
            )
            assert.equal(await js('getSelection().toString()'), 'for')
            await click('[aria-label="Close inspector"]')
            await click('[aria-label="Focus on writing"]')
            await showPicker()
            await wc.insertText('retry')
            await key('Down')
            const inspectedTitle = await activeLabel()
            assert.ok(inspectedTitle && inspectedTitle !== activity.title)
            const inspectHighlighted = async () => {
                await key('Enter', [inspectModifier])
                await until(
                    () =>
                        js(`document.activeElement.matches('.ws-inspector-title') &&
                            document.activeElement.textContent === ${JSON.stringify(inspectedTitle)} &&
                            !!document.querySelector('.ws-inspector [data-value="details"][aria-selected="true"]') &&
                            document.activeElement.getBoundingClientRect().height > 0 && !document.querySelector('[role=dialog]')`),
                    'Modified Enter did not open and focus Details for the highlighted activity'
                )
                assert.equal(await paragraph(), beforeDrop)
            }
            await inspectHighlighted()
            await capture('picker-details')
            await click('.ws-inspector [data-value="related"]')
            await showPicker()
            await wc.insertText(inspectedTitle)
            assert.equal(await activeLabel(), inspectedTitle)
            await inspectHighlighted()
            await click('[aria-label="Pop out diff"]')
            await until(
                async () =>
                    reference() &&
                    (await reference().webContents.executeJavaScript(
                        "!!document.querySelector('.ws-details-content')"
                    )) &&
                    (await js("!!document.querySelector('.ws-detached-status')")),
                'Activity did not detach'
            )
            win.focus()
            await showPicker()
            await wc.insertText(inspectedTitle)
            await inspectHighlighted()
            await until(() => !reference(), 'Activity did not dock back into the workspace')
            await showPicker()
            await wc.insertText('multilingual')
            await until(
                () => js("document.querySelectorAll('[role=dialog] [role=option]').length === 1"),
                'Search did not narrow activities'
            )
            assert.equal(await activeLabel(), fixture.activities[2].title)
            assert.ok(
                await js(
                    "document.querySelector('[role=option] [title]').scrollWidth > document.querySelector('[role=option] [title]').clientWidth && document.querySelector('[role=dialog]').scrollWidth <= document.querySelector('[role=dialog]').clientWidth"
                )
            )
            const size = win.getContentSize()
            win.setMinimumSize(0, 0)
            for (const width of [390, 768, 1024, 1440]) {
                win.setContentSize(width, size[1])
                await pause(100)
                assert.ok(
                    await js(`(() => {
                    const dialog = document.querySelector('[role=dialog]')
                    const r = dialog.getBoundingClientRect()
                    return r.left >= 0 && r.right <= innerWidth + 1 && dialog.scrollWidth <= dialog.clientWidth
                })()`)
                )
            }
            win.setContentSize(...size)
            await key('A', ['control'])
            await key('Backspace')
            await pause(400)
            const first = await activeLabel()
            await key('Down')
            const second = await activeLabel()
            assert.ok(second && first && second !== first)
            await key('Up')
            assert.equal(await activeLabel(), first)
            await key('Down')
            await wc.insertText('retry')
            await key('Down')
            const chosenLabel = await activeLabel()
            await pause(300)
            await capture('picker')
            await key('Enter')
            await until(
                () => js("document.activeElement.matches('.tiptap') && !document.querySelector('[role=dialog]')"),
                'Selection did not return to writing'
            )
            const chosen = fixture.activities.find((item) => item.title === chosenLabel)
            assert.ok(chosen?.sha)
            const cited = chosen.title + ' (' + chosen.sha.slice(0, 7) + ')'
            assert.equal(await paragraph(), beforeDrop.slice(0, 2) + cited + beforeDrop.slice(5))
            await key('Z', ['control'])
            assert.equal(await paragraph(), beforeDrop)
            // Capture the same real window while native input drives the palette, preserving frame timing.
            const [width, height] = win.getContentSize()
            const crop = {
                x: Math.max(0, Math.floor((width - 700) / 2)),
                y: 0,
                width: Math.min(700, width),
                height: Math.min(620, height)
            }
            const frames = []
            /** @type {number[]} */
            const times = []
            let recording = true
            const record = async () => {
                while (recording) {
                    const image = await wc.capturePage(crop)
                    frames.push(image.resize({ width: 700 }).toPNG())
                    times.push(performance.now())
                    await pause(25)
                }
            }
            const clip = record()
            try {
                await showPicker()
                await pause(420)
                const hover = await js(`(() => {
                    const r = document.querySelectorAll('[role=dialog] [role=option]')[3].getBoundingClientRect()
                    return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)}
                })()`)
                wc.sendInputEvent({ type: 'mouseMove', ...hover })
                await pause(400)
                await wc.insertText('retry')
                await pause(540)
                await wc.insertText(' xyz')
                await pause(550)
                await click('[aria-label="Clear search"]')
                await pause(480)
                await key('Escape')
                await pause(220)
            } finally {
                recording = false
                await clip
            }
            assert.ok(frames.length > 12)
            const delay = times.map((t, i) => Math.max(20, Math.round((times[i + 1] ?? t + 400) - t)))
            await sharp(frames, { join: { animated: true } })
                .gif({ delay, loop: 0, effort: 3 })
                .toFile(join(output, 'palette-motion.gif'))
            await js(`(() => {
                const data = new DataTransfer()
                data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'], 'fixture.svg', {type:'image/svg+xml'}))
                document.querySelector('.tiptap').dispatchEvent(new DragEvent('drop', {dataTransfer:data, clientX:${dropPoint.x}, clientY:${dropPoint.y}, bubbles:true,cancelable:true}))
            })()`)
            await until(
                () => js("document.querySelector('.journal-image-preview img')?.naturalWidth === 10"),
                'Image drop did not reach the image importer'
            )
            await js(`window.journal.invoke({type:'popout',kind:'entry',id:${JSON.stringify(fixture.entries[0].id)}})`)
            const reader = () =>
                BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('reference=entry'))
            await until(
                async () =>
                    reader() && (await reader().webContents.executeJavaScript("!!document.querySelector('.tiptap a')")),
                'Saved entry did not open'
            )
            await reader().webContents.executeJavaScript("document.querySelector('.tiptap a').click()")
            await until(
                () => reference() && new URL(reference().webContents.getURL()).searchParams.get('id') === activity.id,
                'Saved local citation did not open its activity'
            )
            reference().close()
            reader().close()
            wc.debugger.attach('1.3')
            await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
            })
            await until(
                () =>
                    js(
                        "document.querySelector('.ws-writing-footer [role=status]')?.textContent.includes('Saved on this device')"
                    ),
                'Fixture edits did not finish saving before reload'
            )
            await win.loadURL(wc.getURL())
            await until(() => js("document.querySelector('.tiptap')?.isContentEditable"), 'Saved draft did not reopen')
            await js("document.querySelector('.tiptap').focus()")
            await showPicker()
            assert.ok(
                await js(`(() => {
                const dialog = document.querySelector('[role=dialog]')
                const palette = dialog.lastElementChild
                const style = getComputedStyle(palette)
                return matchMedia('(prefers-reduced-motion: reduce)').matches && style.opacity === '1' &&
                    (style.transform === 'none' || new DOMMatrix(style.transform).isIdentity)
            })()`)
            )
            await key('Escape')
            await until(
                () => js("document.activeElement.matches('.tiptap')"),
                'Reduced-motion dismissal did not restore focus'
            )
            wc.debugger.detach()
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: true, title, opened }))
            win.close()
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG())
            for (const popup of BrowserWindow.getAllWindows()) if (popup !== win) popup.close()
            win.close()
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
