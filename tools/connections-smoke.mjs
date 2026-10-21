import { app, shell, clipboard, nativeTheme } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Real renderer, preload, IPC, vault and store. Only GitHub HTTP and browser launch are simulated.
const directory = process.env.WEEKLY_J_VERIFY_STATE
const output = process.env.WEEKLY_J_VERIFY_OUTPUT
if (!directory || !output) throw new Error('Use pnpm verify connections for managed isolation and cleanup')
app.setPath('userData', join(directory, 'profile'))
nativeTheme.themeSource = 'dark'
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'ConnectionIdentity.tsx'), readFileSync(resolve('src/renderer/ConnectionIdentity.tsx')))
const record = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const stressMotion = process.env.WEEKLY_J_VERIFY_MOTION === 'stress'
const githubLogin = stressMotion ? 'weekly-j-fixture-with-a-long-github-name' : 'weekly-j-fixture'
const notionName = stressMotion ? 'Weekly journal with an exceptionally long integration name' : 'Weekly journal'
let attempt = 0
let authorize = false
let notionAllowed = false
const requests = []
globalThis.fetch = (input, init) =>
    Promise.resolve().then(async () => {
        const url = input instanceof Request ? input.url : input.toString()
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        requests.push({ url, method: init?.method ?? 'GET', body })
        const json = (data) => new Response(JSON.stringify(data))
        if (url === 'https://github.com/login/device/code') {
            attempt++
            await pause(800)
            if (attempt === 1) throw new Error('Simulated offline connection')
            return json({
                device_code: `fixture-device-${attempt}`,
                user_code: attempt === 2 ? 'ABCD-EFGH' : 'IJKL-MNOP',
                verification_uri: 'https://github.com/login/device',
                interval: 1,
                expires_in: 900
            })
        }
        if (url === 'https://github.com/login/oauth/access_token')
            return json(
                attempt === 3
                    ? { error: 'expired_token' }
                    : attempt === 4
                      ? { error: 'access_denied' }
                      : authorize
                        ? { access_token: 'fixture-only-token' }
                        : { error: 'authorization_pending' }
            )
        if (url === 'https://api.github.com/user') return json({ login: githubLogin })
        if (url === 'https://api.github.com/user/emails') return json([{ email: 'fixture@example.com' }])
        if (url === 'https://api.notion.com/v1/users/me') {
            await pause(1000)
            return notionAllowed
                ? json({ name: notionName, avatar_url: stressMotion ? 'https://fixture.invalid/avatar.svg' : null })
                : new Response(JSON.stringify({ message: 'Fixture invalid token' }), { status: 401 })
        }
        throw new Error(`Unexpected external request: ${url}`)
    })
shell.openExternal = (url) =>
    Promise.resolve().then(async () => {
        await pause(700)
        record({ browser: url, simulated: true })
        if (attempt === 2) throw new Error('Simulated missing browser')
    })

