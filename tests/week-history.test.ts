import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { deferred } from './deferred'
import { hubRepository } from './hub-fixtures'
import { RecoveryAdmission } from '../src/main/recovery-admission'
import { nextAcquisition } from '../src/shared/acquisition'
import { cp, mkdir } from 'node:fs/promises'
import { journalState } from './database-fixtures'
import { run, journalClient } from './effect-fixtures'
import { expect, it, vi } from 'vitest'
import { workspace } from './fixtures'
import * as gitModule from '../src/main/git'
import { JournalDatabase } from '../src/main/journal-database'
import { join } from 'node:path'
import { rangeActivities } from '../src/renderer/activity-projection'
it('keeps automatic week loading cache-only in recovery until that Git source is resumed', async () => {
    const recovery = new RecoveryAdmission(true)
    const app = await workspace(recovery)
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        const key = `git:${app.repository.id}`
        await app.store.saveCheckpoint(key, { status: 'idle', windowEnd: new Date().toISOString() })
        expect((await run(app.service.reply())).state.acquisition?.[key].status).toBe('cancelled')
        expect(app.store.config.acquisition[key].status).toBe('idle')
        await run(app.service.handle({ type: 'loadWeek', since: '2020-01-01' }))
        expect(index).not.toHaveBeenCalled()
        expect((await journalState(app.store)).activities).toHaveLength(0)
        recovery.resume('git', app.repository.id)
        await run(app.service.handle({ type: 'loadWeek', since: '2020-01-01' }))
        expect((await journalState(app.store)).activities).toHaveLength(1)
        expect(recovery.normal).toBe(false)
    } finally {
        index.mockRestore()
        await app.close()
    }
})
it('loads newly imported repositories when an earlier request for the same week is still running', async () => {
    const app = await workspace()
    const imported = await workspace()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const entered = deferred<undefined>()
    app.remote.github = true
    app.remote.beforeRequest = (url) => {
        if (!url.includes('/pulls?')) return Promise.resolve()
        entered.resolve(undefined)
        return gate
    }
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
        await imported.git('commit', '--allow-empty', '--date=2026-10-06T12:00:00Z', '-m', 'Imported project work')
        expect(await app.git('log', '--format=%s')).not.toContain('Imported project work')
        first = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        await Promise.race([
            entered.promise,
            first.then(() => {
                throw new Error('Week completed without reaching the provider')
            })
        ])
        const scan = (await run(app.service.scanRepositories(imported.directory))).repositoryScan!
        await run(
            app.service.importRepositories(
                scan.id,
                scan.repositories.map((repository) => repository.path)
            )
        )
        second = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        release()
        await Promise.all([first, second])
        expect(
            rangeActivities(await journalState(app.store), '2026-10-05', '2026-10-11').map((activity) => activity.title)
        ).toContain('Imported project work')
    } finally {
        release()
        await Promise.all([first, second])
        await Promise.all([app.close(), imported.close()])
    }
})
it('loads two local sources and an earlier requested week while GitHub is blocked', async () => {
    const app = await workspace()
    const entered = deferred<undefined>()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
        release = resolve
    })
    app.remote.beforeRequest = (url) => {
        if (!url.includes('/pulls?')) return Promise.resolve()
        entered.resolve(undefined)
        return held
    }
    let pending: Promise<void> | undefined
    let earlier: Promise<unknown> | undefined
    try {
        app.remote.github = true
        {
            app.repository.trackingStart = '2099-01-01'
            await app.store.saveRepository(app.repository)
        }
        for (let i = 1; i < 2; i++) {
            const path = join(app.directory, `repo-${i}`)
            await mkdir(path)
            await cp(join(app.directory, '.git'), join(path, '.git'), { recursive: true })
            await app.store.saveRepository({ ...app.repository, id: `repo-${i}`, path })
        }
        pending = run(app.service.refresh())
        await Promise.race([
            entered.promise,
            pending.then(() => {
                throw new Error('Refresh completed without reaching GitHub')
            })
        ])
        await vi.waitFor(
            async () => {
                const local = Object.entries((await journalState(app.store)).acquisition ?? {}).filter(
                    ([key, value]) => key.startsWith('git:') && value.lastSuccess
                )
                expect(local).toHaveLength(2)
            },
            { timeout: 10000 }
        )
        expect((await journalState(app.store)).activities).toHaveLength(0)
        earlier = run(app.service.handle({ type: 'loadWeek', since: '2020-01-01' }))
        await vi.waitFor(
            async () =>
                expect(
                    (await journalState(app.store)).activities.filter((activity) => activity.kind === 'commit')
                ).toHaveLength(2),
            { timeout: 10000 }
        )
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].historySince).toBe(
            '2020-01-01'
        )
    } finally {
        release()
        await Promise.all([pending, earlier])
        await app.close()
    }
})
it('reuses out-of-range author history after restart, and skips acquisition for a covered week', async () => {
    const app = await workspace()
    let reopened: JournalDatabase | undefined
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        {
            app.repository.trackingStart = '2099-01-01'
            await app.store.saveRepository(app.repository)
        }
        await run(app.service.refresh({ source: 'git' }))
        expect((await journalState(app.store)).activities).toHaveLength(0)
        reopened = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
        const service = await journalClient(
            reopened,
            app.github,
            app.notion,
            () => ({
                remote: false,
                notion: false,
                protectedStorage: false
            }),
            app.requests
        )
        index.mockClear()
        await run(service.handle({ type: 'loadWeek', since: '2020-01-01' }))
        expect(index).not.toHaveBeenCalled()
        expect((await journalState(reopened)).activities).toHaveLength(1)
        expect((await journalState(reopened)).acquisition?.[`git:${app.repository.id}`].historySince).toBe('2020-01-01')
        expect((await run(service.reply())).state).not.toHaveProperty('gitHistory')
        index.mockClear()
        await run(service.handle({ type: 'loadWeek', since: '2020-01-08' }))
        expect(index).not.toHaveBeenCalled()
    } finally {
        index.mockRestore()
        await reopened?.close()
        await app.close()
    }
})
it('reuses rewritten author dates while retaining existing journal decisions', async () => {
    const app = await workspace()
    try {
        await app.git('commit', '--allow-empty', '--date=2020-01-07T12:00:00Z', '-m', 'Old author date, recent rewrite')
        await run(app.service.refresh({ source: 'git' }))
        const current = (await journalState(app.store)).activities[0]
        current.disposition = 'dismissed'
        current.reason = 'Already recorded'
        await app.store.setDisposition(current.id, 'dismissed', undefined, 'Already recorded')
        expect(
            (await journalState(app.store)).activities.some(
                (activity) => activity.title === 'Old author date, recent rewrite'
            )
        ).toBe(false)
        await run(app.service.handle({ type: 'loadWeek', since: '2020-01-06' }))
        expect(
            (await journalState(app.store)).activities.find(
                (activity) => activity.title === 'Old author date, recent rewrite'
            )?.date
        ).toContain('2020-01-07')
        expect((await journalState(app.store)).activities.find((activity) => activity.id === current.id)).toMatchObject(
            {
                disposition: 'dismissed',
                reason: 'Already recorded'
            }
        )
    } finally {
        await app.close()
    }
})
it.each([
    ['Europe/Istanbul', '2026-10-04T22:00:00Z', '2026-10-05', '2026-10-11', 1],
    ['America/New_York', '2026-11-02T04:30:00Z', '2026-11-02', '2026-11-08', 0]
] as const)('uses journal dates for cold and cached history in %s', async (timezone, date, since, end, count) => {
    const app = await workspace()
    try {
        await app.store.saveSettings({ ...app.store.config.settings, timezone: timezone })
        await app.git('commit', '--allow-empty', `--date=${date}`, '-m', 'Week boundary')
        await run(app.service.refresh({ source: 'git', since }))
        const visible = async () =>
            rangeActivities(await journalState(app.store), since, end).filter(
                (activity) => activity.title === 'Week boundary'
            )
        expect(await visible()).toHaveLength(count)
        // Read the same durable cache again; acquisition must not depend on renderer records.
        await run(app.service.handle({ type: 'loadWeek', since }))
        expect(await visible()).toHaveLength(count)
    } finally {
        await app.close()
    }
})
it('gives a small repository its first batch before continuing a paginated history', async () => {
    const app = await workspace()
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        app.repository.remotes = []
        await app.store.saveRepository(app.repository)
        const path = join(app.directory, 'small-repo')
        await mkdir(path)
        await cp(join(app.directory, '.git'), join(path, '.git'), { recursive: true })
        const small = { ...app.repository, id: 'small-repo', path }
        await app.store.saveRepository(small)
        const importer = spawn('git', ['fast-import', '--quiet'], {
            cwd: app.repository.path,
            windowsHide: true,
            stdio: ['pipe', 'ignore', 'inherit']
        })
        const done = once(importer, 'close')
        const commits = Array.from({ length: 40 }, (_, index) => {
            const message = `Batch ${index}`
            return (
                `commit refs/heads/batch-fixture\nmark :${index + 1}\n` +
                'committer Tester <first@example.com> 1791360000 +0000\n' +
                `data ${Buffer.byteLength(message)}\n${message}\n\n`
            )
        }).join('')
        // More than 25 refs sharing 40 commits exceed the membership page budget.
        const refs = Array.from({ length: 25 }, (_, index) => `reset refs/heads/batch-${index}\nfrom :40\n\n`).join('')
        importer.stdin.end(commits + refs + 'done\n')
        expect((await done)[0]).toBe(0)
        await run(app.service.handle({ type: 'refresh', source: 'git', since: '2020-01-01' }))
        const calls = index.mock.calls
        expect(
            calls
                .slice(0, 2)
                .map(([repository]) => repository.id)
                .sort()
        ).toEqual([app.repository.id, small.id].sort())
        expect(
            calls
                .slice(2)
                .some(
                    ([repository, , , , , , , cursor]) =>
                        repository.id === app.repository.id && cursor?.phase === 'membership'
                )
        ).toBe(true)
        const { acquisition } = await journalState(app.store)
        for (const repository of [app.repository, small])
            expect(acquisition?.[`git:${repository.id}`]).toMatchObject({
                status: 'idle',
                historySince: '2020-01-01'
            })
    } finally {
        index.mockRestore()
        await app.close()
    }
})
it('does not coalesce a timezone change into an in-flight scan using the previous timezone', async () => {
    const app = await workspace()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const entered = deferred<undefined>()
    app.remote.github = true
    app.remote.beforeRequest = (url) => {
        if (!url.includes('/pulls?')) return Promise.resolve()
        entered.resolve(undefined)
        return gate
    }
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'UTC' })
        await app.git('commit', '--allow-empty', '--date=2026-10-04T22:00:00Z', '-m', 'In-flight timezone boundary')
        first = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        await Promise.race([
            entered.promise,
            first.then(() => {
                throw new Error('Week completed without reaching the provider')
            })
        ])
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'Europe/Istanbul' })
        second = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        release()
        await Promise.all([first, second])
        expect(
            rangeActivities(await journalState(app.store), '2026-10-05', '2026-10-11')
                .filter((activity) => activity.kind === 'commit')
                .map((activity) => activity.title)
        ).toEqual(['In-flight timezone boundary'])
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].historyTimezone).toBe(
            'Europe/Istanbul'
        )
    } finally {
        release()
        await Promise.all([first, second])
        await app.close()
    }
})

