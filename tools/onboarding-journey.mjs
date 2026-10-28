import { onboardingDisclosureJourney } from './onboarding-disclosure-journey.mjs'
import { dialog, nativeTheme } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** Runs inside the existing provider-boundary fixture, through the real renderer, preload and store. */
export async function onboardingJourney({ window, directory, output, js, wait, assert, click, approveNotion, record }) {
    if (process.env.GITORIAN_VERIFY_ONBOARDING_DISCLOSURE === '1') {
        await onboardingDisclosureJourney({ window, output, js, wait })
        return
    }
    const reducedMotion = process.env.GITORIAN_VERIFY_ONBOARDING_REDUCED === '1'
    const inline = process.env.GITORIAN_VERIFY_ONBOARDING_INLINE === '1'
    const resume = async () => {
        if (!inline) await click('Continue setup')
        await wait(`!!document.querySelector('section[data-controlled]')`)
    }
    const pause = (ms) => new Promise((done) => setTimeout(done, ms))
    const headerGeometry = []
    const checkHeaderShape = async (stage) => {
        const geometry =
            await js(`(() => ({width:innerWidth,buttons:Array.from(document.querySelectorAll('.hub-utilities button:not(.hub-setup-trigger)')).map(node=>{
            const r=node.getBoundingClientRect();return {name:node.getAttribute('aria-label'),width:r.width,height:r.height};
        })}))()`)
        headerGeometry.push({ stage, ...geometry })
        writeFileSync(join(output, 'header-geometry.json'), JSON.stringify(headerGeometry, null, 2))
        if (!geometry.buttons.length || geometry.buttons.some((button) => Math.abs(button.width - button.height) > 0.5))
            throw new Error(`Header icon buttons are not square: ${JSON.stringify({ stage, ...geometry })}`)
        const setup = await js(`(() => {
            const button=document.querySelector('.hub-setup-trigger');if(!button)return null;
            const r=button.getBoundingClientRect(), style=getComputedStyle(button);
            const canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.font;
            const required=context.measureText('Continue setup').width+17+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight);
            const icons=Array.from(document.querySelectorAll('.hub-utility-icons button')).map(node=>node.getBoundingClientRect());
            return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,required,overlaps:icons.some(i=>Math.min(r.right,i.right)-Math.max(r.left,i.left)>.5&&Math.min(r.bottom,i.bottom)-Math.max(r.top,i.top)>.5),hit:document.elementFromPoint(r.right-8,r.top+r.height/2)?.closest('button')===button};
        })()`)
        if (setup) {
            headerGeometry.push({ stage, setup })
            writeFileSync(join(output, 'header-geometry.json'), JSON.stringify(headerGeometry, null, 2))
            if (setup.width < setup.required || setup.overlaps || !setup.hit)
                throw new Error(
                    `Continue setup label or hover target overlaps header controls: ${JSON.stringify(setup)}`
                )
            window.focus()
            window.webContents.focus()
            window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
            window.webContents.sendInputEvent({
                type: 'mouseMove',
                x: Math.round(Number(setup.right) - 8),
                y: Math.round((Number(setup.top) + Number(setup.bottom)) / 2)
            })
            await wait(
                `document.querySelector('.hub-setup-trigger').matches(':hover') && !document.querySelector('.hub-utility-icons button:hover')`
            )
            await pause(200)
            writeFileSync(join(output, `header-${stage}-hover.png`), (await window.webContents.capturePage()).toPNG())
        }
    }
    const startRevealTrace = async () => {
        await js(`(() => {
            const frames=[]; const started=performance.now();
            window.__revealTrace={frames,started};
            const sample=()=>{
                const region=name=>{
                    const node=document.querySelector('[data-overview-region="'+name+'"]');
                    if(!node) return null;
                    const style=getComputedStyle(node), rect=node.getBoundingClientRect();
                    const matrix=new DOMMatrixReadOnly(style.transform==='none'?undefined:style.transform);
                    return {opacity:Number(style.opacity),transform:style.transform,top:rect.top,layoutTop:rect.top-matrix.m42,
                        properties:node.getAnimations().flatMap(a=>a.effect.getKeyframes().flatMap(frame=>Object.keys(frame).filter(k=>!['offset','computedOffset','easing','composite'].includes(k))))};
                };
                const setup=document.querySelector('.hub-onboarding-panel');
                frames.push({time:performance.now()-started,stats:region('stats'),activity:region('activity'),
                    setup:setup?{opacity:Number(getComputedStyle(setup).opacity),transform:getComputedStyle(setup).transform,inert:setup.inert}:null});
                window.__revealTrace.frame=requestAnimationFrame(sample);
            };sample();
        })()`)
    }
    const finishRevealTrace = async (name, instant = false) => {
        await pause(450)
        const trace = await js(
            `(() => {cancelAnimationFrame(window.__revealTrace.frame);return window.__revealTrace.frames})()`
        )
        writeFileSync(
            join(output, `${name}-motion.json`),
            JSON.stringify({ reducedMotion, instant, frames: trace }, null, 2)
        )
        const metrics = {}
        for (const region of ['stats', 'activity']) {
            const shown = trace.filter((frame) => frame[region]?.opacity > 0.01)
            const middle = shown.filter((frame) => frame[region].opacity < 0.99)
            const final = shown.at(-1)?.[region]
            if (!final || final.opacity < 0.99) throw new Error(`${name}: ${region} never settled`)
            const positions = shown.map((frame) => frame[region].layoutTop)
            const drift = Math.max(...positions) - Math.min(...positions)
            if (drift > 1) throw new Error(`${name}: ${region} jumped ${drift}px during reveal`)
            if (!instant && middle.length < 2)
                throw new Error(`${name}: ${region} appeared without a visible transition`)
            if (instant && middle.length) throw new Error(`${name}: keyboard dismissal animated`)
            if (
                (reducedMotion || instant) &&
                shown.some((frame) => !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(frame[region].transform))
            )
                throw new Error(`${name}: movement in reduced/keyboard mode`)
            if (
                shown.some((frame) =>
                    frame[region].properties.some((property) => !['opacity', 'transform'].includes(property))
                )
            )
                throw new Error(`${name}: a reveal animated layout properties`)
            metrics[region] = { intermediateFrames: middle.length, layoutDrift: drift, firstShown: shown[0].time }
        }
        if (trace.some((frame) => frame.setup && frame.setup.opacity < 0.99 && !frame.setup.inert))
            throw new Error('Outgoing setup retained interactive controls')
        if (
            instant &&
            trace.some(
                (frame) =>
                    frame.setup &&
                    (frame.setup.opacity < 0.99 ||
                        !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(frame.setup.transform))
            )
        )
            throw new Error('Keyboard dismissal animated its outgoing card')
        writeFileSync(
            join(output, `${name}-motion.json`),
            JSON.stringify({ reducedMotion, instant, metrics, frames: trace }, null, 2)
        )
    }
    const pointerDismiss = async () => {
        const point = await js(
            `(() => {const r=document.querySelector('[aria-label="Dismiss setup"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
        )
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    }
    const shot = async (name) => {
        await pause(300)
        writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
        record({ screenshot: `${name}.png`, text: await js('document.body.innerText') })
    }
    const key = 'gitorian:onboarding:v1:local'
    const reload = async () => {
        const loaded = new Promise((done) => window.webContents.once('did-finish-load', done))
        window.webContents.reload()
        await loaded
        await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
        await pause(250)
    }
    const closeSettings = async () => {
        await click('Close dialog')
        await wait(`!document.querySelector('.settings')`)
        await pause(350)
    }
    window.setMinimumSize(300, 400)
    const setupCard = `document.querySelector('section[data-controlled]')`
    const actStep = async (id) => {
        const row = `${setupCard}.querySelector('[data-step="${id}"]')`
        await wait(`!!${row}`)
        if (!(await js(`!!${row}.querySelector('[data-primary]')`)))
            await js(`${row}.querySelector('[data-title]').click()`)
        await wait(`!!${row}.querySelector('[data-primary]')`)
        await js(`${row}.querySelector('[data-primary]').click()`)
    }
    await wait(`${setupCard}?.textContent.includes('Set up your journal')`)
    await assert(
        `document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')==='0' && !document.querySelector('.hub-stats') && !document.querySelector('.hub-thread-layout') && !document.querySelector('.hub-footer')`
    )
    await assert(`${setupCard}.querySelector('[data-step="accounts"] [data-primary]').textContent.trim()==='Connect'`)
    await assert(`(() => {
        const preview=document.querySelector('.hub-activity-preview');
        const illustration=preview?.querySelector('[aria-hidden="true"][inert]');
        return preview?.textContent.includes('Your commits, pull requests, and reviews will appear here.') && illustration && !preview.querySelector('button,a,input,[tabindex], [aria-busy="true"]') && illustration.getAnimations({subtree:true}).length===0;
    })()`)
    await shot('01-first-launch')
    await checkHeaderShape('first-launch')
    const originalHeight = await js(`${setupCard}.getBoundingClientRect().height`)
    await click('Hide checklist')
    await wait(`${setupCard}.dataset.hidden==='true' && ${setupCard}.querySelector('[inert]') !== null`)
    await assert(
        `!document.querySelector('.hub-stats') && !document.querySelector('.hub-setup-trigger') && !document.querySelector('.hub-thread-layout')`
    )
    await assert(`!!document.querySelector('.hub-activity-preview')`)
    await shot('01c-collapsed')
    await assert(`${setupCard}.getBoundingClientRect().height < ${originalHeight}`)
    await js(`${setupCard}.querySelector('[aria-label="Show checklist"]').focus()`)
    window.show()
    window.focus()
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await wait(`${setupCard}.dataset.hidden !== 'true'`)
    await assert(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')==='0'`)
    await shot('01d-expanded')
    const controls = await js(`(() => {
        const card=${setupCard};
        const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};
        return {hide:rect(card.querySelector('[aria-label="Hide checklist"]')),dismiss:rect(card.querySelector('[aria-label="Dismiss setup"]'))};
    })()`)
    if (
        controls.dismiss.width !== 32 ||
        controls.dismiss.height !== 32 ||
        controls.dismiss.left - controls.hide.right < 8
    )
        throw new Error(`Dismiss target or spacing is too small: ${JSON.stringify(controls)}`)
    writeFileSync(join(output, 'header-actions.json'), JSON.stringify(controls, null, 2))
    const dismissPoint = await js(
        `(() => {const r=${setupCard}.querySelector('[aria-label="Dismiss setup"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
    )
    window.webContents.focus()
    await js(`(() => {
        window.__dismissPointer=[];
        window.__dismissPointerListener=event=>window.__dismissPointer.push({x:event.clientX,y:event.clientY,type:event.pointerType,buttons:event.buttons,dismiss:!!event.target.closest('[aria-label="Dismiss setup"]')});
        document.addEventListener('pointermove',window.__dismissPointerListener,true);
    })()`)
    // Establish a real leave/enter sequence instead of inheriting pointer state from prior steps.
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 100 })
    await wait(`window.__dismissPointer.some(event=>!event.dismiss)`)
    const zoom = window.webContents.getZoomFactor()
    window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(dismissPoint.x * zoom),
        y: Math.round(dismissPoint.y * zoom)
    })
    await wait(
        `window.__dismissPointer.some(event=>event.dismiss && event.type==='mouse' && event.buttons===0) && document.querySelector('[aria-label="Dismiss setup"]').matches(':hover')`
    )
    record({
        dismissHover: await js(
            `(() => {document.removeEventListener('pointermove',window.__dismissPointerListener,true);return {point:${JSON.stringify(dismissPoint)},zoom:${zoom},focused:document.hasFocus(),events:window.__dismissPointer}})()`
        )
    })
    await wait(
        `Array.from(document.querySelectorAll('[role="tooltip"]')).some(n=>n.textContent.includes('Dismiss setup'))`
    )
    await shot('01e-dismiss-tooltip')
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 })
    await js(`document.querySelector('.hub-hero-action button').click()`)
    await wait(`!!document.querySelector('[aria-label="Journal breadcrumb"]')`)
    await shot('01b-writing-available')
    await click('Hub')
    await wait(`!!${setupCard}`)
    await actStep('accounts')
    await wait(`document.querySelector('[role="tab"][data-state="active"]')?.textContent==='Connections'`)
    await shot('02-connect-accounts')
    await closeSettings()
    await reload()
    await assert(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')==='0'`)
    window.show()
    window.focus()
    await pause(200)
    // Keyboard disclosure, then navigation into the matching Settings tab.
    await js(`${setupCard}.querySelector('[data-step="repositories"] [data-title]').focus()`)
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await wait(`${setupCard}.querySelector('[data-step="repositories"] [data-primary]') !== null`)
    await actStep('repositories')
    await wait(`document.querySelector('[role="tab"][data-state="active"]')?.textContent==='Repositories'`)
    await shot('03-import-settings')
    await closeSettings()
    // Theme/viewport coverage uses the actual desktop renderer, not a browser mock.
    const geometry = []
    const colors = []
    for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [
                { name: 'prefers-color-scheme', value: theme },
                { name: 'prefers-reduced-motion', value: 'reduce' }
            ]
        })
        // Retained light-theme visual fixture; production stays dark on OS changes.
        await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; true`)
        await wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`)
        await pause(100)
        colors.push({
            theme,
            pairs: await js(`(() => {
            const card=${setupCard};
            const ctx=document.createElement('canvas').getContext('2d');
            const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data)};
            return [...card.querySelectorAll('h2,p,[data-title],[data-primary]'),...document.querySelectorAll('.hub-preview-heading h2,.hub-preview-heading p')].filter(n=>n.getBoundingClientRect().height>0).map(n=>{
                const backgrounds=[]; for(let el=n;el;el=el.parentElement) backgrounds.push(rgba(getComputedStyle(el).backgroundColor));
                let bg=[255,255,255]; for(const layer of backgrounds.reverse()) bg=bg.map((v,i)=>layer[i]*(layer[3]/255)+v*(1-layer[3]/255));
                const fg=rgba(getComputedStyle(n).color); const rendered=bg.map((v,i)=>fg[i]*(fg[3]/255)+v*(1-fg[3]/255));
                return {text:n.textContent,foreground:rendered,background:bg};
            });
        })()`)
        })
        for (const width of [320, 390, 768, 1024, 1440]) {
            window.setContentSize(width, 1000)
            await pause(150)
            const bounds = await js(
                `(() => {const r=${setupCard}.getBoundingClientRect(); return {viewport:innerWidth,left:r.left,right:r.right,scroll:document.documentElement.scrollWidth}})()`
            )
            if (Math.abs(bounds.viewport - width) > 2) throw new Error(`Requested ${width}px, got ${bounds.viewport}px`)
            if (
                bounds.left < 0 ||
                bounds.right > Number(bounds.viewport) + 1 ||
                bounds.scroll > Number(bounds.viewport) + 1
            )
                throw new Error(`Setup overflow: ${JSON.stringify(bounds)}`)
            const layout = await js(`(() => {
                const row=${setupCard}.querySelector('[data-current]');
                const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
                return {title:rect(row.querySelector('[data-title]')),description:rect(row.querySelector('p')),action:rect(row.querySelector('[data-primary]'))};
            })()`)
            if (width >= 768 && layout.action.left < layout.description.right)
                throw new Error(`Wide action is not beside its copy: ${JSON.stringify(layout)}`)
            if (width <= 390 && layout.action.top < layout.description.bottom)
                throw new Error(`Narrow action overlaps its copy: ${JSON.stringify(layout)}`)
            const preview = await js(`(() => {
                const node=document.querySelector('.hub-activity-preview'); const r=node.getBoundingClientRect();
                return {left:r.left,right:r.right,viewport:innerWidth,sidebar:getComputedStyle(node.querySelector('.hub-preview-projects')).display};
            })()`)
            if (
                preview.left < 0 ||
                preview.right > Number(preview.viewport) + 1 ||
                (width <= 768 && preview.sidebar !== 'none')
            )
                throw new Error(`Preview overflow or narrow sidebar: ${JSON.stringify(preview)}`)
            geometry.push({ theme, width, ...bounds, layout, preview })
            if ([390, 1440].includes(width)) await shot(`layout-${theme}-${width}`)
        }
    }
    window.setContentSize(1280, 900)
    window.webContents.setZoomFactor(2)
    await pause(200)
    await shot('layout-200-percent')
    await assert(`${setupCard}.getBoundingClientRect().right <= innerWidth + 1`)
    window.webContents.setZoomFactor(1)
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [
            { name: 'prefers-color-scheme', value: 'dark' },
            { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }
        ]
    })
    const luminance = (rgb) =>
        rgb
            .map((v) => {
                const x = v / 255
                return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
            })
            .reduce((sum, v, i) => Number(sum) + v * [0.2126, 0.7152, 0.0722][i], 0)
    for (const theme of colors)
        for (const pair of theme.pairs) {
            const a = luminance(pair.foreground),
                b = luminance(pair.background)
            pair.ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
            if (pair.ratio < 4.5)
                throw new Error(`Text contrast failed: ${JSON.stringify({ theme: theme.theme, ...pair })}`)
        }
    writeFileSync(join(output, 'contrast.json'), JSON.stringify(colors, null, 2))
    writeFileSync(join(output, 'layout.json'), JSON.stringify(geometry, null, 2))
    if (!inline) {
        await click('Hide checklist')
        await wait(`${setupCard}.dataset.hidden==='true'`)
        if (!reducedMotion) {
            await startRevealTrace()
            await js(`document.querySelector('[aria-label="Dismiss setup"]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
            window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
            await wait(`!!document.querySelector('.hub-thread-layout')`)
            await finishRevealTrace('keyboard-dismiss', true)
            record({ fixture: 'Reset only onboarding visibility to exercise pointer dismissal independently' })
            await js(`localStorage.setItem(${JSON.stringify(key)},'active')`)
            await reload()
            await wait(`!!${setupCard}`)
            await click('Hide checklist')
            await wait(`${setupCard}.dataset.hidden==='true'`)
        }
        await startRevealTrace()
        await pointerDismiss()
        await pause(60)
        writeFileSync(join(output, 'reveal-in-flight.png'), (await window.webContents.capturePage()).toPNG())
        await pause(90)
        writeFileSync(join(output, 'reveal-entering.png'), (await window.webContents.capturePage()).toPNG())
        await finishRevealTrace('dismiss')
        await wait(`!!document.querySelector('.hub-stats') && !!document.querySelector('.hub-setup-trigger')`)
        await shot('04-dismissed')
        await checkHeaderShape('continue-setup')
        await reload()
        await assert(`!${setupCard} && !!document.querySelector('.hub-setup-trigger')`)
        await click('Continue setup')
        await wait(`!!document.querySelector('.hub-setup-popover')`)
        await assert(`!document.querySelector('.hub-setup-popover [aria-label="Dismiss setup"]')`)
        await click('Hide checklist')
        await wait(`${setupCard}.dataset.hidden==='true'`)
        await assert(`!!document.querySelector('.hub-thread-layout')`)
        await click('Show checklist')
        await wait(`${setupCard}.dataset.hidden!=='true'`)
        await assert(`!document.querySelector('.hub-activity-preview')`)
        await shot('05-resume-popover')
        await assert(
            `(() => {const nodes=Array.from(document.querySelectorAll('.hub-utility-icons button')); const trigger=document.querySelector('.hub-setup-trigger').getBoundingClientRect(); return nodes.length===4 && nodes.every(n=>n.getBoundingClientRect().left >= trigger.right - 1)})()`
        )
        window.setContentSize(320, 900)
        await pause(200)
        await assert(
            `(() => {const r=document.querySelector('.hub-setup-popover').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1})()`
        )
        await shot('05b-narrow-popover')
        await checkHeaderShape('narrow-continue-setup')
        window.setContentSize(1280, 900)
        await pause(200)
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        await wait(
            `!document.querySelector('.hub-setup-popover') && document.activeElement?.classList.contains('hub-setup-trigger')`
        )
        await click('Continue setup')
        await wait(`!!${setupCard}`)
        await actStep('accounts')
        await wait(
            `!!document.querySelector('[aria-label="GitHub accounts"]') && !document.querySelector('.hub-setup-popover')`
        )
    } else {
        await shot('05-inline-setup')
        await actStep('accounts')
    }
    await click('Add GitHub account')
    await wait(`window.journal.invoke({type:'state'}).then(r=>r.connections.remote)`)
    await closeSettings()
    await resume()
    await wait(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')==='0'`)
    await shot('06-one-account-incomplete')
    await actStep('accounts')
    await wait(`!!document.querySelector('[aria-label="Notion connection"]')`)
    const notionScope = `document.querySelector('[aria-label="Notion connection"]')`
    await click('Connect', notionScope)
    await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
    await approveNotion()
    await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
    await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
    await wait(`!!document.querySelector('button[aria-label="Expand Personal"]')`)
    await click('Expand Personal')
    await wait(`!!document.querySelector('[role="treeitem"][title="Engineering notes"]')`)
    await js(`document.querySelector('[role="treeitem"][title="Engineering notes"]').click()`)
    await click('Confirm', notionScope)
    await wait(`window.journal.invoke({type:'state'}).then(r=>r.connections.notion)`)
    await closeSettings()
    await resume()
    await wait(`document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')==='1'`)
    await wait(`!${setupCard}.querySelector('[data-step="accounts"]')`)
    await shot('07-accounts-complete')
    // Import through Settings and the real native-picker boundary. Only repository behavior creates a Git fixture.
    const repo = join(directory, 'journal-project')
    mkdirSync(repo)
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, windowsHide: true, stdio: 'ignore' })
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [repo] })
    await actStep('repositories')
    await wait(`!!document.querySelector('.settings-import-button')`)
    await click('Add repositories from folder')
    await wait(`document.querySelectorAll('.repository-import-row').length===1`)
    await shot('08-import-review')
    await click('Import 1 repository')
    await wait(`window.journal.invoke({type:'state'}).then(r=>r.state.repositories.length===1)`)
    await wait(`!document.querySelector('.repository-import-review')`)
    if (inline) {
        await wait(`document.querySelector('.hub-onboarding-panel [data-complete]') !== null`)
        await assert(
            `!!document.querySelector('.hub-onboarding-panel') && !document.querySelector('.hub-thread-layout')`
        )
        await startRevealTrace()
    }
    await closeSettings()
    if (inline) await finishRevealTrace('completion')
    await wait(
        `!!document.querySelector('.hub-stats') && !document.querySelector('.hub-setup-trigger') && !${setupCard}`
    )
    await assert(`!document.querySelector('.hub-activity-preview')`)
    await shot('09-complete-stats')
    await reload()
    await assert(`!document.querySelector('.hub-setup-trigger') && !${setupCard}`)
    await assert(`localStorage.getItem(${JSON.stringify(key)})==='complete'`)
    // Explicit fixture command proves completion is permanent after a later disconnect.
    await js(`window.journal.invoke({type:'disconnect',service:'github'})`)
    await reload()
    await assert(`!document.querySelector('.hub-setup-trigger') && !${setupCard}`)
    writeFileSync(
        join(output, 'preferences.json'),
        JSON.stringify(
            await js(
                `Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('gitorian:onboarding:')))`
            )
        )
    )
    // Existing-user migration precondition: populated profile with no onboarding preference.
    await js(`localStorage.removeItem(${JSON.stringify(key)})`)
    await reload()
    await assert(
        `!!document.querySelector('.hub-stats') && !document.querySelector('.hub-setup-trigger') && !${setupCard}`
    )
    await assert(`localStorage.getItem(${JSON.stringify(key)})==='existing'`)
    await shot('10-existing-profile')
    writeFileSync(
        join(output, 'journey.json'),
        JSON.stringify(
            {
                passed: true,
                simulated: [
                    'GitHub and Notion provider HTTP',
                    'OAuth browser launch',
                    'avatar transport',
                    'native folder picker'
                ],
                real: [
                    'Electron renderer',
                    'preload',
                    'IPC',
                    'vault',
                    'SQLite',
                    'localStorage',
                    'Git discovery and import'
                ],
                outcomes: [
                    'first launch',
                    'both Settings entry points',
                    'Hide/Show disclosure via pointer and keyboard',
                    'separate dismiss target and tooltip',
                    'dismiss while collapsed and reload',
                    'keyboard popover Escape and focus return',
                    'one provider incomplete',
                    'both providers complete',
                    'real repository import',
                    'completed reload and later disconnect',
                    'existing profile',
                    'themes, narrow widths, reduced motion, zoom'
                ]
            },
            null,
            2
        )
    )
}
