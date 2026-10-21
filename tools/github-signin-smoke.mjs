import { app, shell, clipboard, nativeTheme } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Real renderer, preload, IPC, vault and store. Only GitHub HTTP and browser launch are simulated.
const directory = process.env.WEEKLY_J_VERIFY_STATE
const output = process.env.WEEKLY_J_VERIFY_OUTPUT
if (!directory || !output) throw new Error('Use pnpm verify github-signin for managed isolation and cleanup')
app.setPath('userData', join(directory, 'profile'))
nativeTheme.themeSource = 'light'
mkdirSync(output, { recursive: true })
const record = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let attempt = 0
let authorize = false
const requests = []
globalThis.fetch = (input, init) =>
    Promise.resolve().then(() => {
        const url = input instanceof Request ? input.url : input.toString()
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        requests.push({ url, method: init?.method ?? 'GET', body })
        const json = (data) => new Response(JSON.stringify(data))
        if (url === 'https://github.com/login/device/code') {
            attempt++
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
                    : authorize
                      ? { access_token: 'fixture-only-token' }
                      : { error: 'authorization_pending' }
            )
        if (url === 'https://api.github.com/user') return json({ login: 'weekly-j-fixture' })
        if (url === 'https://api.github.com/user/emails') return json([{ email: 'fixture@example.com' }])
        throw new Error(`Unexpected external request: ${url}`)
    })
shell.openExternal = (url) =>
    Promise.resolve().then(() => {
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
        const click = async (text) => {
            await js(
                `Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(text)} || b.textContent.trim()===${JSON.stringify(text)}).click()`
            )
        }
        const shot = async (name) => {
            await pause(500)
            writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
            record({ screenshot: `${name}.png`, text: await js('document.body.innerText') })
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
            await shot('01-idle')
            await click('Sign in with GitHub')
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
            await click('Copy code')
            await wait(`document.querySelector('[data-copy-state]')?.getAttribute('data-copy-state')==='copied'`)
            for (let i = 0; i < 20 && clipboard.readText() !== 'ABCD-EFGH'; i++) await pause(50)
            record({
                clipboard: { rendererReported: 'copied', osMatchedFixture: clipboard.readText() === 'ABCD-EFGH' }
            })
            await shot('03-code-browser-recovery')
            await click('Cancel sign-in')
            await wait(`document.activeElement?.textContent.trim()==='Sign in with GitHub'`)
            await click('Sign in with GitHub')
            await wait(`document.querySelector('.github-signin-surface')?.textContent.includes('Code expired')`)
            await shot('04-expired')
            await click('Try sign-in again')
            await wait(`!!document.querySelector('.github-signin-code')`)
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
            await wait(
                `document.querySelector('.github-signin-result')?.textContent.includes('Connected as weekly-j-fixture')`
            )
            await shot('06-success')
            await wait(`!!document.querySelector('.settings-github-account')`)
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
            await wait(`!!document.querySelector('.settings-github-account button[data-autofocus]')`)
            await pause(600)
            await js(`document.querySelector('.settings-github-account button[data-autofocus]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await pause(1800)
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            await wait(`!!document.querySelector('.github-signin-track')`)
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.github ||
                existsSync(join(directory, 'profile', 'github.secret'))
            )
                throw new Error('Disconnect retained local token')
            await shot('08-disconnected')
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
                    simulated: ['GitHub HTTP', 'browser launch'],
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
