import { onboardingJourney } from './onboarding-journey.mjs'
import { app, shell, clipboard, nativeTheme, ipcMain } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import { resolve, join } from 'node:path'
import https from 'node:https'
import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
const { createOAuthHandler } = await tsImport('../services/notion-oauth/src/handler.ts', import.meta.url)
const { NotionConnection } = await tsImport('../src/main/notion-connection.ts', import.meta.url)
const { NotionSetupStore } = await tsImport('../src/main/notion-setup.ts', import.meta.url)
const { Vault } = await tsImport('../src/main/vault.ts', import.meta.url)
const nativeFetch = globalThis.fetch

// Real renderer, preload, IPC, vault, profile cache and store. Provider HTTP, avatar transport and explicit failures are fixtures.
const directory = process.env.GITORIAN_VERIFY_STATE
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!directory || !output) throw new Error('Use pnpm verify connections for managed isolation and cleanup')
app.setPath('userData', join(directory, 'profile'))
nativeTheme.themeSource = 'dark'
mkdirSync(output, { recursive: true })
for (const file of [
    'src/main/notion-setup.ts',
    'tests/notion-setup.test.ts',
    'src/main/connection-profiles.ts',
    'src/renderer/useConnectionProfile.ts',
    'src/renderer/NotionPagePicker.tsx',
    'src/renderer/NotionDiscoveryStatus.tsx',
    'src/renderer/notion-page-tree.ts',
    'tests/notion-page-tree.test.ts',
    'src/main/notion-discovery.ts',
    'src/main/notion-discovery-cache.ts',
    'tests/notion-discovery.test.ts',
    'tests/notion-discovery-cache.test.ts',
    'src/renderer/components/arc/animated-counter/animated-counter.tsx',
    'src/renderer/components/arc/animated-counter/animated-counter.module.css',
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
const notionOnly = process.env.GITORIAN_VERIFY_SERVICE === 'notion'
const stressMotion = process.env.GITORIAN_VERIFY_MOTION === 'stress'
const narrowViewport = stressMotion || process.env.GITORIAN_VERIFY_VIEWPORT === 'narrow'
const githubLogin = stressMotion ? 'gitorian-fixture-with-a-long-github-name' : 'gitorian-fixture'
let notionName = stressMotion ? 'Weekly journal with an exceptionally long integration name' : 'Weekly journal'
let attempt = 0
let authorize = false
let notionAllowed = false
let notionAuthorization
let notionStarts = 0
let notionPagesCreated = 0
let notionCreatedTitle = 'Weekly Journal'
let refreshedNames = false
let failPageSearch = true
let discoveryRateLimit
let holdDiscovery = false
let releaseDiscovery
let failDiscovery = false
let earlyScanAborted = false
let holdInitialSearch = false
let initialSearchStarted = false
let initialSearchAborted = false
let failTargetSearch = true
let failPageSelection = true
let expireEditSearch = false
let expireEditCreation = false
let notionRotations = 0
let failRecoveryCleanup = false
let recoveryCleanupFailures = 0
let failDestinationSave = ''
let destinationSaveFailures = 0
let failCredentialSave = false
let credentialSaveFailures = 0
const hasNotionCredentials = () =>
    ['notion', 'notion-a', 'notion-b'].some((key) => existsSync(join(directory, 'profile', `${key}.secret`)))
const assertRestartPair = async (id, access) => {
    const db = new DatabaseSync(join(directory, 'profile', 'gitorian.sqlite'), { readOnly: true })
    const row = db.prepare("SELECT json FROM state_parts WHERE key='settings'").get()
    const destination = row ? JSON.parse(row.json).destination : undefined
    db.close()
    const restarted = new NotionConnection(
        new Vault(join(directory, 'profile')),
        oauthOrigin,
        globalThis.fetch,
        new NotionSetupStore(join(directory, 'profile', 'notion-setup.json')),
        destination
    )
    if (destination?.id !== id || restarted.connected() !== !!id || (access && (await restarted.token()) !== access))
        throw new Error('Restart did not select a matching committed destination and credential pair')
    record({
        restartPair: { id: destination?.id, slot: destination?.credentialSlot, connected: restarted.connected() }
    })
}
const sendWrite = Worker.prototype.postMessage
Worker.prototype.postMessage = function (message, ...args) {
    if (
        failDestinationSave &&
        message.batch?.parts.some(
            ([key, value]) => key === 'settings' && JSON.parse(value).destination?.id === failDestinationSave
        )
    ) {
        failDestinationSave = ''
        destinationSaveFailures++
        queueMicrotask(() => this.emit('message', { id: message.id, error: 'Fixture local destination save failed' }))
        return
    }
    if (
        message.batch?.reset &&
        message.batch.parts.some(
            ([key, value]) => key === 'settings' && JSON.parse(value).destination?.id === 'fixture-private-journal'
        )
    ) {
        setTimeout(() => sendWrite.call(this, message, ...args), 700)
        return
    }
    sendWrite.call(this, message, ...args)
}
const renameFile = fs.renameSync
fs.renameSync = (source, destination) => {
    if (failCredentialSave && String(destination).endsWith('notion-b.secret')) {
        failCredentialSave = false
        credentialSaveFailures++
        throw new Error('Fixture credential storage unavailable')
    }
    if (
        failRecoveryCleanup &&
        String(destination).endsWith('notion-setup.json') &&
        readFileSync(source, 'utf8') === '{}'
    ) {
        failRecoveryCleanup = false
        recoveryCleanupFailures++
        throw new Error('Fixture recovery cleanup unavailable')
    }
    renameFile(source, destination)
}
const oauthOrigin = 'https://oauth.fixture.test'
process.env.GITORIAN_NOTION_OAUTH_ORIGIN = oauthOrigin
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
let failNotionChoose = false
const registerHandler = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    registerHandler(channel, async (event, command) => {
        if (channel === 'journal:command' && command.type === 'notionChoose' && failNotionChoose) {
            failNotionChoose = false
            await pause(300)
            throw new Error('Fixture edit unavailable')
        }
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
            if (body.grant_type === 'refresh_token') {
                const expected = notionRotations ? `fixture-refresh-${notionRotations}` : 'fixture-refresh-token'
                if (body.refresh_token !== expected) throw new Error('Rotated refresh credential was overwritten')
                notionRotations++
                return json({
                    access_token: `fixture-rotated-${notionRotations}`,
                    refresh_token: `fixture-refresh-${notionRotations}`,
                    workspace_id: 'fixture-workspace'
                })
            }
            return json({
                access_token:
                    notionName === 'Second integration' ? 'fixture-other-notion-token' : 'fixture-notion-token',
                refresh_token: 'fixture-refresh-token',
                workspace_id: 'fixture-workspace'
            })
        }
        if (url === 'https://api.notion.com/v1/search') {
            if (holdInitialSearch && !body.query && !body.start_cursor) {
                initialSearchStarted = true
                await new Promise((resolve, reject) => {
                    init.signal.addEventListener(
                        'abort',
                        () => {
                            initialSearchAborted = true
                            reject(new Error('Held initial search canceled'))
                        },
                        { once: true }
                    )
                })
            }
            if (body.query) {
                const result = (id, title, parent) =>
                    json({
                        results: [
                            {
                                id,
                                url: `https://www.notion.so/${id}`,
                                parent: parent ? { page_id: parent } : { workspace: true },
                                properties: { Name: { title: [{ plain_text: title }] } }
                            }
                        ],
                        has_more: false
                    })
                if (body.query === 'Old query') {
                    await pause(700)
                    return result('fixture-old-result', 'Old query')
                }
                if (body.query === 'New query') return result('fixture-new-result', 'New query')
                if (body.query === 'Release plan')
                    return result('fixture-remote-result', 'Release plan', 'fixture-parent')
                if (body.query === 'Retry me') {
                    if (failTargetSearch) {
                        failTargetSearch = false
                        return new Response('{}', { status: 500 })
                    }
                    return result('fixture-retry-result', 'Retry me')
                }
                return json({ results: [], has_more: false })
            }

            if (expireEditSearch) {
                expireEditSearch = false
                return new Response('{}', { status: 401 })
            }
            await pause(350)
            if (failPageSearch) {
                failPageSearch = false
                throw new Error('Fixture search unavailable')
            }
            const page = (id, title, parent) => ({
                id,
                url: `https://www.notion.so/${id}`,
                icon: { type: 'emoji', emoji: 'ًں““' },
                parent: typeof parent === 'object' ? parent : parent ? { page_id: parent } : { workspace: true },
                properties: { title: { title: [{ plain_text: title }] } }
            })
            if (!body.start_cursor)
                return json({
                    results: [
                        page('fixture-parent', 'Personal'),
                        ...Array.from({ length: 8 }, (_, index) =>
                            page(`fixture-reference-${index}`, `Reference ${index + 1}`, 'fixture-twin')
                        )
                    ],
                    has_more: true,
                    next_cursor: 'second-page'
                })
            return json({
                results: [
                    page(
                        'fixture-existing',
                        stressMotion ? 'Journal with an exceptionally long name و—¥وœ¬èھ‍ ًں“ڑ' : 'Engineering notes',
                        'fixture-parent'
                    ),
                    page('fixture-board-entry', 'Board entry', { data_source_id: 'fixture-projects' }),
                    page('fixture-archive-entry', 'Archived entry', { data_source_id: 'fixture-archive' }),
                    page('fixture-hidden-ancestor', 'Shared toggle entry', { block_id: 'fixture-hidden-toggle' }),
                    page('fixture-orphan', refreshedNames ? 'Updated shared notes' : 'Shared notes', 'not-shared'),
                    page('fixture-twin', 'Engineering notes', 'fixture-parent'),
                    ...(notionPagesCreated ? [page('fixture-private-journal', notionCreatedTitle)] : [])
                ],
                has_more: false,
                next_cursor: null
            })
        }
        // Decisions is readable immediately but deliberately absent from search's index.
        if (url === 'https://api.notion.com/v1/blocks/fixture-parent/children?page_size=100') {
            if (holdDiscovery) {
                await new Promise((resolve, reject) => {
                    const abort = () => {
                        earlyScanAborted = true
                        reject(
                            init.signal.reason instanceof Error
                                ? init.signal.reason
                                : new Error('Fixture scan cancelled')
                        )
                    }
                    init.signal.addEventListener('abort', abort, { once: true })
                    releaseDiscovery = () => {
                        init.signal.removeEventListener('abort', abort)
                        resolve()
                    }
                })
            }
            if (failDiscovery) return new Response('{}', { status: 500 })
            return json({ results: [], has_more: false })
        }
        if (url === 'https://api.notion.com/v1/blocks/fixture-existing/children?page_size=100')
            return json({
                results: [{ id: 'fixture-outer-toggle', type: 'toggle', has_children: true }],
                has_more: false
            })
        if (url === 'https://api.notion.com/v1/blocks/fixture-outer-toggle/children?page_size=100')
            return json({
                results: [{ id: 'fixture-inner-toggle', type: 'toggle', has_children: true }],
                has_more: false
            })
        if (url === 'https://api.notion.com/v1/blocks/fixture-inner-toggle/children?page_size=100') {
            const searches = requests.filter((request) => request.url === 'https://api.notion.com/v1/search').length
            if (!discoveryRateLimit) {
                discoveryRateLimit = { retryAt: Date.now() + 1000, searches, recovered: false }
                record({ fixture: 'Rate-limit nested discovery after completed search and parent reads' })
                return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
            }
            if (!discoveryRateLimit.recovered) {
                if (Date.now() < discoveryRateLimit.retryAt || searches !== discoveryRateLimit.searches)
                    throw new Error('Rate-limited discovery retried too early or restarted completed search')
                discoveryRateLimit.recovered = true
                record({ assertion: 'Discovery respects Retry-After and resumes the failed child read', passed: true })
            }
            return json({ results: [{ id: 'fixture-leaf', type: 'child_page' }], has_more: false })
        }
        if (url === 'https://api.notion.com/v1/pages/fixture-parent')
            return json({
                id: 'fixture-parent',
                parent: { workspace: true },
                properties: { Name: { title: [{ plain_text: 'Personal' }] } }
            })
        if (url === 'https://api.notion.com/v1/pages/not-shared') return new Response('{}', { status: 404 })
        if (url === 'https://api.notion.com/v1/pages/12345678-1234-1234-1234-123456789abc')
            return json({
                id: '12345678-1234-1234-1234-123456789abc',
                parent: { page_id: 'fixture-parent' },
                properties: { Name: { title: [{ plain_text: 'Direct link notes' }] } }
            })
        if (url === 'https://api.notion.com/v1/pages/fixture-leaf')
            return json({
                id: 'fixture-leaf',
                url: 'https://www.notion.so/fixture-leaf',
                parent: { block_id: 'fixture-inner-toggle' },
                properties: { title: { title: [{ plain_text: 'Decisions' }] } }
            })
        if (/^https:\/\/api.notion.com\/v1\/blocks\/[^/]+\/children\?/.test(url))
            return json({ results: [], has_more: false })
        if (url === 'https://api.notion.com/v1/blocks/fixture-inner-toggle') {
            await pause(1200)
            return json({ parent: { block_id: 'fixture-outer-toggle' } })
        }
        if (url === 'https://api.notion.com/v1/blocks/fixture-outer-toggle')
            return json({ parent: { page_id: 'fixture-existing' } })
        if (url === 'https://api.notion.com/v1/blocks/fixture-database-toggle')
            return json({ parent: { page_id: 'fixture-parent' } })
        if (url === 'https://api.notion.com/v1/blocks/fixture-hidden-toggle') return new Response('{}', { status: 404 })
        if (
            url === 'https://api.notion.com/v1/data_sources/fixture-projects/query' ||
            url === 'https://api.notion.com/v1/data_sources/fixture-archive/query'
        ) {
            const project = url.includes('fixture-projects')
            return json({
                results: [
                    {
                        id: project ? 'fixture-board-entry' : 'fixture-archive-entry',
                        parent: { data_source_id: project ? 'fixture-projects' : 'fixture-archive' },
                        properties: { Name: { title: [{ plain_text: project ? 'Board entry' : 'Archived entry' }] } }
                    }
                ],
                has_more: false
            })
        }
        if (url === 'https://api.notion.com/v1/data_sources/fixture-projects')
            return json({
                id: 'fixture-projects',
                title: [{ plain_text: 'Projects' }],
                parent: { database_id: 'fixture-database' }
            })
        if (url === 'https://api.notion.com/v1/data_sources/fixture-archive')
            return json({
                id: 'fixture-archive',
                title: [{ plain_text: 'Archive' }],
                parent: { database_id: 'fixture-database' }
            })
        if (url === 'https://api.notion.com/v1/databases/fixture-database')
            return json({
                id: 'fixture-database',
                title: [{ plain_text: 'Work database' }],
                parent: { block_id: 'fixture-database-toggle' }
            })
        if (url === 'https://api.notion.com/v1/pages' && init?.method === 'POST') {
            if (expireEditCreation) {
                expireEditCreation = false
                return new Response('{}', { status: 401 })
            }
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
                ? json({ name: notionName, avatar_url: 'https://github.com/gitorian-fixture/notion-avatar.png' })
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
                    `(() => {const section=document.querySelector('[aria-label="${service} connection"]');return Array.from(section.querySelectorAll('.settings-section-heading,.settings-github-account,[role="group"],button')).filter(b=>!b.closest('[inert],[hidden]')).map(b=>({tag:b.tagName,text:b.textContent,class:b.className,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right,width:b.getBoundingClientRect().width,font:getComputedStyle(b).fontSize}))})()`
                )
            })
            await assert(
                `(() => {const section=document.querySelector('[aria-label="${service} connection"]');const bounds=section.getBoundingClientRect();return Array.from(section.querySelectorAll('.settings-section-heading button')).filter(b=>!b.closest('[inert],[hidden]')).every(b=>{const r=b.getBoundingClientRect();return r.left>=bounds.left-0.5 && r.right<=bounds.right+0.5})})()`
            )
        }
        const cancelDisconnect = async (service) => {
            const scope = `document.querySelector('[aria-label="${service} connection"]')`
            const disconnectSelector =
                service === 'Notion'
                    ? '[data-notion-disconnect] [role="group"]'
                    : '.settings-section-heading [role="group"]'
            await click('Disconnect', scope)
            await wait(`${scope}.querySelector('[data-state="confirming"]') !== null`)
            await pause(350)
            await click('Cancel', scope)
            await wait(`${scope}.querySelector('${disconnectSelector}')?.dataset.state==='idle'`)
            await assert(
                `window.journal.invoke({type:'state'}).then(reply=>reply.connections.${service.toLowerCase()})`
            )
        }
        const holdDisconnect = async (service, cycle) => {
            const scope = `document.querySelector('[aria-label="${service} connection"]')`
            const disconnectSelector =
                service === 'Notion'
                    ? '[data-notion-disconnect] [role="group"]'
                    : '.settings-section-heading [role="group"]'
            if (cycle === 'first') failDisconnect = service.toLowerCase()
            await js(`(() => {
                const started=performance.now(),frames=[];
                window.__disconnectTrace={frames};
                const sample=()=>{
                    const root=document.querySelector('[aria-label="${service} connection"] ${disconnectSelector}');
                    const done=root?.querySelector('[data-face="done"]:not([role="group"]):not([inert])');
                    frames.push({time:performance.now()-started,state:root?.dataset.state,label:done?.textContent});
                    window.__disconnectTrace.frame=requestAnimationFrame(sample);
                };sample();
            })()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            await wait(`${scope}.querySelector('${disconnectSelector}')?.dataset.state !== 'confirming'`)
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            if (cycle === 'first') {
                await wait(`${scope}.querySelector('[data-state="error"]') !== null`)
                await assert(
                    `window.journal.invoke({type:'state'}).then(reply=>reply.connections.${service.toLowerCase()})`
                )
                await shot(`${service.toLowerCase()}-disconnect-retry`, 0, service.toLowerCase())
                await click('Retry', scope)
            }
            await wait(`${scope}.querySelector('${disconnectSelector}')?.dataset.state==='done'`)
            await assert(
                `window.journal.invoke({type:'state'}).then(reply=>!reply.connections.${service.toLowerCase()})`
            )
            await shot(`${service.toLowerCase()}-disconnect-result-${cycle}`, 0, service.toLowerCase())
            await wait(
                `document.querySelector('[aria-label="${service} connection"] ${disconnectSelector}')?.dataset.state==='idle'`
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
        const capture = async (rectangle) => {
            for (let attempt = 0; ; attempt++) {
                try {
                    return await window.webContents.capturePage(rectangle)
                } catch (error) {
                    if (!String(error).includes('UnknownVizError') || attempt >= 2) throw error
                    record({ captureRetry: 'UnknownVizError', attempt: attempt + 1 })
                    await pause(150)
                }
            }
        }
        const shot = async (name, settle = 350, service = notionOnly ? 'notion' : 'github') => {
            await pause(settle)
            writeFileSync(join(output, `${name}.png`), (await capture()).toPNG())
            const rectangle = await js(
                `(() => { const r=document.querySelector('[aria-label="${service === 'github' ? 'GitHub' : 'Notion'} connection"]').getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)} })()`
            )
            writeFileSync(join(output, `${name}-detail.png`), (await capture(rectangle)).toPNG())
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
            if (process.env.GITORIAN_VERIFY_ONBOARDING === '1') {
                attempt = 4
                authorize = true
                notionAllowed = true
                notionStarts = 1
                failPageSearch = false
                failPageSelection = false
                await onboardingJourney({ window, directory, output, js, wait, assert, click, approveNotion, record })
                writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
                app.exit(0)
                return
            }
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
                await js(`document.documentElement.dataset.theme='light'; true`)
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
                await js(`document.documentElement.dataset.theme='dark'; true`)
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
                window.setContentSize(narrowViewport ? 390 : 1280, 900)
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
                const disconnectBounds = await js(`(() => {
                    const section=document.querySelector('[aria-label="GitHub connection"]');
                    const group=section.querySelector('[role="group"][data-state="confirming"]');
                    const surface=group.firstElementChild;
                    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
                    return {section:rect(section),surface:rect(surface),buttons:Array.from(group.querySelectorAll('button')).filter(b=>!b.closest('[inert],[hidden]') && (b.matches('[data-autofocus]') || b.textContent.trim()==='Cancel')).map(b=>({label:b.matches('[data-autofocus]')?'Disconnect':'Cancel',...rect(b)}))};
                })()`)
                record({ disconnectBounds })
                if (
                    disconnectBounds.buttons.length !== 2 ||
                    new Set(disconnectBounds.buttons.map((b) => b.label)).size !== 2 ||
                    disconnectBounds.buttons.some(
                        (button) =>
                            button.width <= 0 ||
                            button.height <= 0 ||
                            [disconnectBounds.section, disconnectBounds.surface].some(
                                (bounds) =>
                                    button.left < bounds.left - 0.5 ||
                                    button.right > Number(bounds.right) + 0.5 ||
                                    button.top < bounds.top - 0.5 ||
                                    button.bottom > Number(bounds.bottom) + 0.5
                            )
                    )
                )
                    throw new Error(`GitHub confirmation actions overflow: ${JSON.stringify(disconnectBounds)}`)
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
            window.setContentSize(narrowViewport ? 390 : 1280, 900)
            await wait(`Math.abs(innerWidth - ${narrowViewport ? 390 : 1280}) <= 1`)
            record({
                notionViewport: await js(
                    `({width:innerWidth,height:innerHeight,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})`
                ),
                nativeSize: window.getContentSize()
            })
            const notionScope = `document.querySelector('[aria-label="Notion connection"]')`
            const changeJournalPage = () =>
                js(`${notionScope}.querySelector('[aria-label^="Change journal page:"]').click()`)
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
            await assert(
                `!${notionScope}.querySelector('[data-copy-state]') && !${notionScope}.textContent.includes('Copy the connection link')`
            )
            await assert(`document.activeElement?.getAttribute('aria-label') === 'Open Notion'`)
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
            failPageSearch = false
            holdInitialSearch = true
            await approveNotion()
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
            await wait(`!!document.querySelector('[aria-label="Notion pages"]')`)
            const typePageQuery = async (text) => {
                await js(
                    `(()=>{const input=${notionScope}.querySelector('[role="combobox"]:not([inert] *)');window.__sameNotionPicker??=input;input.focus();input.click();input.select()})()`
                )
                if (text) window.webContents.insertText(text)
                else {
                    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
                    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
                }
                await wait(
                    `${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value===${JSON.stringify(text)}`
                )
            }
            await wait(`!!document.querySelector('.notion-picker-status')`)
            await assert(
                `document.querySelector('.notion-picker-status [aria-label="Loading pages"]') && !document.querySelector('.notion-picker-status .notion-spinner') && !document.querySelector('.notion-picker-status').innerText.trim()`
            )
            if (!initialSearchStarted) throw new Error('Initial search fixture was not held')
            const loadingLayouts = []
            for (const width of [320, 390, 768, 1024, 1440]) {
                window.setContentSize(width, 900)
                await pause(400)
                const layout = await js(
                    `(() => {const skeleton=document.querySelector('.notion-picker-status');const r=skeleton.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,overflow:document.documentElement.scrollWidth>innerWidth}})()`
                )
                if (layout.left < 0 || layout.right > Number(layout.width) + 1 || layout.overflow)
                    throw new Error(`Loading rows overflow: ${JSON.stringify(layout)}`)
                loadingLayouts.push(layout)
                await assertActionsFit('Notion')
                if (width === 320) await shot('notion-loading-320', 100, 'notion')
            }
            window.setContentSize(1280, 900)
            window.webContents.setZoomFactor(2)
            await pause(400)
            await assertActionsFit('Notion')
            await shot('notion-loading-zoom', 100, 'notion')
            window.webContents.setZoomFactor(1)
            window.setContentSize(narrowViewport ? 390 : 1280, 900)
            await js(
                `document.documentElement.dataset.theme='light';document.documentElement.dataset.accent='blue';true`
            )
            await shot('notion-loading-light-blue', 150, 'notion')
            await js(
                `document.documentElement.dataset.theme='dark';document.documentElement.dataset.accent='neutral';true`
            )
            writeFileSync(join(output, 'notion-loading-layouts.json'), JSON.stringify(loadingLayouts, null, 2))
            await shot('notion-immediate-search', 150, 'notion')
            await typePageQuery('Release plan')
            await wait(`!!document.querySelector('[role="treeitem"][title="Release plan"]')`)
            if (!initialSearchAborted) throw new Error('Typing a title did not cancel the held initial read')
            await assert(`window.__sameNotionPicker===${notionScope}.querySelector('[role="combobox"]:not([inert] *)')`)
            record({
                assertion: 'One picker accepts immediate title search while initial loading is blocked',
                passed: true
            })
            await shot('notion-remote-title-result', 150, 'notion')
            await typePageQuery('Old query')
            await wait(`!!document.querySelector('.notion-picker-status [aria-label="Loading pages"]')`)
            await shot('notion-search-loading', 100, 'notion')
            await pause(350)
            await typePageQuery('New query')
            await wait(`!!document.querySelector('[role="treeitem"][title="New query"]')`)
            await pause(800)
            await assert(
                `!document.querySelector('[role="treeitem"][title="Old query"]') && ${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value==='New query'`
            )
            await typePageQuery('Retry me')
            await wait(`document.body.innerText.includes('Could not load pages')`)
            await shot('notion-pages-load-error', 100, 'notion')
            await click('Retry search')
            await wait(`!!document.querySelector('[role="treeitem"][title="Retry me"]')`)
            await typePageQuery('Decisions')
            await wait(`document.body.innerText.includes('Try a page link')`)
            await typePageQuery('https://www.notion.so/Notes-12345678123412341234123456789abc')
            await wait(`!!document.querySelector('[role="treeitem"][title="Direct link notes"]')`)
            await shot('notion-page-link-result', 100, 'notion')
            holdInitialSearch = false
            await typePageQuery('')
            await wait(
                `!!document.querySelector('[role="treeitem"][title="Personal"]') && !document.querySelector('.notion-picker-status')`
            )
            const contentReads = requests.filter((r) => /\/blocks\/[^/]+\/children/.test(r.url)).length
            if (contentReads !== 0) throw new Error('Initial discovery or title search crawled page contents')
            holdDiscovery = true
            failDiscovery = true
            await click('Expand Personal')
            await wait(`!!document.querySelector('[role="treeitem"][title="Personal"] [role="status"]')`)
            await assert(
                `document.querySelector('[role="treeitem"][title="Personal"] .notion-spinner') && document.querySelector('[data-loading-branch="fixture-parent"]') && document.querySelector('[role="treeitem"][title="Personal"] .settings-sr-only').textContent==='Loading pages'`
            )
            await assert(`!document.querySelector('[data-loading-branch="fixture-parent"] [tabindex]')`)
            const loadingContrast = []
            for (const theme of ['dark', 'light']) {
                await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};true`)
                await pause(300)
                const ratios = await js(`(() => {
                    const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});ctx.canvas.width=ctx.canvas.height=1;
                    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
                    const over=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255));
                    const luminance=rgb=>rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
                    return ['[role="treeitem"][title="Personal"] .notion-spinner','[role="treeitem"][title="Personal"]'].map(selector=>{
                        const node=document.querySelector(selector);const layers=[];for(let n=node;n;n=n.parentElement)layers.push(rgba(getComputedStyle(n).backgroundColor));
                        const bg=layers.reverse().reduce((base,layer)=>over(layer,base),[255,255,255]);const fg=over(rgba(getComputedStyle(node).color),bg);
                        const a=luminance(fg),b=luminance(bg);return {selector,foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
                    });
                })()`)
                if (ratios[0].ratio < 3 || ratios[1].ratio < 4.5)
                    throw new Error(`Loading contrast failed: ${JSON.stringify({ theme, ratios })}`)
                loadingContrast.push({ theme, ratios })
            }
            await js(`document.documentElement.dataset.theme='dark';true`)
            writeFileSync(join(output, 'notion-loading-contrast.json'), JSON.stringify(loadingContrast, null, 2))
            await assert(
                `(getComputedStyle(document.querySelector('[data-loading-branch="fixture-parent"] [data-shimmer]'),'::after').animationName==='none')===${stressMotion}`
            )
            await assert(
                `(getComputedStyle(document.querySelector('[role="treeitem"][title="Personal"] .notion-spinner')).animationName==='none')===${stressMotion}`
            )
            await assert(
                `(() => {const rows=[...document.querySelectorAll('[aria-label="Notion pages"] [role="treeitem"]')];const index=rows.findIndex(n=>n.title==='Personal');let last=rows[index];for(let i=index+1;i<rows.length && Number(rows[i].getAttribute('aria-level'))>1;i++)last=rows[i];return document.querySelector('[data-loading-branch="fixture-parent"]').getBoundingClientRect().top>=last.getBoundingClientRect().bottom-1})()`
            )
            await shot('notion-picker-during-scan', 150, 'notion')
            await js(
                `document.querySelector('[data-loading-branch="fixture-parent"]').scrollIntoView({block:'nearest'})`
            )
            await shot('notion-branch-skeleton-end', 100, 'notion')
            await js(`document.querySelector('[role="treeitem"][title="Personal"]').scrollIntoView({block:'nearest'})`)
            holdDiscovery = false
            releaseDiscovery()
            await wait(`!!document.querySelector('[aria-label="Retry loading Personal"]')`)
            await assert(`!document.querySelector('[data-loading-branch="fixture-parent"]')`)
            await shot('notion-background-scan-error', 100, 'notion')
            failDiscovery = false
            await click('Retry loading Personal')
            await wait(
                `!document.querySelector('[role="treeitem"][title="Personal"] [role="status"]') && !document.querySelector('[aria-label="Retry loading Personal"]')`
            )
            const expandedReads = requests.filter(
                (r) => r.url === 'https://api.notion.com/v1/blocks/fixture-parent/children?page_size=100'
            ).length
            await click('Collapse Personal')
            await click('Expand Personal')
            await pause(300)
            if (
                requests.filter(
                    (r) => r.url === 'https://api.notion.com/v1/blocks/fixture-parent/children?page_size=100'
                ).length !== expandedReads
            )
                throw new Error('Re-expanding a loaded branch fetched it again')
            const engineering = stressMotion
                ? 'Journal with an exceptionally long name و—¥وœ¬èھ‍ ًں“ڑ'
                : 'Engineering notes'
            await click(`Expand ${engineering}`)
            await wait(
                `Array.from(document.querySelectorAll('[role="treeitem"]')).find(node=>node.title===${JSON.stringify(engineering)})?.querySelector('[role="status"]')?.textContent==='Waiting for Notion'`
            )
            await shot('notion-waiting-with-picker', 100, 'notion')
            await wait(`!!document.querySelector('[role="treeitem"][title="Decisions"]')`)
            await assert(
                `window.__sameNotionPicker===${notionScope}.querySelector('[role="combobox"]:not([inert] *)') && !${notionScope}.querySelector('.notion-discovery-note')`
            )
            record({
                assertion:
                    'Nested pages appear on first connection by expanding only their branch, with in-picker retry and rate-limit recovery',
                passed: true
            })
            await shot('notion-grouping-count', 50, 'notion')
            await shot('notion-counter-settled', 50, 'notion')
            const cachePath = join(directory, 'profile', 'notion-pages.json')
            const cachedPages = JSON.parse(readFileSync(cachePath, 'utf8'))
            if (
                !cachedPages.pages.some((page) => page.id === 'fixture-leaf') ||
                /fixture-notion-token|access_token|refresh_token/.test(readFileSync(cachePath, 'utf8'))
            )
                throw new Error('Scoped discovery cache lost completed branch metadata or retained credentials')
            writeFileSync(join(output, 'notion-cache-initial.json'), JSON.stringify(cachedPages, null, 2))
            if (!discoveryRateLimit?.recovered) throw new Error('Expanded branch did not recover from rate limit')
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                notionPagesCreated ||
                hasNotionCredentials()
            )
                throw new Error('Browsing or searching confirmed authorization')
            const choosePage = async (id, keyboard = false) => {
                const wasConnected = (await js(`window.journal.invoke({type:'state'})`)).connections.notion
                await js(
                    `(() => {const input=${notionScope}.querySelector('[role="combobox"]:not([inert] *)'); input.focus(); input.click()})()`
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
                            `Array.from(document.querySelectorAll('[role="treeitem"]')).some(n=>n.title===${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name و—¥وœ¬èھ‍ ًں“ڑ' : 'Engineering notes')})`
                        )
                        if (keyboard) {
                            await js(`document.querySelector('[role="treeitem"][title="Personal"]').focus()`)
                            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
                            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
                            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
                            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
                        } else
                            await js(
                                `Array.from(document.querySelectorAll('[role="treeitem"]')).find(n=>n.title===${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name و—¥وœ¬èھ‍ ًں“ڑ' : 'Engineering notes')}).click()`
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
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
            await wait(`!!document.querySelector('[role="treeitem"][title="Personal"]')`)
            if (await js(`!!document.querySelector('button[aria-label="Expand Personal"]')`))
                await click('Expand Personal')
            if (await js(`!!document.querySelector('button[aria-label=${JSON.stringify(`Collapse ${engineering}`)}]')`))
                await click(`Collapse ${engineering}`)
            await assert(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value===''`)
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
            await assert(
                `document.querySelector('[role="treeitem"][title="Shared toggle entry"]').getAttribute('aria-level')==='1'`
            )
            await assert(
                `document.querySelector('[role="treeitem"][title="Projects"]').getAttribute('aria-level')==='2' && !document.querySelector('[role="treeitem"][title="Projects"]').hasAttribute('aria-selected')`
            )
            await js(`document.querySelector('[role="treeitem"][title="Projects"]').click()`)
            await wait(`!!document.querySelector('[role="treeitem"][title="Board entry"]')`)
            await assert(
                `${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value==='' && document.querySelector('[role="treeitem"][title="Board entry"]').getAttribute('aria-level')==='3'`
            )
            await assert(
                `(async () => {try {await window.journal.invoke({type:'notionConfirm',selection:{kind:'existing',pageId:'fixture-projects'}});return false} catch {return !(await window.journal.invoke({type:'state'})).connections.notion}})()`
            )
            await shot('notion-database-groups', 200, 'notion')
            await js(`document.querySelector('[role="treeitem"][title="Projects"]').focus()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
            await wait(`!document.querySelector('[role="treeitem"][title="Board entry"]')`)
            await assert(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value===''`)
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').focus()`)
            await window.webContents.insertText('Board entry')
            await wait(`!!document.querySelector('[role="treeitem"][title="Board entry"]')`)
            await assert(
                `document.querySelector('[role="treeitem"][title="Projects"]').getAttribute('aria-expanded')==='true' && !!document.querySelector('[role="treeitem"][title="Personal"]')`
            )
            await shot('notion-database-search', 150, 'notion')
            await js(`document.querySelector('[role="treeitem"][title="Board entry"]').click()`)
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value==='Board entry'`)
            await assert(`(async () => !(await window.journal.invoke({type:'state'})).connections.notion)()`)
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
            await wait(`!!document.querySelector('[role="treeitem"][title="Personal"]')`)
            await js(`document.querySelector('[role="treeitem"][title="Personal"]').click()`)
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value==='Personal'`)
            if ((await js(`window.journal.invoke({type:'state'})`)).connections.notion)
                throw new Error('Parent selection implicitly confirmed')
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
            await window.webContents.insertText('Decisions')
            await wait(`!!document.querySelector('[role="treeitem"][title="Decisions"]')`)
            await assert(`!!document.querySelector('[role="treeitem"][title="Personal"]')`)
            await assert(
                `document.querySelector('[role="treeitem"][title="Decisions"]').getAttribute('aria-level')==='3'`
            )
            await shot('notion-page-tree-search', 250, 'notion')
            await js(`document.querySelector('button[aria-label="Collapse Personal"]').click()`)
            await wait(`!document.querySelector('[role="treeitem"][title="Decisions"]')`)
            await js(`document.querySelector('button[aria-label="Expand Personal"]').click()`)
            await wait(`!!document.querySelector('[role="treeitem"][title="Decisions"]')`)
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').select()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value===''`)
            await assert(
                `!!document.querySelector('button[aria-label="Expand Personal"]') && !document.querySelector('[role="treeitem"][title="Decisions"]')`
            )
            await window.webContents.insertText('No matching title')
            await wait(
                `Array.from(document.querySelectorAll('[role="status"]')).some(n=>n.textContent.startsWith('No matching pages.'))`
            )
            await shot('notion-page-tree-empty', 150, 'notion')
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').select()`)
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').value===''`)
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
                hasNotionCredentials() ||
                existsSync(join(directory, 'profile', 'notion-setup.secret'))
            )
                throw new Error('Closing unconfirmed setup left credentials or a page')
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await approveNotion()
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
            await choosePage('fixture-existing', true)
            await shot('notion-existing-selected', 200, 'notion')
            await click('Confirm', notionScope)
            await wait(`${notionScope}.textContent.includes('Could not save page')`)
            if (notionPagesCreated) throw new Error('Inaccessible selection created an unwanted page')
            await shot('notion-page-confirm-error', 200, 'notion')

            failRecoveryCleanup = true
            failDestinationSave = 'fixture-existing'
            await click('Retry', notionScope)
            await wait(`${notionScope}.textContent.includes('Could not save page')`)
            await shot('notion-existing-save-retry', 200, 'notion')
            await assertRestartPair(undefined)
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            await shot('notion-06-success', 250, 'notion')
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await wait(
                `(() => {const section=${notionScope};return section.querySelector('[aria-label="Disconnect Notion"]').getBoundingClientRect().right <= section.getBoundingClientRect().right + .5})()`
            )
            await shot('notion-07-connected', 350, 'notion')
            if (recoveryCleanupFailures !== 1) throw new Error('Recovery cleanup failure was not exercised')
            await assert(
                `${notionScope}.querySelector('.notion-destination-identity').textContent.includes(${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name و—¥وœ¬èھ‍ ًں“ڑ' : 'Engineering notes')}) && !${notionScope}.textContent.includes('Open journal') && !${notionScope}.textContent.includes('Weekly journal')`
            )
            await assert(
                `(() => {const identity=${notionScope}.querySelector('[aria-label^="Change journal page:"]').getBoundingClientRect(); const button=${notionScope}.querySelector('[aria-label="Disconnect Notion"]').getBoundingClientRect();return Math.abs(identity.top+identity.height/2-button.top-button.height/2)<1 && Math.abs(identity.height-button.height)<1})()`
            )

            await assertActionsFit('Notion')
            if (
                notionPagesCreated ||
                (await js(`window.journal.invoke({type:'state'})`)).state.settings.destination?.id !==
                    'fixture-existing'
            )
                throw new Error('Existing selection did not save without creating a page')
            if (!narrowViewport) {
                window.webContents.sendInputEvent({ type: 'mouseMove', x: 30, y: 300 })
                // Inspect the resting state independently of the retained keyboard-focus fill.
                await js(`${notionScope}.querySelector('[aria-label^="Change journal page:"]').blur()`)
                await pause(200)
                record({
                    selectorStyle: await js(`(() => {
                    const button=${notionScope}.querySelector('[aria-label^="Change journal page:"]');
                    const surface=button.closest('[role="group"]').firstElementChild;
                    const border=getComputedStyle(surface,'::after');
                    return {surface:getComputedStyle(surface).backgroundColor,button:getComputedStyle(button).backgroundColor,hover:button.matches(':hover'),borderStyle:border.borderTopStyle,borderWidth:border.borderTopWidth,borderColor:border.borderTopColor};
                })()`)
                })
                await assert(`(() => {
                    const button=${notionScope}.querySelector('[aria-label^="Change journal page:"]');
                    const surface=button.closest('[role="group"]').firstElementChild;
                    const border=getComputedStyle(surface,'::after');
                    return getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)' &&
                        getComputedStyle(button).backgroundColor==='rgba(0, 0, 0, 0)' &&
                        border.borderTopStyle==='solid' && parseFloat(border.borderTopWidth)>0 &&
                        border.borderTopColor!=='rgba(0, 0, 0, 0)';
                })()`)
                await shot('notion-selector-transparent', 0, 'notion')
                const hoverPoint = await js(
                    `(() => {const r=${notionScope}.querySelector('[aria-label^="Change journal page:"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
                )
                window.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint })
                await pause(250)
                await assert(
                    `getComputedStyle(${notionScope}.querySelector('[aria-label^="Change journal page:"]')).backgroundColor!=='rgba(0, 0, 0, 0)'`
                )
                await shot('notion-selector-hover', 0, 'notion')
                window.webContents.sendInputEvent({ type: 'mouseMove', x: 30, y: 300 })
                const originalSize = window.getContentSize()
                for (const width of [768, 1024, 1440]) {
                    window.setContentSize(width, originalSize[1])
                    await pause(400)
                    await assertActionsFit('Notion')
                    await shot(`notion-selector-${width}`, 0, 'notion')
                }
                window.setContentSize(...originalSize)
                await pause(400)
                await js(
                    `document.documentElement.dataset.theme='light';document.documentElement.dataset.accent='blue';true`
                )
                await shot('notion-selector-light-blue', 300, 'notion')
                await js(
                    `document.documentElement.dataset.theme='dark';document.documentElement.dataset.accent='neutral';true`
                )
            }
            const warmEditStarted = performance.now()
            const searchesBeforeEdit = requests.filter(
                (request) => request.url === 'https://api.notion.com/v1/search'
            ).length
            await js(`(() => {
                window.__notionEditNode=${notionScope}.querySelector('.notion-page-connection [role="group"]');
                window.__notionEditFrames=[];
                let start;
                window.__notionEditRunning=true;
                window.__notionEditPhase='opening';
                const sample=frameTime=>{
                    start ??= frameTime;
                    // Read after all animation callbacks have written this presentation frame.
                    setTimeout(()=>{
                        if(!window.__notionEditRunning)return;
                        const rect=window.__notionEditNode.getBoundingClientRect();
                        const slot=${notionScope}.querySelector('[data-notion-disconnect]').getBoundingClientRect();
                        window.__notionEditFrames.push({time:frameTime-start,callbackTime:performance.now()-start,lateness:performance.now()-frameTime,phase:window.__notionEditPhase,left:rect.left,width:rect.width,disconnectWidth:slot.width});
                        window.__notionEditFrame=requestAnimationFrame(sample);
                    },0);
                }; window.__notionEditFrame=requestAnimationFrame(sample);
                ${notionScope}.querySelector('[aria-label^="Change journal page:"]').focus();
            })()`)
            await wait(`window.__notionEditFrames.length >= 2`)
            await assert(
                `document.activeElement === ${notionScope}.querySelector('[aria-label^="Change journal page:"]') && !document.activeElement.disabled`
            )
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
            await assert(
                `window.__notionEditNode === ${notionScope}.querySelector('.notion-page-connection [role="group"]')`
            )
            await assert(`${notionScope}.querySelector('[data-notion-disconnect]').inert`)
            await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
            await wait(
                `Array.from(document.querySelectorAll('[role="treeitem"][aria-selected="true"]')).some(n=>n.title===${JSON.stringify(stressMotion ? 'Journal with an exceptionally long name و—¥وœ¬èھ‍ ًں“ڑ' : 'Engineering notes')})`
            )
            if (
                requests.filter((request) => request.url === 'https://api.notion.com/v1/search').length !==
                searchesBeforeEdit
            )
                throw new Error('Fresh cached edit fetched all pages again')
            record({ warmPickerMilliseconds: performance.now() - warmEditStarted, freshCacheDiscoveryRequests: 0 })
            await shot('notion-edit-selected', 200, 'notion')
            await js(`window.__notionEditPhase='cancelling'`)
            await click('Cancel', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await pause(400)
            await assert(
                `document.activeElement === ${notionScope}.querySelector('[aria-label^="Change journal page:"]')`
            )
            await assert(
                `window.journal.invoke({type:'state'}).then(reply=>reply.state.settings.destination.id==='fixture-existing')`
            )
            const editFrames = await js(
                `(() => {window.__notionEditRunning=false;cancelAnimationFrame(window.__notionEditFrame);return window.__notionEditFrames})()`
            )
            const sampling = Object.fromEntries(
                ['opening', 'cancelling'].map((phase) => {
                    const frames = editFrames.filter((frame) => frame.phase === phase)
                    return [
                        phase,
                        {
                            frames: frames.length,
                            moving: frames
                                .slice(1)
                                .filter(
                                    (frame, index) =>
                                        Math.abs(frame.width - frames[index].width) > 0.25 ||
                                        Math.abs(frame.left - frames[index].left) > 0.25
                                ).length
                        }
                    ]
                })
            )
            if (!stressMotion && Object.values(sampling).some((phase) => phase.frames < 5 || phase.moving < 3))
                throw new Error(`Insufficient edit-morph samples: ${JSON.stringify(sampling)}`)
            const maxStep = Math.max(
                0,
                ...editFrames.slice(1).map((frame, index) => {
                    const previous = editFrames[index]
                    return (
                        (Math.max(Math.abs(frame.left - previous.left), Math.abs(frame.width - previous.width)) *
                            16.7) /
                        Math.max(8, frame.time - previous.time)
                    )
                })
            )
            // Use presentation timestamps, not callback execution intervals, for motion velocity.
            // A full picker is much wider than a count label. Scale the continuity bound to
            // its travel while still rejecting the old 98px single-frame sibling reflow.
            const travel = Math.max(
                ...['left', 'width'].map(
                    (key) =>
                        Math.max(...editFrames.map((frame) => frame[key])) -
                        Math.min(...editFrames.map((frame) => frame[key]))
                )
            )
            const stepLimit = Math.max(24, travel / 4)
            writeFileSync(
                join(output, 'notion-edit-morph.json'),
                JSON.stringify({ reduced: stressMotion, sampling, maxStep, stepLimit, frames: editFrames }, null, 2)
            )
            if (!stressMotion && maxStep > stepLimit)
                throw new Error(`Page edit morph jumped ${maxStep.toFixed(1)}px in one normalized frame`)
            await shot('notion-edit-cancelled', 100, 'notion')
            failNotionChoose = true
            await changeJournalPage()
            await wait(`${notionScope}.querySelector('.notion-page-connection [data-state="error"]') !== null`)
            await shot('notion-edit-retry', 100, 'notion')
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
            await click('Cancel', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            const clockNow = Date.now
            try {
                Date.now = () => clockNow() + 300001
                refreshedNames = true
                expireEditSearch = true
                await changeJournalPage()
                await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
                await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
                await wait(`!!document.querySelector('[role="treeitem"][title="Shared notes"]')`)
                const deadline = clockNow() + 10000
                while (
                    !JSON.parse(readFileSync(cachePath, 'utf8')).pages.some(
                        (page) => page.title === 'Updated shared notes'
                    )
                ) {
                    if (clockNow() > deadline) throw new Error('Background cache refresh did not finish')
                    await pause(50)
                }
                await assert(
                    `!!document.querySelector('[role="treeitem"][title="Shared notes"]') && !document.querySelector('[role="treeitem"][title="Updated shared notes"]')`
                )
                await shot('notion-cached-tree-stable', 100, 'notion')
                if (notionRotations !== 1) throw new Error('Destination discovery did not refresh rejected credentials')
                await click('Cancel', notionScope)
                await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
                await changeJournalPage()
                await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
                await js(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)').click()`)
                await wait(`!!document.querySelector('[role="treeitem"][title="Updated shared notes"]')`)
                await shot('notion-refreshed-cache-next-open', 100, 'notion')
                writeFileSync(join(output, 'notion-cache-refresh.json'), readFileSync(cachePath))
                await click('Cancel', notionScope)
                await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            } finally {
                Date.now = clockNow
            }
            await changeJournalPage()
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
            await choosePage('new')
            await js(`${notionScope}.querySelector('input').select()`)
            await window.webContents.insertText('Team journal')
            expireEditCreation = true
            failCredentialSave = true
            failDestinationSave = 'fixture-private-journal'
            await click('Confirm', notionScope)
            await wait(`${notionScope}.textContent.includes('Could not save page')`)
            await shot('notion-created-save-retry', 200, 'notion')
            await assertRestartPair('fixture-existing', 'fixture-rotated-2')
            if (notionPagesCreated !== 1) throw new Error('Expected one created page before local save failure')
            await click('Retry', notionScope)
            await wait(`${notionScope}.textContent.includes('Could not save page')`)
            await assertRestartPair('fixture-existing', 'fixture-rotated-2')
            await click('Retry', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="pending"]') !== null`)
            await click('Close dialog')
            await wait(`!document.querySelector('[aria-label="Notion connection"]')`)
            await pause(1500)
            if (notionRotations !== 2) throw new Error('Destination confirmation did not refresh rejected credentials')
            if (destinationSaveFailures !== 2) throw new Error('Destination save retries were not exercised')
            if (credentialSaveFailures !== 1) throw new Error('Credential stage failure was not exercised')
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
            await assertRestartPair('fixture-private-journal', 'fixture-rotated-2')
            await warmReload('Notion')
            if (!(await js(`window.journal.invoke({type:'state'})`)).connections.notion)
                throw new Error('Notion connection did not survive reload')
            if (!hasNotionCredentials()) throw new Error('Notion credentials not persisted')
            await cancelDisconnect('Notion')
            await click('Disconnect', notionScope)
            await wait(`${notionScope}.querySelector('[data-notion-disconnect] button[data-autofocus]') !== null`)
            await shot('notion-08-disconnect-confirm', 350, 'notion')
            await js(`${notionScope}.querySelector('[data-notion-disconnect] button[data-autofocus]').focus()`)
            await holdDisconnect('Notion', 'first')
            if ((await js(`window.journal.invoke({type:'state'})`)).connections.notion || hasNotionCredentials())
                throw new Error('Notion disconnect retained credentials')
            await shot('notion-09-disconnected', 350, 'notion')
            notionName = 'Second integration'
            holdDiscovery = true
            earlyScanAborted = false
            await click('Connect', notionScope)
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='device'`)
            await approveNotion()
            await wait(`${notionScope}.querySelector('[role="combobox"]:not([inert] *)') !== null`)
            await choosePage('fixture-private-journal')
            await click('Confirm', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="done"]') !== null`)
            if (!earlyScanAborted)
                throw new Error('Confirming an indexed destination did not cancel background discovery')
            holdDiscovery = false
            record({
                assertion: 'Confirmation succeeds during a blocked scan and cancels it without late picker changes',
                passed: true
            })
            await shot('notion-reconnect-success', 100, 'notion')
            await wait(`${notionScope}.querySelector('.github-signin-surface')?.dataset.phase==='connected'`)
            await wait(`${notionScope}.textContent.includes('Team journal')`)
            await assert(`!${notionScope}.textContent.includes('Second integration')`)
            if (notionPagesCreated !== 1) throw new Error('Reconnect duplicated the journal destination')
            record({
                cacheReusedWithoutDiscovery: true,
                staleRefreshKeptVisibleTree: true,
                refreshedTreeOnNextOpen: true
            })
            await shot('notion-reconnected', 700, 'notion')
            await click('Disconnect', notionScope)
            await wait(`${notionScope}.querySelector('[data-state="confirming"]') !== null`)
            await pause(350)
            await js(`${notionScope}.querySelector('[data-notion-disconnect] button[data-autofocus]').focus()`)
            await holdDisconnect('Notion', 'repeat')
            await assert(`!${notionScope}.querySelector('.settings-section-heading button').disabled`)
            if (
                (await js(`window.journal.invoke({type:'state'})`)).connections.notion ||
                hasNotionCredentials() ||
                existsSync(join(directory, 'profile', 'github.secret'))
            )
                throw new Error('Repeated disconnect retained credentials')
            if (existsSync(cachePath)) throw new Error('Disconnect retained Notion discovery metadata')
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
                    motionVariant: stressMotion
                        ? 'narrow-reduced-long-names'
                        : narrowViewport
                          ? 'narrow-normal'
                          : 'desktop-normal',
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
