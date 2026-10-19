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
        window.webContents.debugger.attach('1.3')
        await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
        await pause(300)
        await evaluate(`document.querySelector('[aria-label^="Week:"]').click()`)
        await pause(700)
        const blankAreas = await evaluate(`(()=>{
            const panel=document.querySelector('[role="dialog"]');
            const rect=panel.getBoundingClientRect();
            return [{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+4)},
                {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.bottom-4)}];
        })()`)
        for (const blank of blankAreas) {
            await evaluate(`document.querySelector('[data-current] [data-date]').focus()`)
            window.webContents.sendInputEvent({ type: 'mouseDown', ...blank, button: 'left', clickCount: 1 })
            window.webContents.sendInputEvent({ type: 'mouseUp', ...blank, button: 'left', clickCount: 1 })
            await pause(100)
            const inside = await evaluate(`(()=>{
                const panel=document.querySelector('[role="dialog"]');
                return document.querySelector('[aria-label^="Week:"]').getAttribute('aria-expanded')==='true'
                    && panel.contains(document.activeElement);
            })()`)
            if (!inside) throw new Error('Blank picker content dismissed the picker or moved focus outside')
        }
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
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        await pause(400)
        const trigger = await evaluate(`(()=>{
            const node=document.querySelector('[aria-label^="Week:"]');
            const rect=node.getBoundingClientRect();
            if(node.getAttribute('aria-expanded')!=='false') throw new Error('Escape did not close the picker');
            return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
        })()`)
        window.webContents.sendInputEvent({ type: 'mouseDown', ...trigger, button: 'left', clickCount: 1 })
        window.webContents.sendInputEvent({ type: 'mouseUp', ...trigger, button: 'left', clickCount: 1 })
        await pause(650)
        if (!(await evaluate(`document.querySelector('[aria-label^="Week:"]').getAttribute('aria-expanded')==='true'`)))
            throw new Error('Mouse reopen failed after selecting a week and canceling with Escape')
        await evaluate(
            `(()=>{const button=document.querySelector('[aria-label="Next month"]');button.focus();button.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));})()`
        )
        await pause(50)
        const months = await evaluate(
            `({current:document.querySelectorAll('[data-current]').length,departing:document.querySelectorAll('[inert][aria-hidden="true"]').length})`
        )
        if (months.current !== 1 || months.departing < 1) throw new Error('Month transition is missing')
        await pause(350)
        await evaluate(`document.querySelector('[aria-label="Open settings"]').focus()`)
        const dismissedOnOutsideFocus = await evaluate(
            `document.querySelector('[aria-label^="Week:"]').getAttribute('aria-expanded')==='false'`
        )
        if (!dismissedOnOutsideFocus) throw new Error('Moving focus outside did not dismiss the picker')
        console.info(
            JSON.stringify({
                before,
                during,
                after,
                months,
                insideClicks: true,
                outsideFocus: true,
                escapeReopen: true,
                passed: true
            })
        )
        app.exit(0)
    } catch (error) {
        console.error(error)
        app.exit(1)
    }
})