it('resumes due queue and unassigned connection waits without a history window and prioritizes staged pages', () => {
    const state = {
        repositories: [
            hubRepository(0, { id: 'queued', remote: 'https://github.com/example/queued' }),
            hubRepository(1, { id: 'unassigned', remote: 'https://github.com/example/unassigned' }),
            hubRepository(2, { id: 'staged', remote: 'https://github.com/example/staged' }),
            hubRepository(3, { id: 'removed', removed: true })
        ],
        acquisition: {
            'remote:queued': {
                status: 'paused' as const,
                retryAt: '2026-10-30T12:00:00Z',
                pauseReason: 'queue' as const
            },
            'remote:unassigned': {
                status: 'paused' as const,
                retryAt: '2026-10-30T12:00:00Z',
                pauseReason: 'connection' as const
            },
            'remote:staged': {
                status: 'idle' as const,
                windowEnd: '2026-10-30T12:00:00Z',
                pending: { key: 'page', pages: {} }
            },
            'remote:removed': { status: 'paused' as const, retryAt: '2026-10-30T12:00:00Z' }
        }
    }
    const eligible = {
        ...state,
        accounts: [
            {
                id: 'account',
                provider: 'github' as const,
                host: 'github.com' as const,
                userId: '1',
                username: 'fixture',
                emails: [],
                generation: 1,
                status: 'connected' as const
            }
        ]
    }
    const now = Date.parse('2026-10-30T12:01:00Z')
    expect(nextAcquisition(eligible, now)?.[0]).toBe('remote:staged')
    expect(nextAcquisition({ ...eligible, accounts: [] }, now)).toBeUndefined()
    state.acquisition['remote:staged'].windowEnd = ''
    expect(nextAcquisition(eligible, now)?.[0]).toBe('remote:queued')
    state.acquisition['remote:queued'].retryAt = '2026-10-30T12:02:00Z'
    expect(nextAcquisition(eligible, now)?.[0]).toBe('remote:unassigned')
    state.acquisition['remote:unassigned'].retryAt = '2026-10-30T12:02:00Z'
    expect(nextAcquisition(eligible, now)).toBeUndefined()
})

