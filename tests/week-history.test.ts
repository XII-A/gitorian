import { cp, mkdir } from 'node:fs/promises'
import { journalState } from './database-fixtures'
import { GitHubFailure } from '../src/main/github'
import { Effect } from 'effect'
import { run, journalClient } from './effect-fixtures'
import { expect, it, vi } from 'vitest'
import { workspace } from './fixtures'
import * as gitModule from '../src/main/git'
import { JournalDatabase } from '../src/main/journal-database'
import { join } from 'node:path'
import { rangeActivities } from '../src/renderer/hub-model'
it('loads newly imported repositories when an earlier request for the same week is still running', async () => {
    const app = await workspace()
    const imported = await workspace()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const original = gitModule.indexCommits
    const index = vi.spyOn(gitModule, 'indexCommits').mockImplementationOnce(async (...args) => {
        await gate
        return original(...args)
    })
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
        await imported.git('commit', '--allow-empty', '--date=2026-10-06T12:00:00Z', '-m', 'Imported project work')
        expect(await app.git('log', '--format=%s')).not.toContain('Imported project work')
        first = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        await vi.waitFor(() => expect(index).toHaveBeenCalledTimes(1))
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
        index.mockRestore()
        await Promise.all([app.close(), imported.close()])
    }
})
it('loads all five local sources and an earlier requested week while GitHub is blocked', async () => {
    const app = await workspace()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
        release = resolve
    })
    const github = vi.spyOn(app.github, 'activities').mockImplementation((_repo, _login, _tracked, scan) =>
        Effect.gen(function* () {
            yield* Effect.promise(() => held)
            yield* scan?.checkpoint?.(1, true) ?? Effect.void
            return []
        }).pipe(Effect.mapError((error) => new GitHubFailure(error.message, { cause: error })))
    )
    let pending: Promise<void> | undefined
    let earlier: Promise<unknown> | undefined
    try {
        app.remote.github = true
        {
            app.repository.trackingStart = '2099-01-01'
            await app.store.saveRepository(app.repository)
        }
        for (let i = 1; i < 5; i++) {
            const path = join(app.directory, `repo-${i}`)
            await mkdir(path)
            await cp(join(app.directory, '.git'), join(path, '.git'), { recursive: true })
            await app.store.saveRepository({ ...app.repository, id: `repo-${i}`, path })
        }
        pending = run(app.service.refresh())
        await vi.waitFor(
            async () => {
                const local = Object.entries((await journalState(app.store)).acquisition ?? {}).filter(
                    ([key, value]) => key.startsWith('git:') && value.lastSuccess
                )
                expect(local).toHaveLength(5)
            },
            { timeout: 10000 }
        )
        expect((await journalState(app.store)).activities).toHaveLength(0)
        expect(github).toHaveBeenCalledTimes(2)
        earlier = run(app.service.handle({ type: 'loadWeek', since: '2020-01-01' }))
        await vi.waitFor(
            async () =>
                expect(
                    (await journalState(app.store)).activities.filter((activity) => activity.kind === 'commit')
                ).toHaveLength(5),
            { timeout: 10000 }
        )
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].historySince).toBe(
            '2020-01-01'
        )
    } finally {
        release()
        await Promise.all([pending, earlier])
        github.mockRestore()
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
                github: false,
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
it('gives all five repositories a first batch before continuing the first two large histories', async () => {
    const app = await workspace()
    const index = vi.spyOn(gitModule, 'indexCommits')
    const order: {
        id: string
        offset: number
    }[] = []
    try {
        {
            app.repository.remotes = []
            await app.store.saveRepository(app.repository)
        }
        for (let i = 1; i < 5; i++) {
            const path = join(app.directory, `repo-${i}`)
            await mkdir(path)
            await cp(join(app.directory, '.git'), join(path, '.git'), { recursive: true })
            await app.store.saveRepository({ ...app.repository, id: `repo-${i}`, path })
        }
        const large = new Set(
            (await journalState(app.store)).repositories.slice(0, 2).map((repository) => repository.id)
        )
        index.mockImplementation(async (repository, _previous, _since, offset = 0) => {
            order.push({ id: repository.id, offset })
            await Promise.resolve()
            return {
                refs: { main: 'a'.repeat(40) },
                items: [],
                history: [],
                nextOffset: large.has(repository.id) && !offset ? 2000 : undefined
            }
        })
        await run(app.service.handle({ type: 'refresh', source: 'git', since: '2020-01-01' }))
        expect(new Set(order.slice(0, 5).map((batch) => batch.id)).size).toBe(5)
        expect(order.slice(0, 5).every((batch) => batch.offset === 0)).toBe(true)
        expect(order.filter((batch) => batch.offset === 2000)).toHaveLength(2)
        for (const repository of (await journalState(app.store)).repositories)
            expect((await journalState(app.store)).acquisition?.[`git:${repository.id}`]).toMatchObject({
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
    const original = gitModule.indexCommits
    const index = vi.spyOn(gitModule, 'indexCommits').mockImplementationOnce(async (...args) => {
        await gate
        return original(...args)
    })
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'UTC' })
        await app.git('commit', '--allow-empty', '--date=2026-10-04T22:00:00Z', '-m', 'In-flight timezone boundary')
        first = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        await vi.waitFor(() => expect(index).toHaveBeenCalledTimes(1))
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'Europe/Istanbul' })
        second = run(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        release()
        await Promise.all([first, second])
        expect(
            rangeActivities(await journalState(app.store), '2026-10-05', '2026-10-11').map((activity) => activity.title)
        ).toEqual(['In-flight timezone boundary'])
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].historyTimezone).toBe(
            'Europe/Istanbul'
        )
    } finally {
        release()
        await Promise.all([first, second])
        index.mockRestore()
        await app.close()
    }
})
