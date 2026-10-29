import { app, ipcMain } from 'electron'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { seedJournal } from '../../../tools/seed-journal.mjs'

// Hold the real history request to inspect the waiting state deterministically.
let searchGate = Promise.resolve()
let releaseSearch = () => {}
app.on('history-hold-search', () => {
    searchGate = new Promise((resolve) => {
        releaseSearch = resolve
    })
})
app.on('history-release-search', () => releaseSearch())
const handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, payload) => {
        const command = channel === 'journal:updates' ? payload.command : payload
        if (command?.type === 'entryHistory') await searchGate
        return listener(event, payload)
    })

const profile = process.env.GITORIAN_E2E_PROFILE
if (!profile) throw new Error('An owned desktop test profile is required')
app.setPath('userData', profile)
mkdirSync(profile, { recursive: true })
const { initialState } = await tsImport('../../../src/shared/model.ts', import.meta.url)
const state = initialState()
state.settings.refreshMinutes = 0
state.entries = Array.from({ length: 55 }, (_, index) => ({
    id: `entry-${String(index).padStart(2, '0')}`,
    title: `Archive entry ${index}`,
    date: '2020-01-01',
    url: 'https://example.invalid',
    refreshedAt: '2020-01-01T12:00:00Z',
    body: {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text: index === 0 ? 'A unique archived lesson.' : 'Earlier published writing.' }
                ]
            }
        ]
    }
}))
// A Monday document must remain editable after switching the calendar preference to Sunday.
state.settings.weekStart = 0
state.drafts = [
    {
        id: 'local-week',
        week: '2020-01-06',
        title: 'Local autosaved entry',
        version: 2,
        updatedAt: '2020-01-06T12:00:00Z',
        publishedEntryId: 'entry-01',
        selections: [],
        body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A unique local lesson.' }] }]
        }
    }
]
await seedJournal(profile, state)
await import(pathToFileURL(resolve('out/main/index.js')).href)
