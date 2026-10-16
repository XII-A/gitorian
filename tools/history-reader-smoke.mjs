import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (value, message) => {
    if (!value) throw new Error(message)
}
setTimeout(() => {
    console.error('History reader smoke timed out')
    app.exit(1)
}, 30000).unref()
app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 1000,
        useContentSize: true,
        webPreferences: {
            offscreen: true,
            backgroundThrottling: false,
            preload: resolve('tools/history-smoke-preload.cjs')
        }
    })
    window.webContents.on('paint', () => {
        /* Keep offscreen frames flowing for real wheel input. */
    })
    window.webContents.setFrameRate(60)
    const evaluate = (expression) => window.webContents.executeJavaScript(expression)
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const read = () =>
        evaluate(`(() => {
        const body=document.querySelector('.history-article .tiptap'), viewport=document.querySelector('.history-document [role=region]');
        return { title:document.querySelector('.history-article h2').textContent, body:body.textContent,
            scrollTop:viewport.scrollTop, height:viewport.clientHeight, content:viewport.scrollHeight, rect:viewport.getBoundingClientRect().toJSON() };
    })()`)
    try {
        await window.loadFile(resolve('out/renderer/index.html'))
        for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector('.history-trigger')`)); i++)
            await pause(25)
        await click('.history-trigger')
        await pause(350)
        await click('.history-row')
        await pause(350)
        const first = await read()
        assert(first.body.length > 6000 && first.content > first.height * 2, 'Long sample fixture is missing')
        window.webContents.debugger.attach('1.3')
        const wheel = async (amount) => {
            const { rect } = await read()
            const point = { x: Number(rect.x) + Number(rect.width) / 2, y: Number(rect.y) + Number(rect.height) / 2 }
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
            await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                ...point,
                deltaX: 0,
                deltaY: amount
            })
            await pause(250)
        }
        await wheel(600)
        assert((await read()).scrollTop > 0, 'Modal scroll lock blocked a real wheel over the reader')
        const dialog = await evaluate(`window.__readerSmokeNode=document.querySelector('.history-entry-dialog'); true`)
        assert(dialog, 'Reader missing')
        for (let i = 0; i < 3; i++) {
            await click('.history-month li:nth-child(2) .history-row')
            await pause(80)
            const short = await read()
            assert(short.body !== first.body && short.body.length < 1000, 'Short entry body did not update')
            await click('.history-row')
            await pause(80)
            const back = await read()
            assert(
                back.title === first.title && back.body === first.body,
                'Returning to the long entry changed only the title'
            )
            assert(back.scrollTop === 0, 'Selected entry did not reset reader scroll')
            assert(
                await evaluate(`document.querySelector('.history-entry-dialog')===window.__readerSmokeNode`),
                'Entry switching remounted the dialog'
            )
        }
        await wheel(600)
        assert((await read()).scrollTop > 0, 'Restored long entry no longer scrolls')
        await click('.entry-history [aria-label="Close drawer"]')
        await pause(350)
        assert(
            await evaluate(
                `!document.querySelector('.history-entry-dialog') && getComputedStyle(document.body).pointerEvents!=='none'`
            ),
            'Closing the pair leaked the reader or body lock'
        )
        console.info(
            JSON.stringify({
                realWheelScroll: true,
                longShortLongBodyRestored: true,
                repeatedSelections: 3,
                dialogRetained: true,
                cleanup: true,
                passed: true
            })
        )
        app.exit(0)
    } catch (error) {
        console.error(error)
        app.exit(1)
    }
})
