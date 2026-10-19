import { expect, it, vi } from 'vitest'
import { workspace } from './fixtures'
import * as gitModule from '../src/main/git'
import { JournalService } from '../src/main/service'
import { Store } from '../src/main/store'
import { join } from 'node:path'

it('loads all five local sources while GitHub is blocked', async () => {
    const app = await workspace()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
        release = resolve
    })
    const github = vi.spyOn(app.github, 'activities').mockImplementation(async () => {
        await held
        return []
    })
    let pending: Promise<void> | undefined
    try {
        app.remote.github = true
        for (let i = 1; i < 5; i++) app.store.state.repositories.push({ ...app.repository, id: `repo-${i}` })
        pending = app.service.refresh()
        await vi.waitFor(
            () => {
                const local = Object.entries(app.store.state.acquisition ?? {}).filter(
                    ([key, value]) => key.startsWith('git:') && value.lastSuccess
                )
                expect(local).toHaveLength(5)
            },
            { timeout: 10000 }
        )
        expect(app.store.state.activities.filter((activity) => activity.kind === 'commit')).toHaveLength(5)
        expect(github).toHaveBeenCalledTimes(2)
    } finally {
        release()
        await pending
        github.mockRestore()
        await app.close()
    }
})

it('reuses out-of-range author history after restart, and skips acquisition for a covered week', async () => {
    const app = await workspace()
    let reopened: Store | undefined
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        app.repository.trackingStart = '2099-01-01'
        await app.service.refresh({ source: 'git' })
        expect(app.store.state.activities).toHaveLength(0)
        reopened = new Store(join(app.directory, 'tracking.sqlite'))
        const service = new JournalService(reopened, app.github, app.notion, () => ({
            github: false,
            notion: false,
            protectedStorage: false
        }))
        index.mockClear()
        await service.handle({ type: 'loadWeek', since: '2020-01-01' })
        expect(index).not.toHaveBeenCalled()
        expect(reopened.state.activities).toHaveLength(1)
        expect(reopened.state.acquisition?.[`git:${app.repository.id}`].historySince).toBe('2020-01-01')
        expect(service.reply().state).not.toHaveProperty('gitHistory')
        index.mockClear()
        await service.handle({ type: 'loadWeek', since: '2020-01-08' })
        expect(index).not.toHaveBeenCalled()
    } finally {
        index.mockRestore()
        reopened?.close()
        await app.close()
    }
})

it('continues requested history without waiting for the five-second background timer', async () => {
    const app = await workspace()
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        index.mockResolvedValueOnce({ refs: { main: 'a'.repeat(40) }, items: [], history: [], nextOffset: 2000 })
        index.mockResolvedValueOnce({ refs: { main: 'a'.repeat(40) }, items: [], history: [] })
        await app.service.handle({ type: 'refresh', since: '2020-01-01', source: 'git' })
        expect(index).toHaveBeenCalledTimes(2)
        expect(index.mock.calls[1][3]).toBe(2000)
        expect(app.store.state.acquisition?.[`git:${app.repository.id}`]).toMatchObject({
            status: 'idle',
            historySince: '2020-01-01',
            windowEnd: undefined
        })
    } finally {
        index.mockRestore()
        await app.close()
    }
})

it('extending history retains unchanged GitHub PR versions', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        app.repository.trackingStart = '2026-10-12'
        await app.service.refresh()
        // Earlier events from this hydrated PR must survive version-based skipping.
        expect(
            app.store.state.activities.some(
                (activity) => activity.kind === 'review' && activity.date.startsWith('2026-10-07')
            )
        ).toBe(true)
        const start = app.remote.requests.length
        await app.service.handle({ type: 'refresh', since: '2020-01-01' })
        const requests = app.remote.requests.slice(start).filter((request) => request.url.includes('api.github.com'))
        expect(requests).toHaveLength(1)
        expect(requests[0].url).toContain('/pulls?')
    } finally {
        await app.close()
    }
})

it('reuses rewritten author dates while retaining existing journal decisions', async () => {
    const app = await workspace()
    try {
        await app.git('commit', '--allow-empty', '--date=2020-01-07T12:00:00Z', '-m', 'Old author date, recent rewrite')
        await app.service.refresh({ source: 'git' })
        const current = app.store.state.activities[0]
        current.disposition = 'dismissed'
        current.reason = 'Already recorded'
        expect(
            app.store.state.activities.some((activity) => activity.title === 'Old author date, recent rewrite')
        ).toBe(false)
        await app.service.handle({ type: 'loadWeek', since: '2020-01-06' })
        expect(
            app.store.state.activities.find((activity) => activity.title === 'Old author date, recent rewrite')?.date
        ).toContain('2020-01-07')
        expect(app.store.state.activities.find((activity) => activity.id === current.id)).toMatchObject({
            disposition: 'dismissed',
            reason: 'Already recorded'
        })
    } finally {
        await app.close()
    }
})

it('can acquire an earlier local week while a previous remote refresh is still waiting', async () => {
    const app = await workspace()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const github = vi.spyOn(app.github, 'activities').mockImplementation(async (_repo, _login, _tracked, scan) => {
        await gate
        scan?.checkpoint?.(1, true)
        return []
    })
    let first: Promise<void> | undefined
    let earlier: Promise<unknown> | undefined
    try {
        app.remote.github = true
        app.repository.trackingStart = '2099-01-01'
        first = app.service.refresh()
        await vi.waitFor(
            () => expect(app.store.state.acquisition?.[`git:${app.repository.id}`].lastSuccess).toBeDefined(),
            { timeout: 10000 }
        )
        earlier = app.service.handle({ type: 'loadWeek', since: '2020-01-01' })
        await vi.waitFor(
            () => expect(app.store.state.activities.some((activity) => activity.kind === 'commit')).toBe(true),
            { timeout: 10000 }
        )
        expect(app.store.state.acquisition?.[`git:${app.repository.id}`].historySince).toBe('2020-01-01')
    } finally {
        release()
        await Promise.all([first, earlier])
        github.mockRestore()
        await app.close()
    }
})
