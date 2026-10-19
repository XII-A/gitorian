import { app, screen } from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Exercise the real main/preload bridge against disposable journal data.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'weekly-j-window-chrome-')))
delete process.env.ELECTRON_RENDERER_URL
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
setTimeout(() => {
    console.error('Window chrome smoke timed out')
    app.exit(1)
}, 30000).unref()
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
            await move(300, 200)
            await pause(250)
            assert.ok((await barY()) <= -43, 'Title bar is not hidden at rest')
            for (const x of [20, 300, window.getContentBounds().width - 24]) {
                await move(x, 8, false)
                await pause(250)
                assert.equal(await barY(), 0, `Native top-edge hover failed at x=${x}`)
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
            await evaluate(`document.activeElement.blur()`)
            await pause(250)
            assert.ok((await barY()) <= -43, 'Title bar stayed pinned after keyboard focus left')
            assert.equal(
                await evaluate(`getComputedStyle(document.querySelector('.window-title-bar-drag')).webkitAppRegion`),
                'drag'
            )
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
