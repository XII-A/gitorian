import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { seedJournal } from '../../../tools/seed-journal.mjs'

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
await seedJournal(profile, state)
await import(pathToFileURL(resolve('out/main/index.js')).href)