it('settles covered history after reopening and resumes its retained cursor for an earlier week', async () => {
    const app = await workspace()
    let reopened: JournalDatabase | undefined
    const index = vi.spyOn(gitModule, 'indexCommits')
    try {
        await app.store.saveRepository({ ...app.repository, trackingStart: '2026-10-05' })
        await app.git('commit', '--allow-empty', '--date=2020-01-07T12:00:00Z', '-m', 'Earlier retained work')
        await run(app.service.refresh({ source: 'git' }))
        const key = 'git:' + app.repository.id
        const status = app.store.config.acquisition[key]
        const cursor = { phase: 'body' as const, offset: 0, group: 0, alias: 0 }
        const windowEnd = new Date().toISOString()
        await app.store.saveCheckpoint(key, { ...status, status: 'idle', windowEnd, gitCursor: cursor })
        reopened = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
        const store = reopened
        const service = await journalClient(
            store,
            app.github,
            app.notion,
            () => ({ remote: false, notion: false, protectedStorage: false }),
            app.requests
        )
        index.mockClear()
        await run(service.handle({ type: 'loadWeek', since: status.historySince! }))
        expect(index).not.toHaveBeenCalled()
        expect(store.config.acquisition[key]).toMatchObject({ status: 'idle', windowEnd, gitCursor: cursor })
        expect((await journalState(store)).activities.map((activity) => activity.title)).not.toContain(
            'Earlier retained work'
        )
        await run(service.handle({ type: 'loadWeek', since: '2020-01-06' }))
        expect((await journalState(store)).activities.map((activity) => activity.title)).toContain(
            'Earlier retained work'
        )
        expect(store.config.acquisition[key]).toMatchObject({ status: 'idle', historySince: '2020-01-06' })
        expect(store.config.acquisition[key].gitCursor).toBeUndefined()
        expect(store.config.acquisition[key].windowEnd).toBeUndefined()
    } finally {
        index.mockRestore()
        await reopened?.close()
        await app.close()
    }
})
