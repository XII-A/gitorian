import { app, shell, clipboard, nativeTheme, ipcMain } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import https from 'node:https'
import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
const { createOAuthHandler } = await tsImport('../services/notion-oauth/src/handler.ts', import.meta.url)
const nativeFetch = globalThis.fetch

// Real renderer, preload, IPC, vault, profile cache and store. Provider HTTP, avatar transport and explicit failures are fixtures.
const directory = process.env.WEEKLY_J_VERIFY_STATE
const output = process.env.WEEKLY_J_VERIFY_OUTPUT
if (!directory || !output) throw new Error('Use pnpm verify connections for managed isolation and cleanup')
app.setPath('userData', join(directory, 'profile'))
nativeTheme.themeSource = 'dark'
mkdirSync(output, { recursive: true })
for (const file of [
    'src/main/connection-profiles.ts',
    'src/renderer/useConnectionProfile.ts',
    'src/renderer/NotionPagePicker.tsx',
    'src/renderer/notion-page-tree.ts',
    'tests/notion-page-tree.test.ts',
    'tests/connection-profiles.test.ts'
])
    writeFileSync(join(output, file.split('/').at(-1)), readFileSync(resolve(file)))
writeFileSync(join(output, 'github-mark.svg'), readFileSync(resolve('src/renderer/assets/github-mark.svg')))
writeFileSync(join(output, 'ConnectionIdentity.tsx'), readFileSync(resolve('src/renderer/ConnectionIdentity.tsx')))
writeFileSync(
    join(output, 'useDisconnectTransition.ts'),
    readFileSync(resolve('src/renderer/useDisconnectTransition.ts'))
)
const record = (event) =>
    appendFileSync(join(output, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n')
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const notionOnly = process.env.WEEKLY_J_VERIFY_SERVICE === 'notion'
const stressMotion = process.env.WEEKLY_J_VERIFY_MOTION === 'stress'
const githubLogin = stressMotion ? 'weekly-j-fixture-with-a-long-github-name' : 'weekly-j-fixture'
let notionName = stressMotion ? 'Weekly journal with an exceptionally long integration name' : 'Weekly journal'
let attempt = 0
let authorize = false
let notionAllowed = false
let notionAuthorization
let notionStarts = 0
let notionPagesCreated = 0
let notionCreatedTitle = 'Weekly Journal'
let failPageSearch = true
let failPageSelection = true
const oauthOrigin = 'https://oauth.fixture.test'
process.env.WEEKLY_J_NOTION_OAUTH_ORIGIN = oauthOrigin
const oauth = createOAuthHandler(
    {
        origin: oauthOrigin,
        clientId: 'fixture-notion-app',
        clientSecret: 'fixture-server-only-secret',
        stateSecret: 'fixture-state-secret-that-is-at-least-32-characters'
    },
    (input, init) => globalThis.fetch(input, init)
)
async function approveNotion(error) {
    if (!notionAuthorization) throw new Error('Missing Notion browser authorization')
    const started = await oauth(new Request(notionAuthorization))
    const state = new URL(started.headers.get('Location')).searchParams.get('state')
    const callback = await oauth(
        new Request(
            `${oauthOrigin}/callback?state=${encodeURIComponent(state)}&${error ? 'error=access_denied' : 'code=fixture-code'}`
        )
    )
    const response = await nativeFetch(callback.headers.get('Location'))
    if (!response.ok) throw new Error('Notion loopback callback failed')
}
const requests = []
let failDisconnect = ''
const registerHandler = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    registerHandler(channel, async (event, command) => {
        if (channel === 'journal:command' && command.type === 'disconnect' && command.service === failDisconnect) {
            failDisconnect = ''
            await pause(300)
            throw new Error('Fixture disconnect unavailable')
        }
        return listener(event, command)
    })
globalThis.fetch = (input, init) =>
    Promise.resolve().then(async () => {
        const url = input instanceof Request ? input.url : input.toString()
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        requests.push({ url, method: init?.method ?? 'GET', body })
        if (offline) throw new Error('Fixture provider offline')
        if (url.startsWith(oauthOrigin)) {
            if (url.endsWith('/health')) {
                notionStarts++
                await pause(700)
                if (notionStarts === 1) throw new Error('Simulated OAuth module offline')
            }
            return oauth(new Request(input, init))
        }
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
        if (url === 'https://api.notion.com/v1/oauth/token') {
            return json({
                access_token:
                    notionName === 'Second integration' ? 'fixture-other-notion-token' : 'fixture-notion-token',
                refresh_token: 'fixture-refresh-token',
                workspace_id: 'fixture-workspace'
            })
        }
        if (url === 'https://api.notion.com/v1/search') {
            if (failPageSearch) {
                failPageSearch = false
                throw new Error('Fixture search unavailable')
            }
            const page = (id, title, parent) => ({
                id,
                url: `https://www.notion.so/${id}`,
                icon: { type: 'emoji', emoji: '📓' },
                parent: parent ? { page_id: parent } : { workspace: true },
                properties: { title: { title: [{ plain_text: title }] } }
            })
            if (!body.start_cursor)
                return json({
                    results: [page('fixture-parent', 'Personal')],
                    has_more: true,
                    next_cursor: 'second-page'
                })
            return json({
                results: [
                    page(
                        'fixture-existing',
                        stressMotion ? 'Journal with an exceptionally long name 日本語 📚' : 'Engineering notes',
                        'fixture-parent'
                    ),
                    page('fixture-leaf', 'Decisions', 'fixture-existing'),
                    page('fixture-orphan', 'Shared notes', 'not-shared'),
                    page('fixture-twin', 'Engineering notes', 'fixture-parent'),
                    ...(notionPagesCreated ? [page('fixture-private-journal', notionCreatedTitle)] : [])
                ],
                has_more: false,
                next_cursor: null
            })
        }
        if (url === 'https://api.notion.com/v1/pages' && init?.method === 'POST') {
            notionPagesCreated++
            notionCreatedTitle = body.properties.title.title[0].text.content
            await pause(1200)
            return json({ id: 'fixture-private-journal', url: 'https://www.notion.so/fixture-private-journal' })
        }
        if (url === 'https://api.notion.com/v1/pages/fixture-existing') {
            if (failPageSelection) {
                failPageSelection = false
                return new Response('{}', { status: 404 })
            }
            return json({ id: 'fixture-existing' })
        }
        if (url === 'https://api.notion.com/v1/pages/fixture-private-journal')
            return json({ id: 'fixture-private-journal' })
        if (url === 'https://api.notion.com/v1/users/me') {
            await pause(1000)
            return notionAllowed
                ? json({ name: notionName, avatar_url: 'https://github.com/weekly-j-fixture/notion-avatar.png' })
                : new Response(JSON.stringify({ message: 'Fixture invalid token' }), { status: 401 })
        }
        throw new Error(`Unexpected external request: ${url}`)
    })
shell.openExternal = (url) =>
    Promise.resolve().then(async () => {
        await pause(700)
        record({ browser: url, simulated: true })
        if (url.startsWith(oauthOrigin)) {
            notionAuthorization = url
            if (!notionAllowed) throw new Error('Simulated Notion browser unavailable')
            return
        }
        if (attempt === 2) throw new Error('Simulated missing browser')
    })

const avatarRequests = []
let offline = false
const originalLookup = dns.lookup.bind(dns)
dns.lookup = (hostname, options) =>
    hostname === 'github.com' ? Promise.resolve([{ address: '8.8.8.8', family: 4 }]) : originalLookup(hostname, options)
const originalRequest = https.request.bind(https)
https.request = (target, options, receive) => {
    const url = target.toString()
    if (!url.startsWith('https://github.com/')) return originalRequest(target, options, receive)
    avatarRequests.push(url)
    const pending = new EventEmitter()
    pending.end = () => {
        void (async () => {
            await pause(1600)
            if (offline) {
                pending.emit('error', new Error('Fixture avatar offline'))
                return
            }
            const response = new PassThrough()
            response.statusCode = 200
            response.headers = { 'content-type': 'image/svg+xml' }
            receive(response)
            response.end(
                '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#344d45"/></svg>'
            )
        })()
    }
    return pending
}
syncBuiltinESMExports()
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
                `document.querySelector('[aria-label="${service} connection"] .connection-identity img')?.complete && document.querySelector('[aria-label="${service} connection"] .connection-identity img')?.naturalWidth>0`
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
        const cancelDisconnect = async (service) => {
            const scope = `document.querySelector('[aria-label="${service} connection"]')`
            await click('Disconnect', scope)
            await wait(`${scope}.querySelector('[data-state="confirming"]') !== null`)
            await pause(350)
            await click('Cancel', scope)
            await wait(`${scope}.querySelector('.settings-section-heading [role="group"]')?.dataset.state==='idle'`)
            await assert(
                `window.journal.invoke({type:'state'}).then(reply=>reply.connections.${service.toLowerCase()})`
            )
        }
        const holdDisconnect = async (service, cycle) => {
            const scope = `document.querySelector('[aria-label="${service} connection"]')`
            if (cycle === 'first') failDisconnect = service.toLowerCase()
            await js(`(() => {
                const started=performance.now(),frames=[];
                window.__disconnectTrace={frames};
                const sample=()=>{
                    const root=document.querySelector('[aria-label="${service} connection"] .settings-section-heading [role="group"]');
                    const done=root?.querySelector('[data-face="done"]:not([role="group"]):not([inert])');
                    frames.push({time:performance.now()-started,state:root?.dataset.state,label:done?.textContent});
                    window.__disconnectTrace.frame=requestAnimationFrame(sample);
                };sample();
            })()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await wait(
                `${scope}.querySelector('.settings-section-heading [role="group"]')?.dataset.state !== 'confirming'`
            )
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            if (cycle === 'first') {
                await wait(`${scope}.querySelector('[data-state="error"]') !== null`)
                await assert(
                    `window.journal.invoke({type:'state'}).then(reply=>reply.connections.${service.toLowerCase()})`
                )
                await shot(`${service.toLowerCase()}-disconnect-retry`, 0, service.toLowerCase())
                await click('Retry', scope)
            }
            await wait(`${scope}.querySelector('.settings-section-heading [role="group"]')?.dataset.state==='done'`)
            await assert(
                `window.journal.invoke({type:'state'}).then(reply=>!reply.connections.${service.toLowerCase()})`
            )
            await shot(`${service.toLowerCase()}-disconnect-result-${cycle}`, 0, service.toLowerCase())
            await wait(
                `document.querySelector('[aria-label="${service} connection"] .settings-section-heading [role="group"]')?.dataset.state==='idle'`
            )
            await pause(50)
            const frames = await js(
                `(() => {cancelAnimationFrame(window.__disconnectTrace.frame);return window.__disconnectTrace.frames})()`
            )
            const done = frames.filter((frame) => frame.state === 'done' && frame.label === 'Disconnected')
            if (frames.some((frame) => frame.state === 'done' && frame.label && frame.label !== 'Disconnected'))
                throw new Error(`${service} displayed the wrong operation result`)
            const duration = done.length ? done.at(-1).time - done[0].time : 0
            writeFileSync(
                join(output, `${service.toLowerCase()}-disconnect-${cycle}.json`),
                JSON.stringify({ frames, duration }, null, 2)
            )
            if (duration < 700 || duration > 1800)
                throw new Error(
                    `${service} Disconnected confirmation lasted ${duration.toFixed(1)}ms; expected a readable result before Connect`
                )
        }
        const warmReload = async (service) => {
            const before = {
                api: requests.length,
                avatars: avatarRequests.length,
                profiles: requests.filter((r) => r.url === 'https://api.notion.com/v1/users/me').length
            }
            offline = true
            const started = Date.now()
            await js(`window.__warmReloadMarker=true; true`)
            const loaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
            window.webContents.reload()
            await loaded
            await wait(`!window.__warmReloadMarker && !!document.querySelector('[aria-label="Open settings"]')`)
            await openConnections()
            await wait(
                service === 'Notion'
                    ? `document.querySelector('[aria-label="Notion connection"] .notion-destination-identity')?.textContent.includes('Team journal')`
                    : `document.querySelector('[aria-label="${service} connection"] .connection-identity img')?.naturalWidth>0`
            )
            const elapsed = Date.now() - started
            await pause(150)
            const after = {
                api: requests.length,
                avatars: avatarRequests.length,
                profiles: requests.filter((r) => r.url === 'https://api.notion.com/v1/users/me').length
            }
            record({ warmCache: { service, elapsed, before, after } })
            writeFileSync(
                join(output, `${service.toLowerCase()}-warm-cache.json`),
                JSON.stringify({ elapsed, before, after }, null, 2)
            )
            if (elapsed > 1200 || JSON.stringify(before) !== JSON.stringify(after))
                throw new Error(`${service} warm profile waited for the network`)
            if (service !== 'Notion')
                await assert(
                    `document.querySelector('[aria-label="${service} connection"] img').src.startsWith('data:image/webp;base64,')`
                )
            await shot(`${service.toLowerCase()}-cached-offline`, 350, service.toLowerCase())
            offline = false
        }
        const captures = []
        const shot = async (name, settle = 350, service = notionOnly ? 'notion' : 'github') => {
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
            if (!notionOnly) {
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
                const shotHeadings = async (name) => {
                    const rectangle = await js(
                        `(() => {const github=document.querySelector('[aria-label="GitHub connection"] .settings-section-heading').getBoundingClientRect();const notion=document.querySelector('[aria-label="Notion connection"] .settings-section-heading').getBoundingClientRect();return {x:Math.floor(github.x),y:Math.floor(github.y),width:Math.ceil(github.width),height:Math.ceil(notion.bottom-github.y)}})()`
                    )
                    writeFileSync(
                        join(output, `${name}.png`),
                        (await window.webContents.capturePage(rectangle)).toPNG()
                    )
                }
                await shotHeadings('connection-logos-dark')
                nativeTheme.themeSource = 'light'
                await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                    features: [
                        { name: 'prefers-color-scheme', value: 'light' },
                        { name: 'prefers-reduced-motion', value: stressMotion ? 'reduce' : 'no-preference' }
                    ]
                })
                await wait(`document.documentElement.dataset.theme==='light'`)
                await pause(300)
                await shotHeadings('connection-logos-light')
                nativeTheme.themeSource = 'dark'
                await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
                    features: [
                        { name: 'prefers-color-scheme', value: 'dark' },
                        { name: 'prefers-reduced-motion', value: stressMotion ? 'reduce' : 'no-preference' }
                    ]
                })
                await wait(`document.documentElement.dataset.theme==='dark'`)

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
                await warmReload('GitHub')
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
                await cancelDisconnect('GitHub')
                await click('Disconnect')
                await wait(`!!document.querySelector('.settings-github-controls button[data-autofocus]')`)
                await shot('github-disconnect-confirm', 700)
                await assert(
                    `Array.from(document.querySelectorAll('.settings-github-controls button[data-autofocus],.settings-github-controls button')).filter(b=>['Cancel','Disconnect'].includes(b.textContent.trim())).every(b=>{const r=b.getBoundingClientRect();const s=document.querySelector('[aria-label="GitHub connection"]').getBoundingClientRect();return r.left>=s.left && r.right<=s.right})`
                )
                await pause(600)
                await js(`document.querySelector('.settings-github-controls button[data-autofocus]').focus()`)
                await holdDisconnect('GitHub', 'first')
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
                await wait(
                    `document.querySelector('.github-signin-surface [role="group"]')?.dataset.state==='confirming'`
                )
                await pause(350)
                await js(`document.querySelector('.settings-github-controls button[data-autofocus]').focus()`)
                await holdDisconnect('GitHub', 'repeat')
                await wait(`document.querySelector('.github-signin-surface')?.dataset.phase==='idle'`)
                await wait(
                    `Array.from(document.querySelectorAll('.settings-github-controls button')).some(b=>!b.closest('[inert]') && b.getAttribute('aria-label')==='Connect GitHub')`
                )
            }
            window.setMinimumSize(320, 400)
            window.setContentSize(stressMotion ? 390 : 1280, 900)
            await wait(`Math.abs(innerWidth - ${stressMotion ? 390 : 1280}) <= 1`)
            record({
                notionViewport: await js(
                    `({width:innerWidth,height:innerHeight,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`
                ),
                nativeSize: window.getContentSize()
            })
            const notionScope = `document.querySelector('[aria-label="Notion connection"]')`
            await assert(
                `!${notionScope}.querySelector('.settings-section-heading button').disabled && !${notionScope}.querySelector('input[type="password"]')`
            )
            await shot('notion-01-ready', 350, 'notion')
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="pending"]') !== null`)
            await shot('notion-03-connecting', 250, 'notion')
            await wait(`${notionScope}.querySelector('[data-state="error"]') !== null`)
            await shot('notion-04-failed', 350, 'notion')
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await shot('notion-browser-recovery', 350, 'notion')
            await assertActionsFit('Notion')
            await click('Cancel', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='idle'`)
            notionAllowed = true
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await approveNotion(true)
            await wait(`${notionScope}.textContent.includes('Authorization declined')`)
            await shot('notion-authorization-declined', 350, 'notion')
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await shot('notion-05-retrying', 250, 'notion')
            await click('Open Notion', notionScope)
            await approveNotion()
            await wait(`${notionScope}.textContent.includes('Could not load pages')`)
            await shot('notion-pages-load-error', 250, 'notion')
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[role="combobox"]') !== null`)
            await assert(
                `!Array.from(${notionScope}.querySelectorAll('label')).some(l=>['Destination','Page ID'].includes(l.textContent))`
            )
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                notionPagesCreated ||
                existsSync(join(directory, 'profile', 'notion.secret'))
            )
                throw new Error('Authorization completed or created a page before confirmation')
            const choosePage = async (id, keyboard = false) => {
                const wasConnected = (await js(`window.journal.invoke({type:'state'})`)).connections.notion
                await js(
                    `(() => {const input=${notionScope}.querySelector('[role="combobox"]'); input.focus(); input.click()})()`
                )
                if (id === 'new') {
                    await wait(
                        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Create a new page')`
                    )
                    await click('Create a new page')
                } else {
                    await wait(`!!document.querySelector('[role="treeitem"][title="Personal"]')`)
                    const collapsed = await js(`!!document.querySelector('button[aria-label="Expand Personal"]')`)
                    if (collapsed) await click('Expand Personal')
                    if (id === 'fixture-existing') {
                        await wait(
                            `Array.from(document.querySelectorAll('[role="treeitem"]')).some(n=>n.title===${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name 日本語 📚' : 'Engineering notes')})`
                        )
                        if (keyboard) {
                            await js(`document.querySelector('[role="treeitem"][title="Personal"]').focus()`)
                            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
                            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
                            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
                            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
                        } else
                            await js(
                                `Array.from(document.querySelectorAll('[role="treeitem"]')).find(n=>n.title===${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name 日本語 📚' : 'Engineering notes')}).click()`
                            )
                    } else await js(`document.querySelector('[role="treeitem"][title="Team journal"]').click()`)
                }
                await pause(100)
                if ((await js(`window.journal.invoke({type:'state'})`)).connections.notion !== wasConnected)
                    throw new Error('Selection changed connection state before Confirm')
            }
            await shot('notion-page-picker', 350, 'notion')
            await assertActionsFit('Notion')
            await assert(
                `(() => {const field=${notionScope}.querySelector('.notion-page-field').getBoundingClientRect(); const surface=${notionScope}.querySelector('[data-state="confirming"] > div').getBoundingClientRect(); return Math.abs(field.left-surface.left-4)<1 && Math.abs(surface.height-field.height-8)<1})()`
            )
            await js(`${notionScope}.querySelector('[role="combobox"]').click()`)
            await wait(`!!document.querySelector('button[aria-label="Expand Personal"]')`)
            await click('Expand Personal')
            await assert(`${notionScope}.querySelector('[role="combobox"]').value===''`)
            await assert(`!document.querySelector('[role="treeitem"][title="Decisions"]')`)
            await shot('notion-page-tree', 250, 'notion')
            if (!stressMotion) {
                await js(
                    `document.documentElement.dataset.theme='light'; document.documentElement.dataset.accent='blue'; true`
                )
                await shot('notion-page-tree-light-blue', 250, 'notion')
                await js(
                    `document.documentElement.dataset.theme='dark'; document.documentElement.dataset.accent='neutral'; true`
                )
            }
            await js(`document.querySelector('[role="treeitem"][title="Personal"]').click()`)
            await wait(`${notionScope}.querySelector('[role="combobox"]').value==='Personal'`)
            if ((await js(`window.journal.invoke({type:'state'})`)).connections.notion)
                throw new Error('Parent selection implicitly confirmed')
            await js(`${notionScope}.querySelector('[role="combobox"]').click()`)
            await window.webContents.insertText('Decisions')
            await wait(`!!document.querySelector('[role="treeitem"][title="Decisions"]')`)
            await assert(`!!document.querySelector('[role="treeitem"][title="Personal"]')`)
            await shot('notion-page-tree-search', 250, 'notion')
            await js(`${notionScope}.querySelector('[role="combobox"]').select()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
            await wait(`${notionScope}.querySelector('[role="combobox"]').value===''`)
            await assert(
                `!!document.querySelector('button[aria-label="Expand Personal"]') && !document.querySelector('[role="treeitem"][title="Decisions"]')`
            )
            await window.webContents.insertText('No matching title')
            await wait(
                `Array.from(document.querySelectorAll('[role="status"]')).some(n=>n.textContent==='No matching pages')`
            )
            await shot('notion-page-tree-empty', 150, 'notion')
            await js(`${notionScope}.querySelector('[role="combobox"]').select()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
            await wait(`${notionScope}.querySelector('[role="combobox"]').value===''`)
            await assert(
                `!Array.from(document.querySelectorAll('[role="treeitem"]')).some(n=>n.textContent.includes('fixture-') || n.title.includes('fixture-'))`
            )
            await choosePage('new')
            await assert(
                `(() => {const button=${notionScope}.querySelector('.notion-picker-action'); const bounds=button.getBoundingClientRect(); const surface=${notionScope}.querySelector('[data-state="confirming"] > div').getBoundingClientRect(); return Math.abs(bounds.width-bounds.height)<1 && Math.abs(bounds.top-surface.top-4)<1 && getComputedStyle(button).borderRadius==='9999px'})()`
            )
            await shot('notion-create-before-confirm', 200, 'notion')
            await click('Close dialog')
            await wait(`!document.querySelector('[aria-label="Notion connection"]')`)
            await openConnections()
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='idle'`)
            if (
                notionPagesCreated ||
                existsSync(join(directory, 'profile', 'notion.secret')) ||
                existsSync(join(directory, 'profile', 'notion-setup.secret'))
            )
                throw new Error('Closing unconfirmed setup left credentials or a page')
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await approveNotion()
            await wait(`${notionScope}.querySelector('[role="combobox"]') !== null`)
            await choosePage('fixture-existing', true)
            await shot('notion-existing-selected', 200, 'notion')
            await click('Confirm', notionScope)
            await wait(`${notionScope}.textContent.includes('Could not save page')`)
            if (notionPagesCreated) throw new Error('Inaccessible selection created an unwanted page')
            await shot('notion-page-confirm-error', 200, 'notion')

            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            await shot('notion-06-success', 250, 'notion')
            await assert(`${notionScope}.querySelector('.connection-identity')?.getAttribute('aria-hidden')==='true'`)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await wait(`${notionScope}.querySelector('.connection-identity')?.dataset.revealed==='true'`)
            await shot('notion-07-connected', 350, 'notion')
            await assert(
                `${notionScope}.querySelector('.notion-destination-identity').textContent.includes(${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name 日本語 📚' : 'Engineering notes')}) && !${notionScope}.textContent.includes('Open journal') && !${notionScope}.textContent.includes('Weekly journal')`
            )
            await assert(
                `(() => {const identity=${notionScope}.querySelector('.notion-destination-identity').getBoundingClientRect(); const button=${notionScope}.querySelector('[aria-label="Disconnect Notion"]').getBoundingClientRect();return Math.abs(identity.top+identity.height/2-button.top-button.height/2)<1})()`
            )

            await assertActionsFit('Notion')
            if (
                notionPagesCreated ||
                (await js(`window.journal.invoke({type:'state'})`)).state.settings.destination?.id !==
                    'fixture-existing'
            )
                throw new Error('Existing selection did not save without creating a page')
            await click('Change journal page', notionScope)
            await wait(`${notionScope}.querySelector('[role="combobox"]') !== null`)
            await wait(
                `Array.from(document.querySelectorAll('[role="treeitem"][aria-selected="true"]')).some(n=>n.title===${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name 日本語 📚' : 'Engineering notes')})`
            )
            await shot('notion-edit-selected', 200, 'notion')
            await click('Cancel', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await click('Change journal page', notionScope)
            await wait(`${notionScope}.querySelector('[role="combobox"]') !== null`)
            await choosePage('new')
            await js(`${notionScope}.querySelector('input').select()`)
            await window.webContents.insertText('Team journal')
            await click('Confirm', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="pending"]') !== null`)
            await click('Close dialog')
            await wait(`!document.querySelector('[aria-label="Notion connection"]')`)
            await pause(1500)
            await openConnections()
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await shot('notion-created-after-dialog-close', 250, 'notion')
            const notionConnected = await js(`window.journal.invoke({type:'state'})`)
            if (
                notionConnected.state.settings.destination?.id !== 'fixture-private-journal' ||
                notionConnected.state.settings.destination?.title !== 'Team journal' ||
                notionCreatedTitle !== 'Team journal' ||
                notionPagesCreated !== 1
            )
                throw new Error('Private journal was not prepared exactly once')
            writeFileSync(
                join(output, 'notion-provisioned.json'),
                JSON.stringify({ destination: notionConnected.state.settings.destination, created: notionPagesCreated })
            )
            await warmReload('Notion')
            if (!(await js(`window.journal.invoke({type:'state'})`)).connections.notion)
                throw new Error('Notion connection did not survive reload')
            if (!existsSync(join(directory, 'profile', 'notion.secret')))
                throw new Error('Notion credentials not persisted')
            await cancelDisconnect('Notion')
            await click('Disconnect', notionScope)
            await wait(`${notionScope}.querySelector('button[data-autofocus]') !== null`)
            await shot('notion-08-disconnect-confirm', 350, 'notion')
            await js(`${notionScope}.querySelector('button[data-autofocus]').focus()`)
            await holdDisconnect('Notion', 'first')
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                existsSync(join(directory, 'profile', 'notion.secret'))
            )
                throw new Error('Notion disconnect retained credentials')
            await shot('notion-09-disconnected', 350, 'notion')
            notionName = 'Second integration'
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await approveNotion()
            await wait(`${notionScope}.querySelector('[role="combobox"]') !== null`)
            await choosePage('fixture-private-journal')
            await click('Confirm', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            await shot('notion-reconnect-success', 100, 'notion')
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await wait(`${notionScope}.textContent.includes('Team journal')`)
            await assert(`!${notionScope}.textContent.includes('Second integration')`)
            if (notionPagesCreated !== 1) throw new Error('Reconnect duplicated the journal destination')
            await shot('notion-reconnected', 700, 'notion')
            await click('Disconnect', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="confirming"]') !== null`)
            await pause(350)
            await js(`${notionScope}.querySelector('button[data-autofocus]').focus()`)
            await holdDisconnect('Notion', 'repeat')
            await assert(`!${notionScope}.querySelector('.settings-section-heading button').disabled`)
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                existsSync(join(directory, 'profile', 'notion.secret')) ||
                existsSync(join(directory, 'profile', 'github.secret'))
            )
                throw new Error('Repeated disconnect retained credentials')
            await shot('notion-repeat-disconnected', 350, 'notion')

            const cachedProfiles = JSON.parse(
                readFileSync(join(directory, 'profile', 'connection-profiles.json'), 'utf8')
            )
            if (Object.keys(cachedProfiles).length) throw new Error('Disconnect retained cached profile images')
            writeFileSync(join(output, 'profile-cache-after-disconnect.json'), JSON.stringify(cachedProfiles))
            for (const request of requests.filter(
                ({ url, body }) => body && url.startsWith('https://github.com/login/')
            )) {
                if (
                    request.method !== 'POST' ||
                    request.body.client_id !== 'Ov23li9PFMAWRrbZQ6Xy' ||
                    'client_secret' in request.body
                )
                    throw new Error('OAuth request did not use the shared public registration')
            }
            writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
            if (
                notionOnly &&
                requests.some(
                    ({ url }) => url.startsWith('https://api.github.com') || url.startsWith('https://github.com/login/')
                )
            )
                throw new Error('Notion-only journey exercised GitHub')
            writeFileSync(join(output, 'avatar-requests.json'), JSON.stringify(avatarRequests, null, 2))
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify({
                    passed: true,
                    simulated: notionOnly
                        ? ['Notion HTTP', 'browser launch', 'disconnect IPC failure']
                        : [
                              notionOnly ? 'Notion HTTP' : 'GitHub and Notion HTTP',
                              'avatar DNS and HTTPS transport',
                              'delayed avatars',
                              'browser launch',
                              'clipboard failure',
                              'disconnect IPC failures'
                          ],
                    motionVariant: stressMotion ? 'narrow-reduced-long-names' : 'desktop-normal',
                    protectedStorage: initial.connections.protectedStorage
                })
            )
            app.exit(0)
        } catch (error) {
            console.error(error)
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: false, error: String(error) }))
            try {
                await shot('failure')
            } catch (captureFailure) {
                record({ captureFailure: String(captureFailure) })
            }
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
