import { gitConfiguration } from '../src/shared/activity-history'
import type { Activity } from '../src/shared/model'
import { journalState } from './database-fixtures'
import { run } from './effect-fixtures'
import { expect, it, vi } from 'vitest'
import { commandSchema } from '../src/shared/model'
import { journal, workspace } from './fixtures'
import type { Repository } from '../src/shared/model'
import * as gitModule from '../src/main/git'
import { JournalDatabase } from '../src/main/journal-database'
import { join } from 'node:path'
it('manual refresh extends history using durable Git bodies and unchanged PR versions', async () => {
    const app = await workspace()
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        app.remote.github = true
        {
            app.repository.trackingStart = '2099-01-01'
            await app.store.saveRepository(app.repository)
        }
        await run(app.service.refresh())
        expect((await journalState(app.store)).activities).toEqual([])
        const refs = (await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].refs
        expect((await app.store.history(app.repository.id))?.items).toHaveLength(1)
        const reply = await run(app.service.handle(commandSchema.parse({ type: 'refresh', since: '2020-01-01' })))
        expect(reply.state.repositories[0].trackingStart).toBe('2020-01-01')
        expect((await journalState(app.store)).activities.some((item) => item.kind === 'commit')).toBe(true)
        expect((await journalState(app.store)).activities.some((item) => item.kind === 'change-request')).toBe(true)
        expect(index.mock.calls.at(-1)?.[1]).toEqual(refs)
        // Retained bodies are reprojected in SQLite, never transferred back through the Git interface.
        expect(reply.state.acquisition?.[`git:${app.repository.id}`].since).toBe('2020-01-01')
        const reopened = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
        try {
            expect((await journalState(reopened)).repositories[0].trackingStart).toBe('2020-01-01')
            expect((await reopened.history(app.repository.id))?.items).toHaveLength(1)
        } finally {
            await reopened.close()
        }
    } finally {
        index.mockRestore()
        await app.close()
    }
})
it('extends only targeted active repositories and never moves an earlier history start forward', async () => {
    const app = await journal()
    const repository: Repository = {
        id: 'target',
        name: 'target',
        path: '',
        remote: '',
        base: 'main',
        trackingStart: '2026-10-12',
        emails: [],
        available: true,
        removed: false,
        branchBases: {},
        branches: [],
        remotes: []
    }
    // This scenario owns scope/date rules. Native Git is covered by git.test.ts;
    // empty synthetic paths must never read the checkout running the test.
    const index = vi.spyOn(gitModule, 'indexCommits').mockResolvedValue({ refs: {}, items: [] })
    try {
        await app.store.saveRepository(repository)
        for (const fixtureRepository of [
            { ...repository, id: 'other', path: '', trackingStart: '2026-10-12' },
            { ...repository, id: 'removed', path: '', removed: true, trackingStart: '2026-10-12' }
        ])
            await app.store.saveRepository(fixtureRepository)
        await run(app.service.refresh({ source: 'git' }))
        expect(
            (await journalState(app.store)).repositories.find((item) => item.id === repository.id)?.trackingStart
        ).toBe('2026-10-12')
        await run(
            app.service.handle({
                type: 'refresh',
                repositoryId: repository.id,
                since: '2026-10-05',
                source: 'git'
            })
        )
        expect(
            (await journalState(app.store)).repositories
                .sort((a, b) => (a.id === repository.id ? -1 : b.id === repository.id ? 1 : a.id.localeCompare(b.id)))
                .map((repo) => repo.trackingStart)
        ).toEqual(['2026-10-05', '2026-10-12', '2026-10-12'])
        await run(app.service.handle({ type: 'refresh', since: '2026-10-08', source: 'git' }))
        expect(
            (await journalState(app.store)).repositories
                .sort((a, b) => (a.id === repository.id ? -1 : b.id === repository.id ? 1 : a.id.localeCompare(b.id)))
                .map((repo) => repo.trackingStart)
        ).toEqual(['2026-10-05', '2026-10-08', '2026-10-12'])
    } finally {
        index.mockRestore()
        await app.close()
    }
})

it('reprojects cached history in durable bounded pages when the date range expands', async () => {
    const app = await journal()
    const repo: Repository = {
        id: 'projection',
        name: 'Projection',
        path: '',
        remote: '',
        base: 'main',
        trackingStart: '2099-01-01',
        emails: ['me@example.com'],
        branches: ['main'],
        branchBases: {},
        remotes: [],
        removed: false,
        available: true
    }
    const refs = { main: 'a'.repeat(40) }
    const index = vi.spyOn(gitModule, 'indexCommits').mockResolvedValue({ refs, items: [] })
    try {
        await app.store.saveRepository(repo)
        const configuration = gitConfiguration(repo, {
            settings: app.store.config.settings,
            restoreId: app.store.generation
        })
        const items = Array.from({ length: 4001 }, (_, i): Activity => ({
            id: `commit-${String(i).padStart(5, '0')}`,
            repositoryId: repo.id,
            kind: 'commit',
            title: `Commit ${i}`,
            sha: String(i).padStart(40, '0'),
            author: 'me@example.com',
            date: '2026-10-06T00:00:00Z',
            description: '',
            files: [],
            branches: ['main'],
            deletedBranches: [],
            disposition: 'inbox',
            explicit: false
        }))
        await app.store.applyAcquisitionBatch({ repository: repo, historyDelta: { configuration, refs, items } })
        const key = `git:${repo.id}`
        await app.store.saveCheckpoint(key, {
            status: 'idle',
            since: '2099-01-01',
            historySince: '2099-01-01',
            historyTimezone: app.store.config.settings.timezone,
            configuration
        })
        await app.store.saveRepository({ ...repo, trackingStart: '2020-01-01' })
        await run(app.service.refresh({ source: 'git' }))
        expect((await journalState(app.store)).activities).toHaveLength(2000)
        const reopened = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
        try {
            const progress = await reopened.acquisitionCheckpoint(key)
            expect(progress?.historyProjection?.after).toBe('commit-01999')
            expect(progress?.historySince).toBe('2099-01-01')
            expect(progress?.windowEnd).toBeDefined()
        } finally {
            await reopened.close()
        }
        await run(app.service.refresh({ source: 'git' }))
        expect((await journalState(app.store)).activities).toHaveLength(4000)
        await run(app.service.refresh({ source: 'git' }))
        expect((await journalState(app.store)).activities).toHaveLength(4001)
        expect((await app.store.acquisitionCheckpoint(key))?.historyProjection).toBeUndefined()
        expect((await app.store.acquisitionCheckpoint(key))?.historySince).toBe('2020-01-01')
    } finally {
        index.mockRestore()
        await app.close()
    }
})
