import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { seedJournal } from '../../../tools/seed-journal.mjs'

const profile = process.env.GITORIAN_E2E_PROFILE
if (!profile) throw new Error('An owned desktop test profile is required')
app.setPath('userData', profile)
mkdirSync(profile, { recursive: true })
const { initialState } = await tsImport('../../../src/shared/model.ts', import.meta.url)
const { hubRepository } = await tsImport('../../hub-fixtures.ts', import.meta.url)
const { gitConfiguration } = await tsImport('../../../src/shared/activity-history.ts', import.meta.url)
const { JournalDatabase } = await tsImport('../../../src/main/journal-database.ts', import.meta.url)
const state = initialState()
state.settings.refreshMinutes = 0
state.repositories = ['portfolio', 'procurement', 'journal', 'catalogue', 'blog'].map((name, index) =>
    hubRepository(index, { name, remote: 'https://github.com/example/' + name })
)
await seedJournal(profile, state)
const db = await JournalDatabase.open(join(profile, 'journal.sqlite'))
const retryAt = new Date(Date.now() + 3600_000).toISOString()
try {
    for (const repo of state.repositories)
        await db.saveCheckpoint(`git:${repo.id}`, {
            status: 'idle',
            lastSuccess: new Date().toISOString(),
            historySince: '2026-01-01',
            historyTimezone: db.config.settings.timezone,
            configuration: gitConfiguration(repo, { settings: db.config.settings, restoreId: db.generation })
        })
    await db.saveCheckpoint('remote:repo-0', {
        status: 'error',
        error: 'Choose or reconnect an account for this repository in Settings.'
    })
    await db.saveCheckpoint('remote:repo-1', { status: 'paused', pauseReason: 'queue', retryAt })
    await db.saveCheckpoint('remote:repo-2', { status: 'paused', pauseReason: 'allowance', retryAt })
    await db.saveCheckpoint('remote:repo-3', {
        status: 'paused',
        pauseReason: 'provider',
        retryAt,
        error: 'Source returned 429: rate limit.'
    })
    await db.saveCheckpoint('remote:repo-4', {
        status: 'paused',
        pauseReason: 'connection',
        retryAt,
        error: 'fetch failed'
    })
} finally {
    await db.close()
}
await import(pathToFileURL(resolve('out/main/index.js')).href)
