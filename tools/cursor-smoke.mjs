import { app, BrowserWindow, screen, dialog } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
if (process.platform !== 'win32') {
    console.info('Native cursor smoke requires Windows.')
    app.exit(0)
}
const baseline = process.argv.includes('--baseline')
const directory = mkdtempSync(resolve('.ai-docs/cursor-smoke-'))
app.setPath('userData', directory)
const existingFeatures = app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean)
app.on('browser-window-created', (_, created) => {
    if (created.getTitle() !== 'Cursor diagnostic') created.show = () => created.hide()
})
const native = (command = 'sample') => {
    const [action, handle = '0', owner = '0'] = command.split(' ')
    const value = JSON.parse(
        execFileSync(
            'powershell',
            [
                '-NoProfile',
                '-File',
                resolve('tools/cursor-native.ps1'),
                '-Action',
                action,
                '-Handle',
                handle,
                '-Owner',
                owner
            ],
            { windowsHide: true, encoding: 'utf8', timeout: 5000 }
        )
            .trim()
            .replace(/^\uFEFF/, '')
    )
    if (value.error) throw new Error(value.error)
    return value
}
setTimeout(() => {
    console.error('Native probe timed out')
    app.exit(2)
}, 30000).unref()
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const results = []
let window
app.whenReady().then(async () => {
    try {
        const initial = native()
        const disabledFeatures = app.commandLine.getSwitchValue('disable-features').split(',')
        if (
            !baseline &&
            (!disabledFeatures.includes('HideCursorWhileTyping') ||
                existingFeatures.some((feature) => !disabledFeatures.includes(feature)))
        )
            throw new Error('Startup cursor policy is absent or discarded existing disabled features.')
        console.info(
            JSON.stringify({
                electron: process.versions.electron,
                chromium: process.versions.chrome,
                baseline,
                hidePointerWhileTyping: initial.vanish
            })
        )
        const point = screen.getCursorScreenPoint()
        const area = screen.getDisplayNearestPoint(point).workArea
        const width = Math.min(900, area.width),
            height = Math.min(600, area.height)
        window = new BrowserWindow({
            title: 'Cursor diagnostic',
            x: Math.max(area.x, Math.min(point.x - 400, area.x + area.width - width)),
            y: Math.max(area.y, Math.min(point.y - 200, area.y + area.height - height)),
            width,
            height,
            frame: false,
            show: false,
            webPreferences: { backgroundThrottling: false }
        })
        const handle = window.getNativeWindowHandle().readBigUInt64LE().toString()
        const sample = (label) => {
            const value = native('sample ' + handle)
            results.push({ label, ...value })
            console.info(JSON.stringify({ label, ...value }))
            return value
        }
        const cursorEvents = []
        window.webContents.on('cursor-changed', (_, type) => cursorEvents.push(type))
        await window.loadURL(
            'data:text/html,' +
                encodeURIComponent(
                    '<html><body style="margin:0;background:#202020;color:white;font:18px sans-serif"><div id="writing" contenteditable="true" style="box-sizing:border-box;padding:24px;min-height:2500px;outline:0">Isolated cursor diagnostic. This window closes automatically.<br>Native input follows here: </div></body></html>'
                )
        )
        window.show()
        window.focus()
        await pause(350)
        await window.webContents.executeJavaScript(
            "document.getElementById('writing').focus();const s=getSelection();s.selectAllChildren(document.getElementById('writing'));s.collapseToEnd()"
        )
        native('move ' + handle)
        await pause(150)
        sample('before typing')
        native('type ' + handle)
        await pause(250)
        const typed = await window.webContents.executeJavaScript("document.getElementById('writing').textContent")
        if (!typed.endsWith('a')) throw new Error('Native keyboard input did not reach the probe.')
        sample('after native typing')
        native('wheel ' + handle)
        await pause(150)
        sample('after wheel before picker')
        native('type ' + handle)
        await pause(150)
        sample('after second native typing')
        await window.webContents.executeJavaScript("document.getElementById('writing').blur()")
        sample('after editor blur')
        const choosing = dialog.showOpenDialog(window, {
            title: 'Isolated cursor diagnostic — closes automatically',
            properties: ['openFile']
        })
        await pause(400)
        const open = sample('native chooser open')
        native('close ' + String(open.foreground) + ' ' + handle)
        await choosing
        await pause(200)
        sample('after chooser closes')
        native('wheel ' + handle)
        await pause(250)
        sample('after native wheel')
        console.info(JSON.stringify({ cursorEvents, directory }))
        writeFileSync(
            join(directory, 'results.json'),
            JSON.stringify(
                {
                    baseline,
                    electron: process.versions.electron,
                    chromium: process.versions.chrome,
                    results,
                    cursorEvents
                },
                null,
                2
            )
        )
        const visible = results.every((result) => (result.flags & 1) !== 0)
        console.info(JSON.stringify({ pointerStayedVisible: visible }))
        window.destroy()
        app.exit(visible ? 0 : 1)
    } catch (error) {
        console.error(error)
        window?.destroy()
        app.exit(1)
    }
})

// Load the real startup policy and an isolated empty journal; baseline omits the app.
if (!baseline) await import(pathToFileURL(resolve('out/main/index.js')).href)
