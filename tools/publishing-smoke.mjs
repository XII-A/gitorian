import { seedJournal } from './seed-journal.mjs'
import { app, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const scratch = process.env.GITORIAN_VERIFY_STATE
const output = process.env.GITORIAN_VERIFY_OUTPUT
if (!scratch || !output) throw new Error('Run pnpm verify publishing')
const profile = join(scratch, 'profile')
mkdirSync(profile)
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.once('ready', () => {
    assert.ok(safeStorage.isEncryptionAvailable(), 'Fixture credentials require OS encryption')
    writeFileSync(join(profile, 'notion.secret'), safeStorage.encryptString('isolated-fixture-token'))
})
const { initialState, weekOf } = await tsImport('../src/shared/model.ts', import.meta.url)
const state = initialState()
state.settings.refreshMinutes = 0
state.settings.destination = { kind: 'page', id: 'fixture-parent', titleProperty: 'Name', dateProperty: '' }
const week = weekOf(new Date(), state.settings)
state.drafts = [
    {
        id: 'fixture-draft',
        week,
        title: 'A week of steady progress',
        body: {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Shipped the activity hub improvements and reviewed the next release.' }
                    ]
                }
            ]
        },
        selections: [],
        updatedAt: new Date().toISOString()
    }
]
await seedJournal(profile, state)
const requests = []
let blocks = []
let fail = false
const page = {
    id: 'fixture-entry',
    url: 'https://notion.so/fixture-entry',
    created_time: new Date().toISOString(),
    properties: {}
}
globalThis.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    assert.equal(url.host, 'api.notion.com', 'No external integration access')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    requests.push({ method, path: url.pathname, body })
    writeFileSync(join(output, 'http-requests.json'), JSON.stringify(requests, null, 2))
    if (fail) return Promise.resolve(new Response('{}', { status: 403 }))
    const response = (value) => Promise.resolve(new Response(JSON.stringify(value)))
    if (url.pathname === '/v1/pages' && method === 'POST') {
        blocks = body.children.map((block, index) => ({ ...block, id: `block-${index}` }))
        return response(page)
    }
    if (url.pathname === '/v1/pages/fixture-entry' && ['PATCH', 'GET'].includes(method)) return response(page)
    if (url.pathname === '/v1/blocks/fixture-entry/children') {
        if (method === 'PATCH')
            blocks.push(...body.children.map((block, index) => ({ ...block, id: `updated-${index}` })))
        return response({ results: blocks, has_more: false })
    }
    if (url.pathname.startsWith('/v1/blocks/') && method === 'DELETE') {
        blocks = blocks.filter((block) => block.id !== url.pathname.split('/').at(-1))
        return response({})
    }
    throw new Error(`Unexpected fixture HTTP: ${method} ${url.pathname}`)
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let started = false
app.on('browser-window-created', (_, window) => {
    window.show = () => window.showInactive()
    window.webContents.setBackgroundThrottling(false)
    window.webContents.once('did-finish-load', async () => {
        if (started) return
        started = true
        const js = (source) => window.webContents.executeJavaScript(source)
        const record = (value) => appendFileSync(join(output, 'actions.jsonl'), JSON.stringify(value) + '\n')
        const wait = async (source) => {
            for (let i = 0; i < 100; i++) {
                if (await js(source)) return
                await pause(50)
            }
            throw new Error(`Timed out: ${source}`)
        }
        const shot = async (name) => {
            await pause(650)
            writeFileSync(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG())
        }
        try {
            await window.loadURL(window.webContents.getURL().split('?')[0] + '?workspace=true')
            await wait(`!!document.querySelector('[aria-label="Journal body"]')`)
            record({ action: 'Publish the local draft through the header action; provider HTTP is simulated' })
            await js(`document.querySelector('.ws-publish button').click()`)
            await wait(
                `document.querySelector('.ws-publish button').textContent.includes('Update in Notion') && document.querySelector('.journal-notifications')?.textContent.includes('Published to Notion')`
            )
            await shot('published-to-notion')
            assert.equal(requests.filter((r) => r.method === 'POST' && r.path === '/v1/pages').length, 1)
            record({ action: 'Edit the published draft and update the same page' })
            await js(`document.querySelector('[aria-label="Journal body"]').focus()`)
            window.webContents.insertText(' Followed up on the release feedback.')
            await js(`document.querySelector('.ws-publish button').click()`)
            await wait(`document.querySelector('.journal-notifications')?.textContent.includes('Updated in Notion')`)
            await shot('updated-in-notion')
            assert.equal(requests.filter((r) => r.method === 'POST' && r.path === '/v1/pages').length, 1)
            assert.equal(requests.filter((r) => r.method === 'PATCH' && r.path === '/v1/pages/fixture-entry').length, 1)
            await window.loadURL(window.webContents.getURL())
            await wait(`document.querySelector('.ws-publish button')?.textContent.includes('Update in Notion')`)
            fail = true
            record({ action: 'Simulate lost access; show recovery instead of success' })
            await js(`document.querySelector('[aria-label="Journal body"]').focus()`)
            window.webContents.insertText(' Another update.')
            await js(`document.querySelector('.ws-publish button').click()`)
            await wait(
                `document.querySelector('.journal-notifications')?.textContent.includes('Could not publish to Notion')`
            )
            assert.equal(
                await js(`document.querySelector('.journal-notifications').textContent.includes('Updated in Notion')`),
                false
            )
            await shot('publish-failed')
            writeFileSync(join(output, 'journey.json'), JSON.stringify({ passed: true, provider: 'simulated' }))
            window.close()
        } catch (error) {
            console.error(error)
            await shot('failure')
            app.exit(1)
        }
    })
})
await import(pathToFileURL(resolve('out/main/index.js')).href)