let checking = false
app.on('browser-window-created', (_, window) => {
    window.webContents.session.protocol.handle('https', async (request) => {
        if (!request.url.endsWith('.png?size=64') && request.url !== 'https://fixture.invalid/avatar.svg')
            throw new Error(`Unexpected renderer HTTP: ${request.url}`)
        await pause(1600)
        record({ avatar: request.url, simulated: true, delay: 1600 })
        return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#344d45"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18">W</text></svg>',
            { headers: { 'content-type': 'image/svg+xml' } }
        )
    })
    window.setMinimumSize(320, 400)
    window.setContentSize(1280, 900)
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (checking) return
        checking = true
        const js = async (expression) => {
            record({ action: expression })
            return await window.webContents.executeJavaScript(expression, true).catch(
                /** @param {unknown} error */ (error) => {
                    console.error('Failed expression:', expression)
                    throw error
                }
            )
        }
        const wait = async (expression) => {
            for (let i = 0; i < 120; i++) {
                if (await js(expression)) return
                await pause(75)
            }
            throw new Error(`Timed out: ${expression}`)
        }
        const assert = async (expression) => {
            if (!(await js(expression))) throw new Error(`Failed: ${expression}`)
        }
        const click = async (text, scope = 'document') => {
            await js(
                `Array.from(${scope}.querySelectorAll('button')).find(b=>!b.closest('[inert]') && (b.getAttribute('aria-label')===${JSON.stringify(text)} || b.textContent.trim()===${JSON.stringify(text)})).click()`
            )
        }
        const startIdentityTrace = async (service) => {
            await js(`(() => {
                const frames=[]; const started=performance.now();
                window.__identityTrace={service:${JSON.stringify(service)},frames};
                const sample=()=>{
                    const section=document.querySelector('[aria-label="${service} connection"]');
                    const identity=section?.querySelector('.connection-identity');
                    const action=section?.querySelector('.settings-section-heading [role="group"]');
                    const rect=identity?.getBoundingClientRect();
                    frames.push({time:performance.now()-started,revealed:identity?.dataset.revealed==='true',
                        opacity:identity ? Number(getComputedStyle(identity).opacity) : 0,
                        transform:identity ? getComputedStyle(identity).transform : null,
                        left:rect?.left,top:rect?.top,width:rect?.width,height:rect?.height,
                        actionRight:action?.getBoundingClientRect().right});
                    window.__identityTrace.frame=requestAnimationFrame(sample);
                }; sample();
            })()`)
        }
        const finishIdentityTrace = async (service) => {
            await wait(
                `Array.from(document.querySelector('[aria-label="${service} connection"]').querySelectorAll('img')).every(img=>img.complete)`
            )
            await assert(
                `Array.from(document.querySelector('[aria-label="${service} connection"]').querySelectorAll('img')).every(img=>img.naturalWidth>0 && img.dataset.loaded==='true')`
            )
            await pause(200)
            const trace = await js(
                `(() => {cancelAnimationFrame(window.__identityTrace.frame);return window.__identityTrace})()`
            )
            const visible = trace.frames.filter((frame) => frame.opacity > 0.05 && frame.revealed)
            const landed = visible.filter((frame) => frame.opacity >= 0.99)
            const range = (frames, key) =>
                Math.max(...frames.map((frame) => frame[key])) - Math.min(...frames.map((frame) => frame[key]))
            const metrics = {
                visibleFrames: visible.length,
                transitionFrames: visible.filter((frame) => frame.opacity < 0.99).length,
                landedFrames: landed.length,
                horizontalShift: range(visible, 'left'),
                widthShift: range(visible, 'width'),
                settledVerticalShift: range(landed, 'top'),
                reducedMotion: stressMotion
            }
            writeFileSync(
                join(output, `${service.toLowerCase()}-identity-motion.json`),
                JSON.stringify({ trace, metrics }, null, 2)
            )
            if (
                stressMotion &&
                visible.some((frame) => frame.transform !== 'none' && frame.transform !== 'matrix(1, 0, 0, 1, 0, 0)')
            )
                throw new Error('Reduced motion identity used a movement transform')
            if (
                visible.length < 3 ||
                metrics.transitionFrames < 1 ||
                landed.length < 3 ||
                metrics.horizontalShift > 0.5 ||
                metrics.widthShift > 0.5 ||
                metrics.settledVerticalShift > 0.5
            )
                throw new Error(`${service} identity shifted during its reveal: ${JSON.stringify(metrics)}`)
        }
        const assertActionsFit = async (service) => {
            record({
                actionBounds: await js(
                    `(() => {const section=document.querySelector('[aria-label="${service} connection"]');return Array.from(section.querySelectorAll('.settings-section-heading,.settings-github-account,[role="group"],button')).filter(b=>!b.closest('[inert]')).map(b=>({tag:b.tagName,text:b.textContent,class:b.className,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right,width:b.getBoundingClientRect().width,font:getComputedStyle(b).fontSize}))})()`
                )
            })
            await assert(
                `(() => {const section=document.querySelector('[aria-label="${service} connection"]');const bounds=section.getBoundingClientRect();return Array.from(section.querySelectorAll('.settings-section-heading button')).filter(b=>!b.closest('[inert]')).every(b=>{const r=b.getBoundingClientRect();return r.left>=bounds.left-0.5 && r.right<=bounds.right+0.5})})()`
            )
        }
        const captures = []
        const shot = async (name, settle = 350, service = 'github') => {
            await pause(settle)
            writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
            const rectangle = await js(
                `(() => { const r=document.querySelector('[aria-label="${service === 'github' ? 'GitHub' : 'Notion'} connection"]').getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)} })()`
            )
            writeFileSync(join(output, `${name}-detail.png`), (await window.webContents.capturePage(rectangle)).toPNG())
            record({
                geometry: await js(
                    `Object.fromEntries(['.settings-github-controls','.github-signin-track','.github-signin-surface','.github-signin-surface > [role=group]'].map(s=>{const n=document.querySelector(s),r=n.getBoundingClientRect();return [s,{width:r.width,right:r.right,maxWidth:getComputedStyle(n).maxWidth}]}))`
                )
            })
            captures.push({ name, service, image: join(output, `${name}-detail.png`) })
            writeFileSync(join(output, 'captures.json'), JSON.stringify(captures, null, 2))
            record({
                screenshot: `${name}.png`,
                detail: `${name}-detail.png`,
                text: await js('document.body.innerText')
            })
        }
        const openConnections = async () => {
            await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
            await js(`document.querySelector('[aria-label="Open settings"]').click()`)
            await wait(`!!document.querySelector('[role="tab"]')`)
            await js(
                `Array.from(document.querySelectorAll('[role="tab"]')).find(t=>t.textContent==='Connections').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`
            )
            await wait(`!!document.querySelector('[aria-label="GitHub connection"]')`)
        }
        try {
            await wait(`!!window.journal && !!document.querySelector('[aria-label="Open settings"]')`)
            const initial = await js(`window.journal.invoke({type:'state'})`)
            if (
                app.getPath('userData') !== join(directory, 'profile') ||
                initial.connections.github ||
                initial.state.repositories.length
            )
                throw new Error('Doctor rejected isolated profile')
            writeFileSync(
                join(output, 'doctor.json'),
                JSON.stringify({ profile: app.getPath('userData'), url: window.webContents.getURL(), initial }, null, 2)
            )
            window.webContents.debugger.attach('1.3')
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [
                    { name: 'prefers-color-scheme', value: 'dark' },
                    { name: 'prefers-reduced-motion', value: stressMotion ? 'reduce' : 'no-preference' }
                ]
            })
            await openConnections()
            await assert(
                `!document.querySelector('.settings').textContent.includes('OAuth client ID') && !document.querySelector('.settings').textContent.includes('Set up OAuth app')`
            )
            await assert(
                `(() => {const g=document.querySelector('[aria-label="Connect GitHub"]').getBoundingClientRect();const n=document.querySelector('[aria-label="Notion connection"] .settings-section-heading button').getBoundingClientRect();return Math.abs(g.height-n.height)<1 && Math.abs(g.width-n.width)<1})()`
            )
            const headingAlignment = await js(`['GitHub','Notion'].map(name => {
                const heading=document.querySelector('[aria-label="'+name+' connection"] .settings-section-heading');
                const title=heading.querySelector('h3').getBoundingClientRect();
                const button=heading.querySelector('button').getBoundingClientRect();
                return {name,titleCenter:title.top+title.height/2,buttonCenter:button.top+button.height/2};
            })`)
            record({ headingAlignment })
            if (headingAlignment.some(({ titleCenter, buttonCenter }) => Math.abs(titleCenter - buttonCenter) > 1))
                throw new Error('Connection titles and buttons are not vertically centered')
            await js(`window.__fixtureGitHubSurface = document.querySelector('.github-signin-surface'); true`)
            await shot('01-idle', 1000)
            await click('Connect GitHub')
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='starting'`)
            await shot('github-starting', 250)
            await wait(
                `!!document.querySelector('.github-signin-surface [data-face="error"]:not([role="group"]):not([inert])')`
            )
            await shot('02-offline-retry')
            await click('Retry')
            await wait(`document.querySelector('.github-signin-code')?.textContent==='ABCD-EFGH'`)
            await assert(
                `document.querySelector('.github-signin-surface [role="alert"]')?.textContent.includes('Your browser could not be opened')`
            )
            window.show()
            window.focus()
            await pause(250)
            await shot('github-code-browser-failure')
            await click('Open GitHub')
            await shot('github-opening-browser', 200)
            await wait(`!document.querySelector('.github-signin-code-row button:last-child')?.disabled`)
            await click('Copy code')
            await wait(`document.querySelector('[data-copy-state]')?.getAttribute('data-copy-state')==='copied'`)
            for (let i = 0; i < 20 && clipboard.readText() !== 'ABCD-EFGH'; i++) await pause(50)
            record({
                clipboard: { rendererReported: 'copied', osMatchedFixture: clipboard.readText() === 'ABCD-EFGH' }
            })
            await shot('03-code-browser-recovery')
            await js(
                `window.__fixtureClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = () => Promise.reject(new Error('Simulated clipboard unavailable')); true`
            )
            await click('Copy code')
            await wait(`document.querySelector('[data-copy-state]')?.dataset.copyState==='error'`)
            await shot('github-copy-failed')
            await assert(`document.querySelector('.github-signin-code').textContent==='ABCD-EFGH'`)
            await js(`navigator.clipboard.writeText = window.__fixtureClipboardWrite; true`)
            await click('Cancel')
            await wait(`document.activeElement?.getAttribute('aria-label')==='Connect GitHub'`)
            await shot('github-cancelled')
            await click('Connect GitHub')
            await wait(`document.querySelector('.github-signin-surface')?.textContent.includes('Code expired')`)
            await shot('04-expired')
            await click('Retry')
            await wait(
                `document.querySelector('.github-signin-surface')?.textContent.includes('Authorization declined')`
            )
            await shot('github-declined')
            await click('Retry')
            await wait(`!!document.querySelector('.github-signin-code')`)
            await shot('github-code-ready')
            nativeTheme.themeSource = 'dark'
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [
                    { name: 'prefers-color-scheme', value: 'dark' },
                    { name: 'prefers-reduced-motion', value: stressMotion ? 'reduce' : 'no-preference' }
                ]
            })
            window.setMinimumSize(320, 400)
            window.setContentSize(390, 844)
            record({
                viewport: await js(
                    `({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme})`
                ),
                nativeSize: window.getContentSize()
            })
            await shot('05-narrow-dark-code')
            await assert(
                `Math.abs(innerWidth - 390) <= 1 && document.documentElement.scrollWidth <= innerWidth && document.querySelector('.github-signin-surface').getBoundingClientRect().right <= innerWidth`
            )
            nativeTheme.themeSource = 'dark'
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [
                    { name: 'prefers-color-scheme', value: 'dark' },
                    { name: 'prefers-reduced-motion', value: stressMotion ? 'reduce' : 'no-preference' }
                ]
            })
            window.setContentSize(stressMotion ? 390 : 1280, 900)
            await startIdentityTrace('GitHub')
            authorize = true
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='authorizing'`)
            await shot('github-authorizing', 200)
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='success'`)
            await shot('06-success', 250)
            await assert(
                `document.querySelector('.github-signin-track .connection-identity')?.getAttribute('aria-hidden')==='true'`
            )
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await shot('github-handoff-morph', 0)
            await wait(`!!document.querySelector('.settings-github-account')`)
            await assert(`window.__fixtureGitHubSurface === document.querySelector('.github-signin-surface')`)
            await wait(
                `document.querySelector('.github-signin-track .connection-identity')?.dataset.revealed === 'true'`
            )
            await shot('github-identity-enter', 30)
            await shot('07-connected')
            await finishIdentityTrace('GitHub')
            await assertActionsFit('GitHub')
            await js(`location.reload()`)
            await openConnections()
            await wait(
                `document.querySelector('.settings-github-account')?.textContent.includes(${JSON.stringify(githubLogin)})`
            )
            const connected = await js(`window.journal.invoke({type:'state'})`)
            if (!connected.connections.github || connected.state.settings.githubLogin !== githubLogin)
                throw new Error('Account not preserved after reload')
            if (connected.connections.protectedStorage && !existsSync(join(directory, 'profile', 'github.secret')))
                throw new Error('Protected token not persisted')
            writeFileSync(join(output, 'connected-state.json'), JSON.stringify(connected, null, 2))
            // Drive the accessible hold control using real keyboard input.
            await click('Disconnect')
            await wait(`!!document.querySelector('.settings-github-controls button[data-autofocus]')`)
            await shot('github-disconnect-confirm', 700)
            await assert(
                `Array.from(document.querySelectorAll('.settings-github-controls button[data-autofocus],.settings-github-controls button')).filter(b=>['Cancel','Disconnect'].includes(b.textContent.trim())).every(b=>{const r=b.getBoundingClientRect();const s=document.querySelector('[aria-label="GitHub connection"]').getBoundingClientRect();return r.left>=s.left && r.right<=s.right})`
            )
            await pause(600)
            await js(`document.querySelector('.settings-github-controls button[data-autofocus]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await pause(1800)
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='idle'`)
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.github ||
                existsSync(join(directory, 'profile', 'github.secret'))
            )
                throw new Error('Disconnect retained local token')
            await shot('08-disconnected')
            // Reconnect without reloading: a previous disconnect must not own the next connection's result.
            await click('Connect GitHub')
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='success'`)
            await shot('github-reconnect-success', 100)
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await wait(
                `Array.from(document.querySelectorAll('.settings-github-controls button')).some(b=>!b.closest('[inert]') && b.getAttribute('aria-label')==='Disconnect GitHub')`
            )
            await shot('github-reconnected', 700)
            await click('Disconnect GitHub')
            await wait(`document.querySelector('.github-signin-surface [role="group"]')?.dataset.state==='confirming'`)
            await pause(350)
            await js(`document.querySelector('.settings-github-controls button[data-autofocus]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await pause(1800)
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='idle'`)
            await wait(
                `Array.from(document.querySelectorAll('.settings-github-controls button')).some(b=>!b.closest('[inert]') && b.getAttribute('aria-label')==='Connect GitHub')`
            )

            const notionScope = `document.querySelector('[aria-label="Notion connection"]')`
            await assert(`${notionScope}.querySelector('.settings-section-heading button').disabled`)
            await shot('notion-01-disabled', 350, 'notion')
            await js(`${notionScope}.querySelector('input[type="password"]').focus()`)
            window.webContents.insertText('fixture-notion-token')
            await wait(`!${notionScope}.querySelector('.settings-section-heading button').disabled`)
            await shot('notion-02-ready', 350, 'notion')
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="pending"]') !== null`)
            await shot('notion-03-connecting', 250, 'notion')
            await wait(`${notionScope}.querySelector('[data-state="error"]') !== null`)
            await assert(
                `!${notionScope}.textContent.includes('Check your integration token') && !document.querySelector('.settings-feedback').textContent.includes('Fixture invalid token')`
            )
            await shot('notion-04-failed', 350, 'notion')
            await assertActionsFit('Notion')
            notionAllowed = true
            await startIdentityTrace('Notion')
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="pending"]') !== null`)
            await shot('notion-05-retrying', 250, 'notion')
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            await shot('notion-06-success', 250, 'notion')
            await assert(`${notionScope}.querySelector('.connection-identity')?.getAttribute('aria-hidden')==='true'`)
            await wait(
                `Array.from(${notionScope}.querySelectorAll('button')).some(b=>!b.closest('[inert]') && b.textContent.trim()==='Disconnect')`
            )
            await shot('notion-handoff-morph', 0, 'notion')
            await wait(`${notionScope}.textContent.includes('Weekly journal')`)
            await wait(`${notionScope}.querySelector('.connection-identity')?.dataset.revealed === 'true'`)
            await shot('notion-identity-enter', 30, 'notion')
            await shot('notion-07-connected', 350, 'notion')
            await finishIdentityTrace('Notion')
            await assertActionsFit('Notion')
            await js(`location.reload()`)
            await openConnections()
            await wait(`${notionScope}.textContent.includes('Weekly journal')`)
            if (!(await js(`window.journal.invoke({type:'state'})`)).connections.notion)
                throw new Error('Notion connection did not survive reload')
            if (!existsSync(join(directory, 'profile', 'notion.secret'))) throw new Error('Notion token not persisted')
            await click('Disconnect', notionScope)
            await wait(`${notionScope}.querySelector('button[data-autofocus]') !== null`)
            await shot('notion-08-disconnect-confirm', 350, 'notion')
            await js(`${notionScope}.querySelector('button[data-autofocus]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await pause(1800)
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            await wait(`${notionScope}.querySelector('input[type="password"]') !== null`)
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                existsSync(join(directory, 'profile', 'notion.secret'))
            )
                throw new Error('Notion disconnect retained its token')
            await shot('notion-09-disconnected', 350, 'notion')
            await wait(
                `${notionScope}.querySelector('.settings-section-heading [role="group"]')?.dataset.state==='idle'`
            )
            await js(`${notionScope}.querySelector('input[type="password"]').focus()`)
            window.webContents.insertText('fixture-notion-token')
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            await shot('notion-reconnect-success', 100, 'notion')
            await wait(
                `Array.from(${notionScope}.querySelectorAll('.settings-section-heading button')).some(b=>!b.closest('[inert]') && b.textContent.trim()==='Disconnect')`
            )
            await shot('notion-reconnected', 700, 'notion')
            await click('Disconnect', notionScope)
            await wait(
                `${notionScope}.querySelector('.settings-section-heading [role="group"]')?.dataset.state==='confirming'`
            )
            await pause(350)
            await js(`${notionScope}.querySelector('button[data-autofocus]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await pause(1800)
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            await wait(`${notionScope}.querySelector('input[type="password"]') !== null`)
            await wait(
                `${notionScope}.querySelector('.settings-section-heading [role="group"]')?.dataset.state==='idle'`
            )
            await assert(`${notionScope}.querySelector('.settings-section-heading button').disabled`)
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                existsSync(join(directory, 'profile', 'notion.secret')) ||
                existsSync(join(directory, 'profile', 'github.secret'))
            )
                throw new Error('Repeated disconnect retained credentials')
            await shot('notion-repeat-disconnected', 350, 'notion')

            for (const request of requests.filter(({ body }) => body)) {
                if (
                    request.method !== 'POST' ||
                    request.body.client_id !== 'Ov23li9PFMAWRrbZQ6Xy' ||
                    'client_secret' in request.body
                )
                    throw new Error('OAuth request did not use the shared public registration')
            }
            writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify({
                    passed: true,
                    simulated: ['GitHub and Notion HTTP', 'delayed avatars', 'browser launch', 'clipboard failure'],
                    motionVariant: stressMotion ? 'narrow-reduced-long-names' : 'desktop-normal',
                    protectedStorage: connected.connections.protectedStorage
                })
            )
            app.exit(0)
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: false, error: String(error) }))
            await shot('failure')
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
