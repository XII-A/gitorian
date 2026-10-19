import { app, screen } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Exercise the real main/preload bridge against disposable journal data.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'weekly-j-window-chrome-')))
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
        const evaluate = (source) => window.webContents.executeJavaScript(source)
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
                    if (visible ? y === 0 : y <= -43) return
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
            assert.ok((await barY()) <= -43, 'Title bar is not hidden at rest')
            for (const x of [20, 300, window.getContentBounds().width - 24]) {
                await move(x, 8, false)
                await pause(250)
                await expectBar(true, `Native top-edge hover failed at x=${x}`)
                await move(x, 30, false)
                await pause(450)
                assert.equal(await barY(), 0, 'Title bar disappeared over a native drag region')
                await move(300, 200)
                await pause(650)
                assert.ok((await barY()) <= -43)
            }
            await move(300, 8, false)
            await pause(250)
            await move(300, 200)
            await pause(100)
            assert.equal(await barY(), 0, 'Title bar disappeared without a leave grace period')
            await move(300, 30, false)
            await pause(450)
            assert.equal(await barY(), 0, 'Returning during the grace period did not cancel hiding')
            await move(300, 200)
            await pause(650)
            assert.ok((await barY()) <= -43, 'Title bar did not hide after leaving')
            await move(300, 8, false)
            await pause(250)
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
            assert.ok((await barY()) <= -43, 'Pointer click pinned the title bar through focus')
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
            assert.ok((await barY()) <= -43, 'Title bar stayed pinned after keyboard focus left')
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
                await evaluate(
                    `parseFloat(getComputedStyle(document.querySelector('.window-title-bar')).transitionDuration) < 0.001`
                )
            )
            await evaluate(`window.journal.invoke({ type: 'popout', kind: 'activity', id: 'smoke' })`)
            const { BrowserWindow } = await import('electron')
            const popout = BrowserWindow.getAllWindows().find((item) => item !== window)
            assert.ok(popout, 'Reference window did not open')
            for (let attempt = 0; attempt < 50 && popout.webContents.isLoading(); attempt++) await pause(100)
            assert.equal(popout.isMenuBarVisible(), false, 'Pop-out menu is visible')
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
                    await move(window.getContentBounds().width - 24, 8, false)
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
            app.exit(0)
        } catch (error) {
            console.error(error)
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
