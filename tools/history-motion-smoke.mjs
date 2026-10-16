import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'

// Build this checkout first. Never consumes a possibly unrelated localhost renderer.
setTimeout(() => {
    console.error('History motion smoke timed out')
    app.exit(1)
}, 45000).unref()
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1440,
        height: 1000,
        useContentSize: true,
        webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    window.webContents.on('paint', () => {
        /* Keep offscreen rendering active. */
    })
    window.webContents.setFrameRate(60)
    const evaluate = (source) => window.webContents.executeJavaScript(source)
    const assert = (value, message) => {
        if (!value) throw new Error(message)
    }
    const check = async (quiet = false) =>
        evaluate(
            `(${async function (quiet) {
                const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
                const get = (selector) => document.querySelector(selector)
                const assert = (value, message) => {
                    if (!value) throw new Error(message)
                }
                const click = (selector) => {
                    const element = get(selector)
                    assert(element, `Missing ${selector}`)
                    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
                    element.click()
                }
                const snapshot = () => {
                    const sheet = get('.entry-history'),
                        reader = get('.history-entry-dialog')
                    const rect = (element) =>
                        element
                            ? {
                                  x: element.getBoundingClientRect().x,
                                  width: element.getBoundingClientRect().width,
                                  height: element.getBoundingClientRect().height,
                                  opacity: Number(getComputedStyle(element).opacity)
                              }
                            : null
                    return { sheet: rect(sheet), reader: rect(reader), title: get('.history-article h2')?.textContent }
                }
                const record = async (action) => {
                    const frames = [],
                        start = performance.now()
                    action()
                    do {
                        frames.push({ time: performance.now() - start, ...snapshot() })
                        await new Promise(requestAnimationFrame)
                    } while (performance.now() - start < 450)
                    frames.push({ time: performance.now() - start, ...snapshot() })
                    return frames
                }
                const settled = (frames, name) => {
                    // Measure travel from its first observed movement, excluding portal/editor mount latency.
                    const initial = frames.find((frame) => frame[name])
                    const began =
                        frames.find((frame) => frame[name] && Math.abs(frame[name].x - initial[name].x) > 1)?.time ??
                        initial.time
                    const tail = frames.filter((frame) => frame.time >= Number(began) + 300 && frame[name])
                    assert(tail.length > 1, `No settled frames: ${name}`)
                    assert(
                        Math.max(...tail.map((frame) => frame[name].x)) -
                            Math.min(...tail.map((frame) => frame[name].x)) <
                            1,
                        `Movement after 300ms: ${name} ${JSON.stringify(tail)}`
                    )
                }
                const first = await record(() => click('.history-trigger'))
                settled(first, 'sheet')
                if (!quiet)
                    assert(
                        first.some((frame) => frame.sheet && frame.sheet.x > Number(first.at(-1).sheet.x) + 5),
                        'Index entrance has no travel'
                    )
                const opening = await record(() => click('.history-row'))
                settled(opening, 'sheet')
                settled(opening, 'reader')
                const final = opening.at(-1)
                assert(Math.abs(final.reader.height - final.sheet.height) < 1, 'Mismatched panel heights')
                if (innerWidth > 800)
                    assert(
                        Math.abs(final.reader.x - final.sheet.x - final.sheet.width - 24) < 1,
                        'Incorrect desktop gap'
                    )
                assert(document.documentElement.scrollWidth === innerWidth, 'Horizontal page overflow')
                if (quiet) {
                    for (const key of ['sheet', 'reader']) {
                        const visible = opening.filter((frame) => frame.time > 25 && frame[key])
                        const endpoints = [final[key].x, key === 'sheet' ? first.at(-1).sheet.x : final[key].x]
                        assert(
                            visible.every((frame) => endpoints.some((x) => Math.abs(frame[key].x - x) < 1)),
                            `Reduced motion interpolated position: ${key}`
                        )
                    }
                }
                const node = get('.history-entry-dialog')
                const nextRow = get('.history-month li:nth-child(2) .history-row') ?? get('.history-row')
                const nextTitle = nextRow.querySelector('.history-row-title').textContent
                click(nextRow === get('.history-row') ? '.history-row' : '.history-month li:nth-child(2) .history-row')
                await pause(30)
                assert(
                    get('.history-entry-dialog') === node && snapshot().title === nextTitle,
                    'Row selection remounted or failed to update reader'
                )
                const closing = await record(() => click('.history-reader-close'))
                assert(
                    !closing.at(-1).reader && closing.some((frame) => frame.reader && frame.title),
                    'Reader exit lost content or did not unmount'
                )
                settled(closing, 'sheet')
                // Reverse while opening, then reverse the exit at 80ms. Retain the same DOM node.
                click('.history-row')
                await pause(80)
                const retained = get('.history-entry-dialog')
                click('.history-reader-close')
                await pause(80)
                const before = snapshot()
                click('.history-row')
                await pause(0)
                const after = snapshot()
                assert(get('.history-entry-dialog') === retained, 'Interruption recreated reader')
                if (!quiet) assert(Math.abs(before.reader.x - after.reader.x) < 80, 'Reversal jumped to endpoint')
                await pause(300)
                const together = await record(() => click('.entry-history [aria-label="Close drawer"]'))
                const paired = together.filter((frame) => frame.reader && frame.sheet)
                assert(paired.length > 2 && paired.every((frame) => frame.title), 'Combined exit lost content')
                const gaps = paired.map((frame) => frame.reader.x - frame.sheet.x)
                assert(Math.max(...gaps) - Math.min(...gaps) < 2, 'Combined exit gap changed')
                assert(!together.at(-1).sheet && !together.at(-1).reader, 'Exit left portals mounted')
                assert(getComputedStyle(document.body).pointerEvents !== 'none', 'Body remains pointer blocked')
                assert(getComputedStyle(document.body).overflow !== 'hidden', 'Scroll lock leaked')
                assert(document.activeElement === get('.history-trigger'), 'Focus did not return to trigger')
                return {
                    width: innerWidth,
                    quiet,
                    frames: first.length + opening.length + closing.length + together.length,
                    passed: true
                }
            }})(${quiet})`
        )
    try {
        await window.loadFile(resolve('out/renderer/index.html'), { query: { data: 'sample' } })
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluate(`!!document.querySelector('.history-trigger')`)) break
            await pause(30)
        }
        const results = []
        for (const width of [1440, 1024, 768, 390]) {
            window.setContentSize(width, 1000)
            await pause(100)
            console.info('Checking width', width)
            results.push(await check())
        }
        console.info('Checking mounted resize and outside dismissal')
        // Resize the same mounted pair across the breakpoint in both directions.
        await evaluate(
            `document.querySelector('.history-trigger').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); document.querySelector('.history-trigger').click()`
        )
        await pause(300)
        await evaluate(`document.querySelector('.history-row').click()`)
        await pause(300)
        for (const width of [1440, 768, 390, 1024]) {
            // Arm the renderer before asking the native window to resize. Windows
            // may deliver its resize after setContentSize returns (including at 125% DPI).
            await evaluate(`(() => {
                window.__historyResize = {received:false, beforeWidth:innerWidth, previousAnimations:new Set([...document.querySelectorAll('.entry-history,.history-entry-dialog')].flatMap(element=>element.getAnimations()))};
                const state=window.__historyResize;
                const receive=()=>{state.received=true;state.receivedAt=performance.now();clearTimeout(timeout)};
                const timeout=setTimeout(()=>removeEventListener('resize',receive),2000);
                addEventListener('resize',receive,{once:true});
                return true;
            })()`)
            window.setContentSize(width, 1000)
            const synchronization = await evaluate(`(async () => {
                const state=window.__historyResize;
                const deadline=performance.now()+2000;
                while(!state.received && performance.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
                if(!state.received) return {received:false,beforeWidth:state.beforeWidth,error:'Renderer did not acknowledge native resize'};
                // React handles the resize in a follow-up commit. Give that commit
                // two frames to publish its animations, then observe actual settling.
                await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
                const start=performance.now(), observed=[];
                while(performance.now()-start<1000) {
                    const animations=[...document.querySelectorAll('.entry-history,.history-entry-dialog')].flatMap(element=>element.getAnimations()).filter(animation=>!state.previousAnimations.has(animation));
                    for(const animation of animations) observed.push({duration:animation.effect.getComputedTiming().duration,state:animation.playState});
                    if(animations.length>=2 && animations.every(animation=>animation.playState==='finished')) {
                        await new Promise(requestAnimationFrame);
                        return {received:true,beforeWidth:state.beforeWidth,settledAfter:performance.now()-state.receivedAt,observed};
                    }
                    await new Promise(requestAnimationFrame);
                }
                return {received:true,beforeWidth:state.beforeWidth,error:'Resize controller did not publish and settle both panel animations',observed};
            })()`)
            const bounds = await evaluate(`(() => {
                const sheet=document.querySelector('.entry-history'), reader=document.querySelector('.history-entry-dialog');
                const a=sheet.getBoundingClientRect(), b=reader.getBoundingClientRect();
                const animations=[sheet,reader].flatMap(element=>element.getAnimations().map(animation=>({
                    currentTime:animation.currentTime, playState:animation.playState, timing:animation.effect.getComputedTiming()
                })));
                return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth},
                    sheet:a.toJSON(), reader:b.toJSON(), gap:b.left-a.right, animations,
                    passed:Math.abs(a.height-b.height)<1 && Math.abs(b.right-(innerWidth > 800 ? innerWidth-24 : innerWidth-12))<1 &&
                        document.documentElement.scrollWidth===innerWidth && (innerWidth<=800 || Math.abs(b.left-a.right-24)<1)}
            })()`)
            assert(
                !synchronization.error &&
                    synchronization.observed.every((animation) => Number(animation.duration) <= 300) &&
                    bounds.passed,
                `Open-pair resize geometry failed: ${JSON.stringify({ requestedWidth: width, nativeContentSize: window.getContentSize(), synchronization, bounds })}`
            )
        }
        // An actual outside pointer dismisses both Radix surfaces and releases the body.
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 2, y: 2, button: 'left', clickCount: 1 })
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 2, y: 2, button: 'left', clickCount: 1 })
        await pause(320)
        assert(
            await evaluate(
                `!document.querySelector('.entry-history') && !document.querySelector('.history-entry-dialog') && getComputedStyle(document.body).pointerEvents !== 'none'`
            ),
            'Outside dismissal failed'
        )
        window.setContentSize(1440, 1000)
        window.webContents.debugger.attach('1.3')
        console.info('Checking paired drag interruption, cancellation and dismissal')
        const mouse = (type, x, y) =>
            window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
                type,
                x,
                y,
                button: type === 'mouseMoved' ? 'none' : 'left',
                buttons: type === 'mouseReleased' ? 0 : 1,
                clickCount: 1
            })
        const pair = () =>
            evaluate(`(() => {
            const s=document.querySelector('.entry-history'), r=document.querySelector('.history-entry-dialog');
            return {sheet:s?.getBoundingClientRect().x, reader:r?.getBoundingClientRect().x,
                gap:s&&r?r.getBoundingClientRect().left-s.getBoundingClientRect().right:null}
        })()`)
        for (const mode of ['cancel', 'dismiss']) {
            await evaluate(
                `if (!document.querySelector('.entry-history')) document.querySelector('.history-trigger').click()`
            )
            await pause(300)
            await evaluate(`document.querySelector('.history-row').click()`)
            await pause(80) // Grab the pair before reader entrance finishes.
            const handle = await evaluate(
                `(() => {const r=document.querySelector('.entry-history > div:first-child').getBoundingClientRect();return {x:r.x+40,y:r.y+24}})()`
            )
            await mouse('mousePressed', handle.x, handle.y)
            await pause(25)
            const before = await pair()
            await mouse('mouseMoved', Number(handle.x) + 100, handle.y)
            await pause(60)
            const during = await pair()
            assert(Math.abs(during.gap - before.gap) < 1, 'Paired drag changed gap')
            assert(
                Math.abs(during.sheet - before.sheet - 100) < 1 && Math.abs(during.reader - before.reader - 100) < 1,
                'Drag did not move both surfaces'
            )
            if (mode === 'cancel') {
                await evaluate(
                    `document.querySelector('.entry-history > div:first-child').dispatchEvent(new PointerEvent('pointercancel', {bubbles:true, pointerId:1}))`
                )
                await mouse('mouseReleased', Number(handle.x) + 100, handle.y)
                await pause(300)
                const final = await pair()
                assert(Math.abs(final.gap - 24) < 1, 'Cancelled drag did not restore pair')
                await evaluate(`document.querySelector('.history-reader-close').click()`)
                await pause(300)
            } else {
                await mouse('mouseMoved', Number(handle.x) + 180, handle.y)
                await mouse('mouseReleased', Number(handle.x) + 180, handle.y)
                const frames = []
                for (let i = 0; i < 15; i++) {
                    frames.push(await pair())
                    await pause(20)
                }
                assert(
                    frames.filter((frame) => frame.gap !== null).every((frame) => Math.abs(frame.gap - before.gap) < 2),
                    'Drag dismissal separated pair'
                )
                assert(
                    await evaluate(
                        `!document.querySelector('.entry-history') && !document.querySelector('.history-entry-dialog') && getComputedStyle(document.body).pointerEvents !== 'none'`
                    ),
                    'Drag dismissal leaked portals'
                )
            }
        }
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
        })
        await pause(100)
        console.info('Checking reduced motion')
        results.push(await check(true))
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
        console.info('Checking keyboard')
        window.webContents.focus()
        // Real Electron keyboard input exercises modality and Radix Escape/focus restoration.
        await evaluate(`document.querySelector('.history-trigger').focus()`)
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            text: '\r'
        })
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13
        })
        await pause(40)
        const keyboardX = await evaluate(`document.querySelector('.entry-history').getBoundingClientRect().x`)
        await pause(100)
        assert(
            await evaluate(
                `Math.abs(document.querySelector('.entry-history').getBoundingClientRect().x - ${keyboardX}) < 1`
            ),
            'Keyboard open travelled'
        )
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27
        })
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27
        })
        await pause(160)
        assert(
            await evaluate(
                `!document.querySelector('.entry-history') && document.activeElement === document.querySelector('.history-trigger')`
            ),
            'Escape did not clean up/restore focus'
        )
        console.info(JSON.stringify({ results, keyboard: true, passed: true }))
        app.exit(0)
    } catch (error) {
        console.error(error)
        app.exit(1)
    }
})
