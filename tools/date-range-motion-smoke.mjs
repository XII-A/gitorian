import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'

setTimeout(() => app.exit(2), 30000).unref()
app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 1000,
        webPreferences: {
            offscreen: true,
            backgroundThrottling: false,
            preload: resolve('tools/history-smoke-preload.cjs')
        }
    })
    window.webContents.on('paint', () => {
        // Keep offscreen rendering active while sampling the transition.
    })
    const pause = (ms) => new Promise((done) => setTimeout(done, ms))
    const evaluate = (source) => window.webContents.executeJavaScript(source)
    try {
        await window.loadFile(resolve('out/renderer/index.html'))
        await pause(300)
        await evaluate(`document.querySelector('[aria-label^="Week:"]').click()`)
        await pause(700)
        const read = () =>
            evaluate(`(()=>{
            const current=document.querySelector('[data-current]');
            return [...current.querySelectorAll('[class*="thumb_"]')]
                .filter(node=>Number(getComputedStyle(node).opacity)>.5)
                .map(node=>({x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y}));
        })()`)
        const before = await read()
        await evaluate(`(()=>{
            const button=[...document.querySelectorAll('[aria-label="Presets"] button')].find(node=>node.textContent==='Last week');
            button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));
            button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
        })()`)
        await pause(50)
        const during = await read()
        await pause(550)
        const after = await read()
        if (!before.length || !during.length || !after.length) throw new Error('Missing visible range endpoints')
        if (Math.abs(during[0].y - before[0].y) < 0.5 || Math.abs(during[0].y - after[0].y) < 0.5)
            throw new Error(`Week highlight did not animate: ${JSON.stringify({ before, during, after })}`)
        await evaluate(
            `document.querySelector('[aria-label="Next month"]').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}))`
        )
        await pause(50)
        const months = await evaluate(
            `({current:document.querySelectorAll('[data-current]').length,departing:document.querySelectorAll('[inert][aria-hidden="true"]').length})`
        )
        if (months.current !== 1 || months.departing < 1) throw new Error('Month transition is missing')
        console.info(JSON.stringify({ before, during, after, months, passed: true }))
        app.exit(0)
    } catch (error) {
        console.error(error)
        app.exit(1)
    }
})
