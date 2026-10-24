import { app, screen } from 'electron'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Exercise the real main/preload bridge against disposable journal data.
app.setPath(
    'userData',
    process.env.GITORIAN_VERIFY_STATE
        ? join(process.env.GITORIAN_VERIFY_STATE, 'profile')
        : mkdtempSync(join(tmpdir(), 'gitorian-window-chrome-'))
)
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (output) mkdirSync(output, { recursive: true })
const record = (action) => {
    if (output)
        appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ at: new Date().toISOString(), action }) + '\n')
}
// Smoke windows stay behind the user's apps; keep their compositor ticking.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
delete process.env.ELECTRON_RENDERER_URL
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
setTimeout(() => {
    console.error('Window chrome smoke timed out')
    app.exit(1)
}, 60000).unref()
let checking = false
let cursor = { x: -100000, y: -100000 }
app.on('browser-window-created', (_, window) => {
    // Control the OS cursor sample without moving the user's real pointer.
    screen.getCursorScreenPoint = () => cursor
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (checking) return
        checking = true
        const evaluate = (source) => {
            record(source)
            return window.webContents.executeJavaScript(source)
        }
        /** @param {string} name */
        const shot = async (name) => {
            if (output) writeFileSync(join(output, name + '.png'), (await window.webContents.capturePage()).toPNG())
        }
        try {
            for (let attempt = 0; attempt < 50; attempt++) {
                if (await evaluate(`!!document.querySelector('.window-title-bar')`)) break
                await pause(100)
            }
            assert.equal(window.isMenuBarVisible(), false, 'Native menu is still visible')
            window.webContents.debugger.attach('1.3')
            /** @param {number} x @param {number} y */
            const move = async (x, y, rendererEvent = true) => {
                const bounds = window.getContentBounds()
                cursor = { x: bounds.x + x, y: bounds.y + y }
                if (rendererEvent)
                    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x,
                        y
                    })
            }
            const barY = () => evaluate(`document.querySelector('.window-title-bar').getBoundingClientRect().y`)
            const hidden = () =>
                evaluate(`getComputedStyle(document.querySelector('.window-title-bar')).opacity === '0'`)
            /** @param {number} x @param {number} y */
            const nativeHit = async (x, y) => {
                const bounds = window.getContentBounds()
                const point = screen.dipToScreenPoint({ x: Math.round(bounds.x + x), y: Math.round(bounds.y + y) })
                const { stdout } = await run(
                    'powershell.exe',
                    [
                        '-NoProfile',
                        '-File',
                        resolve('tools/windows-hit-test.ps1'),
                        String(window.getNativeWindowHandle().readBigUInt64LE()),
                        String(point.x),
                        String(point.y)
                    ],
                    { windowsHide: true }
                )
                return Number(stdout.trim())
            }
            const expectBar = async (visible, message) => {
                for (let attempt = 0; attempt < 20; attempt++) {
                    const y = await barY()
                    if (visible ? y === 0 : await hidden()) return
                    await pause(50)
                }
                assert.fail(
                    `${message}: ${JSON.stringify(
                        await evaluate(`({
                    y: document.querySelector('.window-title-bar').getBoundingClientRect().y,
                    revealed: document.querySelector('.window-chrome').dataset.revealed,
                    width: innerWidth,
                    hidden: document.hidden,
                    transform: getComputedStyle(document.querySelector('.window-title-bar')).transform,
                    animations: document.querySelector('.window-title-bar').getAnimations().map(a => ({time:a.currentTime,state:a.playState}))
                })`)
                    )}; cursor=${JSON.stringify(cursor)}; bounds=${JSON.stringify(window.getContentBounds())}`
                )
            }
            await move(300, 200)
            await pause(250)
            assert.ok(await hidden(), 'Title bar is not hidden at rest')
            assert.deepEqual(
                await evaluate(
                    `(() => { const r = document.getElementById('root').getBoundingClientRect(); return [r.x, r.y, innerWidth-r.right, innerHeight-r.bottom] })()`
                ),
                [6, 6, 6, 6],
                'Frame must stay thin on every edge'
            )
            await shot('01-frame-hidden')
            // Native cursor samples are DIPs; caption bounds are CSS pixels.
            // Stay over the last visible button row longer than the hide grace.
            for (const zoom of [1.25, 0.8]) {
                window.webContents.setZoomFactor(zoom)
                await move(300, 200, false)
                await pause(650)
                await move(300, 3, false)
                await pause(250)
                await expectBar(true, `Top edge did not reveal controls at ${zoom}x`)
                const button = await evaluate(`(() => {
                    const r = document.querySelector('[aria-label="Maximize window"]').getBoundingClientRect()
                    return { x: r.x + r.width / 2, y: r.bottom - 1 }
                })()`)
                await move(button.x * zoom, button.y * zoom, false)
                await pause(650)
                await expectBar(true, `Visible bottom caption row lost hover at ${zoom}x`)
                await move(300, 200, false)
                await pause(650)
                await expectBar(false, `Caption did not hide after leaving at ${zoom}x`)
                await move(300, 6 * zoom - 0.5, false)
                await pause(250)
                await expectBar(true, `Scaled top frame did not reveal controls at ${zoom}x`)
                record(`Caption lower edge and hidden frame reveal passed at ${zoom}x`)
            }
            await move(300, 200, false)
            await pause(650)
            window.webContents.setZoomFactor(1)

            if (process.env.GITORIAN_CHROME_TRACE) {
                await window.webContents.debugger.sendCommand('Tracing.start', {
                    categories: 'devtools.timeline,blink.animations,cc',
                    transferMode: 'ReturnAsStream'
                })
            }
            for (const x of [20, 300, window.getContentBounds().width - 24]) {
                await move(x, 5, false)
                await pause(250)
                await expectBar(true, `Native top-edge hover failed at x=${x}`)
                await move(x, 30, false)
                await pause(450)
                assert.equal(await barY(), 0, 'Title bar disappeared over a native drag region')
                await move(300, 200)
                await pause(650)
                assert.ok(await hidden())
            }
            if (process.env.GITORIAN_CHROME_TRACE) {
                const completed = new Promise((done) => {
                    const receive = (_event, method, params) => {
                        if (method === 'Tracing.tracingComplete') {
                            window.webContents.debugger.removeListener('message', receive)
                            done(params.stream)
                        }
                    }
                    window.webContents.debugger.on('message', receive)
                })
                await window.webContents.debugger.sendCommand('Tracing.end')
                const handle = String(await completed)
                let trace = ''
                for (;;) {
                    const chunk = await window.webContents.debugger.sendCommand('IO.read', { handle })
                    trace += String(chunk.data)
                    if (chunk.eof) break
                }
                await window.webContents.debugger.sendCommand('IO.close', { handle })
                if (output) writeFileSync(join(output, 'reveal-trace.json'), trace)
            }
            await move(300, 5, false)
            await pause(250)
            await move(300, 200)
            await pause(100)
            assert.equal(await barY(), 0, 'Title bar disappeared without a leave grace period')
            await move(300, 30, false)
            await pause(450)
            assert.equal(await barY(), 0, 'Returning during the grace period did not cancel hiding')
            await move(300, 200)
            await pause(650)
            assert.ok(await hidden(), 'Title bar did not hide after leaving')
            await move(300, 5, false)
            await pause(250)
            assert.ok(
                await evaluate(`(() => {
                const surface = document.querySelector('.hub-scroll')
                const r = surface.getBoundingClientRect()
                const top = r.y + 32
                const cap = document.querySelector('.window-frame-cap')
                const edge = cap.getBoundingClientRect()
                return edge.bottom === top && edge.left === r.left && edge.right === r.right &&
                    getComputedStyle(cap, '::before').height === '12px' &&
                    getComputedStyle(cap, '::after').height === '12px' &&
                    surface.contains(document.elementFromPoint(r.x + 24, top + 8)) &&
                    surface.contains(document.elementFromPoint(r.right - 24, top + 8))
            })()`),
                'Expanded frame mask must join both rounded content corners below the controls'
            )
            assert.ok(
                await evaluate(`(() => {
                const button = document.querySelector('[aria-label="Minimize window"]')
                const r = button.getBoundingClientRect()
                const content = document.querySelector('.hub-scroll').getBoundingClientRect()
                return r.y === 0 && r.bottom === content.y + 32 &&
                    document.elementFromPoint(r.x + r.width / 2, r.bottom - 1)?.closest('button') === button
            })()`),
                'Caption hover target must fill the frame down to the rounded content edge'
            )
            await move(window.getContentBounds().width - 120, 36)
            await pause(100)
            await shot('02-full-height-hover')
            await shot('02-controls-revealed')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-color-scheme', value: 'light' }]
            })
            await pause(200)
            await shot('02-controls-revealed-light')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-color-scheme', value: 'dark' }]
            })
            const clickX = window.getContentBounds().width - 72
            await move(clickX, 22)
            for (const type of ['mousePressed', 'mouseReleased'])
                await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
                    type,
                    x: clickX,
                    y: 22,
                    button: 'left',
                    clickCount: 1
                })
            await pause(250)
            assert.ok(window.isMaximized(), 'Pointer maximize failed')
            await move(300, 200)
            await pause(650)
            assert.ok(await hidden(), 'Pointer click pinned the title bar through focus')
            assert.ok(
                await evaluate(`!document.elementFromPoint(300, 22).closest('.window-chrome')`),
                'Hidden title bar still intercepts app controls'
            )
            assert.ok(
                await evaluate(`document.activeElement.closest('.window-title-bar') !== null`),
                'Click test did not retain button focus'
            )
            window.unmaximize()
            await pause(250)
            await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
                type: 'keyDown',
                key: 'Tab',
                code: 'Tab',
                windowsVirtualKeyCode: 9
            })
            await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: 'Tab',
                code: 'Tab',
                windowsVirtualKeyCode: 9
            })
            await evaluate(`document.querySelector('[aria-label="Minimize window"]').focus()`)
            await pause(250)
            assert.equal(await barY(), 0, 'Keyboard focus did not reveal the controls')
            assert.equal(await nativeHit(300, 30), 2, 'Visible title bar lost its native drag region')
            await evaluate(`document.activeElement.blur()`)
            await pause(250)
            assert.ok(await hidden(), 'Title bar stayed pinned after keyboard focus left')
            assert.equal(
                await evaluate(`getComputedStyle(document.querySelector('.window-title-bar-drag')).webkitAppRegion`),
                'no-drag'
            )
            assert.equal(await nativeHit(300, 22), 1, 'Hidden title bar retained its native drag region')
            await evaluate(`document.querySelector('[aria-label="Maximize window"]').click()`)
            await pause(300)
            assert.ok(window.isMaximized(), 'Maximize IPC failed')
            assert.ok(
                await evaluate(`!!document.querySelector('[aria-label="Restore window"]')`),
                'Maximize state did not reach the renderer'
            )
            await evaluate(`document.querySelector('[aria-label="Restore window"]').click()`)
            await pause(300)
            assert.equal(window.isMaximized(), false, 'Restore IPC failed')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
            })
            assert.ok(
                await evaluate(`getComputedStyle(document.querySelector('.window-title-bar')).transform === 'none'`)
            )
            await move(300, 5, false)
            await pause(250)
            await expectBar(true, 'Reduced motion reveal failed')
            await shot('03-reduced-motion')
            await move(300, 200)
            await pause(650)
            await expectBar(false, 'Reduced motion hide failed')
            await evaluate(`window.journal.invoke({ type: 'popout', kind: 'activity', id: 'sample:2026-10-12:0' })`)
            const { BrowserWindow } = await import('electron')
            const popout = BrowserWindow.getAllWindows().find((item) => item !== window)
            assert.ok(popout, 'Reference window did not open')
            for (let attempt = 0; attempt < 50 && popout.webContents.isLoading(); attempt++) await pause(100)
            assert.equal(popout.isMenuBarVisible(), false, 'Pop-out menu is visible')
            for (let attempt = 0; attempt < 50; attempt++) {
                if (
                    await popout.webContents.executeJavaScript(
                        `!!document.querySelector('.ws-reference .ws-inspector-header')`
                    )
                )
                    break
                await pause(100)
            }
            popout.webContents.debugger.attach('1.3')
            for (const theme of ['dark', 'light']) {
                record(`Inspect detached outer frame contrast in ${theme} theme`)
                await popout.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                    features: [{ name: 'prefers-color-scheme', value: theme }]
                })
                await pause(200)
                assert.ok(
                    await popout.webContents.executeJavaScript(`(() => {
                    const header = document.querySelector('.ws-reference .ws-inspector-header')
                    const frame = document.querySelector('.window-frame-cap')
                    const root = document.getElementById('root')
                    const color = getComputedStyle(frame).backgroundColor
                    return header && frame && getComputedStyle(header).backgroundColor !== color &&
                        getComputedStyle(document.body).backgroundColor === color &&
                        getComputedStyle(root).backgroundColor === color
                })()`),
                    `Detached outer frame must contrast with the unchanged header in ${theme} theme`
                )
                if (output)
                    writeFileSync(
                        join(output, `04-reference-frame-${theme}.png`),
                        (await popout.webContents.capturePage()).toPNG()
                    )
            }
            await popout.webContents.executeJavaScript(`window.journal.windowControls.action('close')`)
            await pause(100)
            assert.ok(popout.isDestroyed(), 'Close affected the wrong window')
            assert.equal(window.isDestroyed(), false)
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
            })
            // Exercise the real workspace bounds/IPC path at both header layouts
            // and at non-default page zoom. Top-edge approach over the breadcrumb
            // must stay clear, while the rest of the title bar remains usable.
            window.setMinimumSize(600, 640)
            for (const width of [1560, 1000]) {
                window.setContentSize(width, 800)
                for (const zoom of [1, 1.25]) {
                    window.webContents.setZoomFactor(zoom)
                    await window.loadFile(resolve('out/renderer/index.html'), {
                        search: '?workspace&data=sample&week=2026-10-12'
                    })
                    for (let attempt = 0; attempt < 50; attempt++) {
                        if (await evaluate(`!!document.querySelector('[aria-label="Journal breadcrumb"] button')`))
                            break
                        await pause(100)
                    }
                    await pause(250)
                    const crumb = await evaluate(`(() => {
                        const r = document.querySelector('[aria-label="Journal breadcrumb"] button').getBoundingClientRect()
                        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
                    })()`)
                    await move(300, 200, false)
                    await pause(650)
                    await move(crumb.x * zoom, 5, false)
                    await pause(250)
                    await expectBar(false, `Breadcrumb top-edge revealed chrome at ${width}px / ${zoom}x`)
                    await move(window.getContentBounds().width - 24, 5, false)
                    await pause(250)
                    await expectBar(true, 'Breadcrumb exclusion disabled unrelated window controls')
                    // Resize with the bar open, then return to navigation. The
                    // DOM can report Hub while Windows still reports HTCAPTION.
                    window.setContentSize(width + 20, 800)
                    await pause(100)
                    window.setContentSize(width, 800)
                    await pause(100)
                    await move(crumb.x * zoom, crumb.y * zoom, false)
                    await pause(250)
                    await expectBar(false, 'Returning to breadcrumb kept window chrome open')
                    assert.equal(
                        await nativeHit(crumb.x * zoom, crumb.y * zoom),
                        1,
                        `Hidden title bar left a native drag region over Hub at ${width}px / ${zoom}x`
                    )
                    assert.ok(
                        await evaluate(
                            `!!document.elementFromPoint(${crumb.x}, ${crumb.y})?.closest('[aria-label="Journal breadcrumb"]')`
                        ),
                        'Window chrome intercepts breadcrumb'
                    )
                    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
                        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
                            type,
                            x: crumb.x,
                            y: crumb.y,
                            button: type === 'mouseMoved' ? 'none' : 'left',
                            clickCount: 1
                        })
                    await pause(250)
                    assert.ok(
                        await evaluate(`!document.querySelector('[aria-label="Journal breadcrumb"]')`),
                        `Hub breadcrumb click failed at ${width}px / ${zoom}x`
                    )
                    await move(300, 200, false)
                    await pause(650)
                    await move(crumb.x * zoom, 5, false)
                    await pause(250)
                    await expectBar(true, 'Leaving workspace retained a stale breadcrumb exclusion')
                    console.info(`Breadcrumb hover/click passed at ${width}px / ${zoom}x`)
                }
            }
            await evaluate(`window.journal.windowControls.action('minimize')`)
            assert.ok(window.isMinimized(), 'Minimize IPC failed')
            console.info(
                'Window chrome smoke passed: hover, keyboard, drag region, maximize/restore, minimize, pop-out close, reduced motion, no menu'
            )
            if (output) writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: true }))
            app.exit(0)
        } catch (error) {
            console.error(error)
            await shot('failure')
            if (output)
                writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: false, error: String(error) }))
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
