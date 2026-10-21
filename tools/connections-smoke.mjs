import { app, shell, clipboard, nativeTheme } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Real renderer, preload, IPC, vault and store. Only GitHub HTTP and browser launch are simulated.
const directory = process.env.WEEKLY_J_VERIFY_STATE
const output = process.env.WEEKLY_J_VERIFY_OUTPUT
if (!directory || !output) throw new Error('Use pnpm verify connections for managed isolation and cleanup')
app.setPath('userData', join(directory, 'profile'))
nativeTheme.themeSource = 'light'
mkdirSync(output, { recursive: true })
const record = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
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
        if (url === 'https://api.github.com/user') return json({ login: 'weekly-j-fixture' })
        if (url === 'https://api.github.com/user/emails') return json([{ email: 'fixture@example.com' }])
        if (url === 'https://api.notion.com/v1/users/me') {
            await pause(1000)
            return notionAllowed
                ? json({ name: 'Weekly journal', avatar_url: null })
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
                `Array.from(${scope}.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(text)} || b.textContent.trim()===${JSON.stringify(text)}).click()`
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
                    `Object.fromEntries(['.settings-github-controls','.github-signin-track','.github-signin-surface','.github-signin-content'].map(s=>{const n=document.querySelector(s),r=n.getBoundingClientRect();return [s,{width:r.width,right:r.right,maxWidth:getComputedStyle(n).maxWidth}]}))`
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
                features: [{ name: 'prefers-color-scheme', value: 'light' }]
            })
            await openConnections()
            await assert(
                `!document.querySelector('.settings').textContent.includes('OAuth client ID') && !document.querySelector('.settings').textContent.includes('Set up OAuth app')`
            )
            await js(`window.__fixtureGitHubSurface = document.querySelector('.github-signin-surface'); true`)
            await shot('01-idle')
            await click('Connect GitHub')
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='starting'`)
            await shot('github-starting', 250)
            await wait(`!!document.querySelector('.github-signin-error')`)
            await shot('02-offline-retry')
            await click('Try sign-in again')
            await wait(`document.querySelector('.github-signin-code')?.textContent==='ABCD-EFGH'`)
            await assert(
                `document.querySelector('.github-signin-surface').textContent.includes('Your browser could not be opened')`
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
            await click('Cancel sign-in')
            await wait(`document.activeElement?.getAttribute('aria-label')==='Connect GitHub'`)
            await shot('github-cancelled')
            await click('Connect GitHub')
            await wait(`document.querySelector('.github-signin-surface')?.textContent.includes('Code expired')`)
            await shot('04-expired')
            await click('Try sign-in again')
            await wait(
                `document.querySelector('.github-signin-error')?.textContent.includes('Authorization was declined')`
            )
            await shot('github-declined')
            await click('Try sign-in again')
            await wait(`!!document.querySelector('.github-signin-code')`)
            await shot('github-code-ready')
            nativeTheme.themeSource = 'dark'
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-color-scheme', value: 'dark' }]
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
            nativeTheme.themeSource = 'light'
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-color-scheme', value: 'light' }]
            })
            window.setContentSize(1280, 900)
            authorize = true
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='authorizing'`)
            await shot('github-authorizing', 200)
            await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='success'`)
            await shot('06-success', 250)
            await wait(`!!document.querySelector('.settings-github-account')`)
            await assert(`window.__fixtureGitHubSurface === document.querySelector('.github-signin-surface')`)
            await shot('07-connected')
            await js(`location.reload()`)
            await openConnections()
            await wait(`document.querySelector('.settings-github-account')?.textContent.includes('weekly-j-fixture')`)
            const connected = await js(`window.journal.invoke({type:'state'})`)
            if (!connected.connections.github || connected.state.settings.githubLogin !== 'weekly-j-fixture')
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
                `${notionScope}.textContent.includes('Check your integration token') && !document.querySelector('.settings-feedback').textContent.includes('Fixture invalid token')`
            )
            await shot('notion-04-failed', 350, 'notion')
            notionAllowed = true
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="pending"]') !== null`)
            await shot('notion-05-retrying', 250, 'notion')
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            await shot('notion-06-success', 250, 'notion')
            await wait(`${notionScope}.textContent.includes('Weekly journal')`)
            await shot('notion-07-connected', 350, 'notion')
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
                    simulated: ['GitHub and Notion HTTP', 'browser launch', 'clipboard failure'],
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
