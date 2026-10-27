import { seedJournal } from './seed-journal.mjs'
import { app, dialog, shell } from 'electron'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const scratch = process.env.GITORIAN_VERIFY_STATE
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!scratch || !output) throw new Error('Run pnpm verify github-import')
const profile = join(scratch, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const { initialState } = await tsImport('../src/shared/model.ts', import.meta.url)
const state = initialState()
state.settings.refreshMinutes = 0
await seedJournal(profile, state)
for (const name of ['before', 'after']) {
    const path = join(scratch, name)
    mkdirSync(path)
    const git = (...args) => execFileSync('git', args, { cwd: path, windowsHide: true, stdio: 'ignore' })
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture author')
    git('config', 'user.email', 'fixture@example.com')
    git('commit', '--allow-empty', '-m', `Local work ${name}`)
    git(
        'remote',
        'add',
        'origin',
        name === 'before' ? 'https://github.com/fixture/before.git' : 'git@github.com:fixture-author/after.git'
    )
    if (name === 'after') git('remote', 'add', 'upstream', 'ssh://git@github.com/fixture/after.git')
}
let folder = join(scratch, 'before')
dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] })
shell.openExternal = () => Promise.resolve()
let authorized = false
let failAfter = true
let rotations = 0
let clockOffset = 0
const realNow = Date.now.bind(Date)
Date.now = () => realNow() + clockOffset
const requests = []
const now = new Date().toISOString()
const json = (value) => Promise.resolve(new Response(JSON.stringify(value)))
globalThis.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push({ host: url.host, path: url.pathname, method: init.method ?? 'GET' })
    writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
    if (url.href === 'https://github.com/login/device/code')
        return json({
            device_code: 'fixture-device',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://github.com/login/device',
            interval: 1,
            expires_in: 600
        })
    if (url.href === 'https://github.com/login/oauth/access_token') {
        const body = JSON.parse(init.body)
        if (body.grant_type === 'refresh_token') {
            assert.equal(body.refresh_token, `fixture-refresh-${rotations}`)
            assert.equal(body.client_secret, undefined)
            rotations++
        }
        return json(
            authorized
                ? {
                      access_token: `isolated-fixture-token-${rotations}`,
                      refresh_token: `fixture-refresh-${rotations}`,
                      expires_in: 28800
                  }
                : { error: 'authorization_pending' }
        )
    }
    assert.equal(url.host, 'api.github.com', 'Fixture must not access external services')
    assert.equal(
        new Headers(init.headers).get('Authorization'),
        `Bearer isolated-fixture-token-${rotations}`,
        'API requests must use the latest access token, never the stored credential JSON'
    )
    if (url.pathname === '/user') return json({ login: 'fixture-author' })
    if (url.pathname === '/user/emails') return json([{ email: 'fixture@example.com' }])
    const match = /^\/repos\/fixture\/(before|after)\/pulls(?:\/1(\/commits|\/reviews)?)?$/.exec(url.pathname)
    if (!match) throw new Error(`Unexpected fixture request: ${url.pathname}`)
    const name = match[1]
    if (name === 'after' && failAfter)
        return Promise.resolve(new Response('{}', { status: 500, statusText: 'Internal Server Error' }))
    const pull = {
        number: 1,
        title: `GitHub work ${name}`,
        body: 'Fixture pull request',
        html_url: `https://github.com/fixture/${name}/pull/1`,
        created_at: now,
        updated_at: now,
        state: 'open',
        draft: false,
        closed_at: null,
        merged_at: null,
        merge_commit_sha: null,
        user: { login: 'fixture-author' },
        base: { ref: 'main', sha: 'b'.repeat(40) },
        head: { ref: 'feature', sha: 'a'.repeat(40) }
    }
    if (match[2] === '/commits')
        return json([
            {
                sha: 'a'.repeat(40),
                commit: { author: { email: 'fixture@example.com', date: now }, message: 'Fixture contribution' }
            }
        ])
    if (match[2] === '/reviews')
        return json([
            {
                id: 10,
                body: 'Approved',
                submitted_at: now,
                user: { login: 'fixture-author' },
                state: 'APPROVED',
                html_url: `${pull.html_url}#review-10`
            }
        ])
    return json(url.pathname.endsWith('/pulls') ? [pull] : pull)
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        const record = (value) =>
            appendFileSync(
                join(output, 'actions.jsonl'),
                JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'
            )
        const js = (expression) => window.webContents.executeJavaScript(expression)
        const wait = async (expression) => {
            for (let i = 0; i < 150; i++) {
                if (await js(expression)) return
                await pause(75)
            }
            throw new Error(`Timed out: ${expression}`)
        }
        const click = async (text, scope = 'document') => {
            record({ click: text, scope })
            await pause(300)
            const point = await js(
                `(()=>{const node=Array.from(${scope}.querySelectorAll('button')).find(node=>!node.closest('[inert]') && (node.getAttribute('aria-label')===${JSON.stringify(text)} || node.textContent.trim()===${JSON.stringify(text)}));node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
            )
            window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
            window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
            await pause(50)
        }
        const shot = async (name) => {
            await pause(500)
            writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
            record({ screenshot: `${name}.png`, text: await js('document.body.innerText') })
        }
        const importFolder = async (name, count) => {
            folder = join(scratch, name)
            await click('Add repositories from folder')
            await wait(
                `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Import 1 repository')`
            )
            await click('Import 1 repository')
            await wait(
                `(async()=>{const r=await window.journal.invoke({type:'state'});return r.state.repositories.length===${count} && r.state.repositoryImport?.status==='done'})()`
            )
            await wait(
                `document.querySelector('.settings-import-button')?.textContent.includes('Add repositories from folder') && !document.querySelector('.settings-import-button')?.disabled`
            )
        }
        try {
            await wait(`!!document.querySelector('[aria-label="Open settings"]')`)
            await wait(`!!document.querySelector('[aria-label="Dismiss setup"]')`)
            await click('Dismiss setup')
            await click('Open settings')
            await importFolder('before', 1)
            const before = await js(`window.journal.invoke({type:'state'})`)
            assert.equal(
                before.state.repositories[0].remote,
                'https://github.com/fixture/before.git',
                'Import must choose a GitHub source before sign-in'
            )
            assert.equal(
                requests.filter((r) => r.host === 'api.github.com').length,
                0,
                'Disconnected GitHub must not fetch'
            )
            await click('Connections')
            await wait(`!!document.querySelector('[aria-label="GitHub connection"]')`)
            await click('Connect', `document.querySelector('[aria-label="GitHub connection"]')`)
            await wait(`document.querySelector('[aria-label="GitHub connection"]').textContent.includes('ABCD-EFGH')`)
            authorized = true
            await wait(
                `(async()=>{const r=await window.journal.invoke({type:'state'});return r.connections.github && r.state.activities.some(a=>a.kind==='pr' && a.title.includes('before')) && r.state.activities.some(a=>a.kind==='review')})()`
            )
            await shot('connected-with-activity')
            await click('Repositories')
            await importFolder('after', 2)
            await wait(
                `(async()=>{const r=await window.journal.invoke({type:'state'});const repo=r.state.repositories.find(p=>p.name==='after');return r.state.acquisition?.['github:'+repo.id]?.status==='error'})()`
            )
            const failed = await js(`window.journal.invoke({type:'state'})`)
            assert.equal(
                failed.state.repositories.find((r) => r.name === 'after').remote,
                'ssh://git@github.com/fixture/after.git',
                'Forks must use their upstream remote'
            )
            assert.ok(
                failed.state.activities.some((a) => a.kind === 'pr' && a.title.includes('before')),
                'Healthy source must remain visible'
            )
            await click('Close dialog', `document.querySelector('.settings')`)
            await wait(`!!document.querySelector('[aria-label="Activity sources"]')`)
            await click('Activity sources')
            await shot('source-failure')
            failAfter = false
            await click('Retry')
            await wait(
                `(async()=>{const r=await window.journal.invoke({type:'state'});return r.state.activities.filter(a=>a.kind==='pr').length===2 && r.state.activities.filter(a=>a.kind==='review').length===2 && r.state.activities.filter(a=>a.kind==='commit' && a.title.startsWith('Local work')).length===2})()`
            )
            await wait(`!document.querySelector('.acquisition-sources')`)
            await wait(`document.querySelector('.weekly-hub').textContent.includes('GitHub work after')`)
            await shot('automatic-prs')
            record({
                action: 'Simulate nine hours closed by advancing only the main-process clock; refresh both repositories through the UI'
            })
            clockOffset = 9 * 60 * 60 * 1000
            await click('Refresh activity')
            await wait(
                `(async()=>{const r=await window.journal.invoke({type:'state'});return r.connections.github && r.state.repositories.every(repo=>r.state.acquisition?.['github:'+repo.id]?.status==='idle')})()`
            )
            assert.equal(rotations, 1, 'Multiple repositories must share one credential renewal')
            await shot('github-renewed-without-reconnect')
            writeFileSync(
                join(output, 'github-renewal.json'),
                JSON.stringify({ simulatedHoursClosed: 9, rotations, repositories: 2, connected: true }, null, 2)
            )
            // The existing repository command is an explicit local-only preference, not import setup.
            record({
                action: 'Set Local only through repository IPC, then refresh and reload; Settings form interaction is outside this journey'
            })
            await js(
                `(async()=>{const r=await window.journal.invoke({type:'state'});const repository=r.state.repositories.find(p=>p.name==='after');await window.journal.invoke({type:'repository',repository:{...repository,remote:''}})})()`
            )
            const calls = requests.filter((r) => r.path.startsWith('/repos/fixture/after/')).length
            await click('Refresh activity')
            await wait(
                `(async()=>{const r=await window.journal.invoke({type:'state'});return !Object.values(r.state.acquisition??{}).some(s=>s.status==='running')})()`
            )
            assert.equal(
                requests.filter((r) => r.path.startsWith('/repos/fixture/after/')).length,
                calls,
                'Explicit local-only must stop GitHub reads'
            )
            await window.loadURL(window.webContents.getURL())
            await wait(`document.querySelector('.weekly-hub')?.textContent.includes('GitHub work after')`)
            await shot('persisted-prs')
            record({
                assert: 'Both setup orders, local Git, PRs/reviews, isolated failure/retry, explicit local-only, reload',
                passed: true
            })
            writeFileSync(
                join(output, 'journey.json'),
                JSON.stringify({ passed: true, provider: 'simulated' }, null, 2)
            )
            window.close()
        } catch (error) {
            console.error(error)
            writeFileSync(
                join(output, 'failure-state.json'),
                JSON.stringify(await js(`window.journal.invoke({type:'state'})`), null, 2)
            )
            await shot('failure')
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
