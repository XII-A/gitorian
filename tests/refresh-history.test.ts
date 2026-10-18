import { expect, it, vi } from 'vitest'
import { commandSchema } from '../src/shared/model'
import { workspace } from './fixtures'
import * as gitModule from '../src/main/git'
import { Store } from '../src/main/store'
import { join } from 'node:path'

it('manual refresh extends history and rereads unchanged Git refs and GitHub history', async () => {
    const app = await workspace()
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        app.remote.github = true
        app.repository.trackingStart = '2099-01-01'
        await app.service.refresh()
        expect(app.store.state.activities).toEqual([])
        const reply = await app.service.handle(commandSchema.parse({ type: 'refresh', since: '2020-01-01' }))
        expect(reply.state.repositories[0].trackingStart).toBe('2020-01-01')
        expect(reply.state.activities.some((item) => item.kind === 'commit')).toBe(true)
        expect(reply.state.activities.some((item) => item.kind === 'pr')).toBe(true)
        expect(index.mock.calls.at(-1)?.[1]).toEqual({})
        expect(reply.state.acquisition?.[`git:${app.repository.id}`].since).toBe('2020-01-01')
        const reopened = new Store(join(app.directory, 'tracking.sqlite'))
        try {
            expect(reopened.state.repositories[0].trackingStart).toBe('2020-01-01')
        } finally {
            reopened.close()
        }
    } finally {
        index.mockRestore()
        await app.close()
    }
})

it('extends only targeted active repositories and never moves an earlier history start forward', async () => {
    const app = await workspace()
    try {
        app.repository.trackingStart = '2026-10-12'
        app.store.state.repositories.push(
            { ...app.repository, id: 'other', trackingStart: '2026-10-12' },
            { ...app.repository, id: 'removed', removed: true, trackingStart: '2026-10-12' }
        )
        await app.service.refresh({ source: 'git' })
        expect(app.repository.trackingStart).toBe('2026-10-12')
        await app.service.handle({
            type: 'refresh',
            repositoryId: app.repository.id,
            since: '2026-10-05',
            source: 'git'
        })
        expect(app.store.state.repositories.map((repo) => repo.trackingStart)).toEqual([
            '2026-10-05',
            '2026-10-12',
            '2026-10-12'
        ])
        await app.service.handle({ type: 'refresh', since: '2026-10-08', source: 'git' })
        expect(app.store.state.repositories.map((repo) => repo.trackingStart)).toEqual([
            '2026-10-05',
            '2026-10-08',
            '2026-10-12'
        ])
    } finally {
        await app.close()
    }
})
