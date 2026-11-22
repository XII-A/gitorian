import { DatabaseSync } from 'node:sqlite'
import { http as route } from 'msw'
import { setupServer } from 'msw/node'
import { deferred } from './deferred'
import { nextAcquisition } from '../src/shared/acquisition'
import { sourceProblems } from '../src/renderer/background-work'
import { remoteConfiguration } from '../src/shared/provider-accounts'
import type { ActivityScan } from '../src/main/contribution-reader'
import type { Activity } from '../src/shared/model'
import { journalState } from './database-fixtures'
import { makeGitHub } from '../src/main/github'
import { Effect } from 'effect'
import { run, journalClient, githubClient, transportClient } from './effect-fixtures'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { Repository } from '../src/shared/model'
import { WorkQueue } from '../src/main/work-queue'
import { journal, workspace, transport } from './fixtures'
import { JournalDatabase } from '../src/main/journal-database'
import { join } from 'node:path'
import * as gitModule from '../src/main/git'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
it('pauses a missing local folder without repeated Git failures and resumes when it returns', async () => {
    const app = await workspace()
    const original = app.repository.path
    try {
        app.remote.github = true
        const remoteReads = () => app.remote.requests.filter((request) => request.url.includes('/pulls?')).length
        await app.store.updateRepositoryLocation({ ...app.repository, path: join(original, 'missing-folder') })
        const read = vi.spyOn(gitModule, 'indexCommits')
        await run(app.service.refresh())
        expect(remoteReads()).toBeGreaterThan(0)
        const missing = (await journalState(app.store)).acquisition?.[`git:${app.repository.id}`]
        expect(missing?.pauseReason).toBe('folder')
        expect(missing?.error).toBeUndefined()
        expect(app.store.config.repositories[0].available).toBe(false)
        await run(app.service.refresh({ source: 'git' }))
        expect(read).not.toHaveBeenCalled()
        expect((await journalState(app.store)).refreshError).toBeUndefined()
        await app.store.updateRepositoryLocation({ ...app.repository, path: original, available: false })
        await run(app.service.refresh({ source: 'git' }))
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].status).toBe('idle')
        expect(app.store.config.repositories[0].available).toBe(true)
    } finally {
        await app.close()
    }
})
it('keeps an existing folder with a Git failure actionable as an error', async () => {
    const app = await workspace()
    const nonRepository = await journal()
    try {
        await app.store.updateRepositoryLocation({ ...app.repository, path: nonRepository.directory })
        await run(app.service.refresh({ source: 'git' }))
        const status = (await journalState(app.store)).acquisition?.['git:' + app.repository.id]
        expect(status?.status).toBe('error')
        expect(status?.pauseReason).not.toBe('folder')
        expect(app.store.config.repositories[0].available).toBe(true)
    } finally {
        await Promise.all([app.close(), nonRepository.close()])
    }
})
it.each(['Settings', 'folder import', 'disconnected account'])(
    'resumes both sources when %s re-enables a repository stopped from activity recovery',
    async (entry) => {
        const app = await workspace()
        app.remote.github = true
        const remoteReads = () => app.remote.requests.filter((request) => request.url.includes('/pulls?')).length
        try {
            await run(app.service.refresh())
            const previousReads = remoteReads()
            await run(app.service.handle({ type: 'repositoryTracking', id: app.repository.id, tracked: false }))
            const stopped = (await journalState(app.store)).acquisition
            expect(stopped?.[`git:${app.repository.id}`].status).toBe('cancelled')
            expect(stopped?.[`remote:${app.repository.id}`].status).toBe('cancelled')
            if (entry === 'disconnected account') app.remote.github = false
            if (entry !== 'folder import') {
                await run(app.service.handle({ type: 'repository', repository: { ...app.repository, removed: false } }))
            } else {
                const scan = await run(app.service.scanRepositories(app.directory))
                await run(app.service.importRepositories(scan.repositoryScan!.id, [app.repository.path]))
            }
            if (entry === 'disconnected account') {
                expect((await journalState(app.store)).acquisition?.[`remote:${app.repository.id}`].status).toBe('idle')
                app.remote.github = true
                await run(app.service.refresh())
            }
            await vi.waitFor(async () => {
                const resumed = (await journalState(app.store)).acquisition
                expect(resumed?.[`git:${app.repository.id}`].status).toBe('idle')
                expect(resumed?.[`remote:${app.repository.id}`].status).toBe('idle')
            })
            expect(remoteReads()).toBeGreaterThan(previousReads)
        } finally {
            await app.close()
        }
    }
)
const repository: Repository = {
    id: 'repo',
    name: 'Project',
    path: '',
    remote: 'https://github.com/example/project',
    base: 'main',
    trackingStart: '2026-10-05',
    emails: ['me@example.com'],
    available: true,
    removed: false,
    branchBases: {},
    branches: []
}
function holdPulls(app: Awaited<ReturnType<typeof journal>>, shouldHold: (url: string) => boolean) {
    const gate = deferred<undefined>()
    const reads: string[] = []
    app.remote.beforeRequest = (url) => {
        if (!url.includes('/pulls?')) return Promise.resolve()
        reads.push(url)
        return shouldHold(url) ? gate.promise : Promise.resolve()
    }
    app.remote.responseFor = (url) => (url.includes('/pulls?') ? Response.json([]) : undefined)
    return { reads, release: () => gate.resolve(undefined) }
}
it('settles an accepted source when its repository is removed before batch admission', async () => {
    const app = await journal()
    const admitted = deferred<undefined>()
    app.remote.github = true
    const account = app.store.config.accounts[0]
    for (const id of ['repo-0', 'repo-1', 'repo-2'])
        await app.store.saveRepository({
            ...repository,
            id,
            remote: 'https://github.com/example/' + id,
            accountId: account.id,
            accountGeneration: account.generation
        })
    const { reads, release } = holdPulls(app, () => {
        admitted.resolve(undefined)
        return true
    })
    let pending: Promise<void> | undefined
    try {
        pending = run(app.service.refresh({ source: 'remote' }))
        await Promise.race([
            admitted.promise,
            pending.then(() => {
                throw new Error('Refresh completed before a source was admitted')
            })
        ])
        await app.store.saveRepository({ ...app.store.config.repositories[2], removed: true })
        release()
        await pending
        await app.store.saveRepository({ ...app.store.config.repositories[2], removed: false })
        expect((await journalState(app.store)).acquisition?.['remote:repo-2'].status).toBe('idle')
        expect(reads.filter((url) => url.includes('/repo-2/'))).toEqual([])
    } finally {
        release()
        await pending
        await app.close()
    }
})
it.each([false, true])(
    'honors pause then explicit resume while older requests are pending: %s',
    async (resumeWhilePending) => {
        const app = await journal()
        const admitted = deferred<undefined>()
        app.remote.github = true
        const account = app.store.config.accounts[0]
        await app.store.saveRepository({ ...repository, accountId: account.id, accountGeneration: account.generation })
        const { reads, release } = holdPulls(app, () => {
            admitted.resolve(undefined)
            return true
        })
        let active: Promise<void> | undefined
        let retry: Promise<void> | undefined
        let resumed: Promise<void> | undefined
        try {
            active = run(app.service.refresh({ source: 'remote' }))
            await Promise.race([
                admitted.promise,
                active.then(() => {
                    throw new Error('Refresh finished before the provider was reached')
                })
            ])
            retry = run(app.service.refresh({ repositoryId: repository.id, source: 'remote', resume: true }))
            await run(app.service.stopWork('remote', repository.id))
            if (resumeWhilePending)
                resumed = run(app.service.refresh({ repositoryId: repository.id, source: 'remote', resume: true }))
            release()
            await Promise.all([active, retry, resumed])
            if (!resumeWhilePending) {
                expect(reads).toHaveLength(1)
                expect((await journalState(app.store)).acquisition?.['remote:repo'].status).toBe('cancelled')
                await run(app.service.refresh({ repositoryId: repository.id, source: 'remote', resume: true }))
            }
            expect(reads).toHaveLength(2)
            expect((await journalState(app.store)).acquisition?.['remote:repo'].status).toBe('idle')
        } finally {
            release()
            await Promise.all([active, retry, resumed])
            await app.close()
        }
    }
)
it('retains pause identity for a completed source while another source keeps the refresh pending', async () => {
    const app = await journal()
    app.remote.github = true
    const account = app.store.config.accounts[0]
    for (const id of ['fast', 'held'])
        await app.store.saveRepository({
            ...repository,
            id,
            remote: 'https://github.com/example/' + id,
            accountId: account.id,
            accountGeneration: account.generation
        })
    const { reads, release } = holdPulls(app, (url) => url.includes('/held/'))
    let first: Promise<void> | undefined
    let resumed: Promise<void> | undefined
    try {
        first = run(app.service.refresh({ source: 'remote', resume: true }))
        await vi.waitFor(async () =>
            expect((await journalState(app.store)).acquisition?.['remote:fast'].status).toBe('idle')
        )
        await run(app.service.stopWork('remote', 'fast'))
        resumed = run(app.service.refresh({ source: 'remote', resume: true }))
        release()
        await Promise.all([first, resumed])
        expect(reads.filter((url) => url.includes('/fast/'))).toHaveLength(2)
        expect((await journalState(app.store)).acquisition?.['remote:fast'].status).toBe('idle')
    } finally {
        release()
        await Promise.all([first, resumed])
        await app.close()
    }
})
it('stops before enriching old unrelated PR history', async () => {
    const requests: string[] = []
    server.use(
        route.get('https://api.github.com/repos/example/project/pulls', ({ request }) => {
            const url = request.url
            requests.push(url)
            const pulls = Array.from({ length: 100 }, (_, index) => ({
                number: index + 1,
                title: 'Old work',
                body: '',
                html_url: '',
                created_at: '2020-01-01T00:00:00Z',
                updated_at: '2020-01-01T00:00:00Z',
                merged_at: null,
                merge_commit_sha: null,
                user: { login: 'other' },
                base: { ref: 'main', sha: 'b'.repeat(40) },
                head: { ref: 'feature', sha: 'a'.repeat(40) }
            }))
            const value = url.includes('/pulls?')
                ? url.includes('page=1&') || url.endsWith('page=1')
                    ? pulls
                    : []
                : /\/(commits|reviews|files)\?/.test(url)
                  ? []
                  : pulls[0]
            return Response.json(value)
        })
    )
    const github = await githubClient(await transportClient(), () => 'test')
    expect(await run(github.activities(repository, 'me', []))).toEqual([])
    expect(requests).toHaveLength(1)
})
it('reconsiders completed GitHub coverage when the journal timezone changes', async () => {
    const app = await workspace()
    try {
        {
            app.repository.trackingStart = '2026-10-05'
            await app.store.saveRepository(app.repository)
        }
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'UTC' })
        const http = await transportClient(async (input, init) => {
            const response = await app.remote.fetch(input, init)
            const url = input instanceof Request ? input.url : String(input)
            if (!url.includes('/pulls?')) return response
            const pulls = (await response.json()) as {
                updated_at: string
            }[]
            pulls[0].updated_at = '2026-10-04T22:00:00Z'
            return new Response(JSON.stringify(pulls))
        })
        const service = await journalClient(
            app.store,
            await githubClient(http, () => 'test'),
            app.notion,
            () => ({
                remote: true,
                notion: false,
                protectedStorage: false
            }),
            app.requests
        )
        await run(service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        expect((await journalState(app.store)).activities.some((activity) => activity.kind === 'change-request')).toBe(
            false
        )
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'Europe/Istanbul' })
        await run(service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        expect((await journalState(app.store)).activities.some((activity) => activity.kind === 'change-request')).toBe(
            true
        )
        expect((await journalState(app.store)).acquisition?.[`remote:${app.repository.id}`].historyTimezone).toBe(
            'Europe/Istanbul'
        )
    } finally {
        await app.close()
    }
})
it('recognizes secondary throttling even with primary quota remaining', async () => {
    const url = 'https://api.github.com/repos/example/project'
    let requests = 0
    server.use(
        route.get(url, () => {
            requests++
            return Response.json(
                { message: 'You have exceeded a secondary rate limit.' },
                {
                    status: 403,
                    headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4000' }
                }
            )
        })
    )
    const http = await transportClient()
    await expect(run(http.request(url, 'test'))).rejects.toThrow()
    await expect(run(http.request(url, 'test'))).rejects.toThrow()
    expect(requests).toBe(1)
})
it('uses conditional reads and shares simultaneous readers without mixing credentials', async () => {
    const attempts: {
        token: string | null
        etag: string | null
    }[] = []
    const http = await transportClient((_url, init) => {
        const headers = new Headers(init?.headers)
        attempts.push({ token: headers.get('Authorization'), etag: headers.get('If-None-Match') })
        if (headers.get('If-None-Match')) return Promise.resolve(new Response(null, { status: 304 }))
        return Promise.resolve(
            new Response(JSON.stringify({ private: headers.get('Authorization') }), { headers: { etag: 'version' } })
        )
    })
    const url = 'https://api.github.com/repos/example/project'
    const first = await Promise.all([run(http.request(url, 'one')), run(http.request(url, 'one'))])
    expect(attempts).toHaveLength(1)
    expect(first[0]).toEqual(first[1])
    expect(await run(http.request(url, 'one'))).toEqual(first[0])
    await run(http.request(url, 'two'))
    expect(attempts.map((attempt) => attempt.etag)).toEqual([null, 'version', null])
})
it('admits foreground work ahead of queued backfill and bounds concurrency', async () => {
    const queue = new WorkQueue(1)
    const order: string[] = []
    let release: (() => void) | undefined
    const first = queue.run(
        () =>
            new Promise<void>((done) => {
                release = done
            })
    )
    const background = queue.run(() => {
        order.push('background')
        return Promise.resolve()
    })
    const foreground = queue.run(() => {
        order.push('foreground')
        return Promise.resolve()
    }, 1)
    expect(order).toEqual([])
    release!()
    await Promise.all([first, background, foreground])
    expect(order).toEqual(['foreground', 'background'])
})
it('preserves credential-scoped throttle pauses across transport restart', async () => {
    const pauses = {}
    let requests = 0
    server.use(
        route.get('https://api.github.com/user', () => {
            requests++
            return Response.json({}, { status: 429, headers: { 'retry-after': '60' } })
        })
    )
    const store = { pauses: () => pauses, changed: vi.fn() }
    await expect(
        run((await transportClient(undefined, store)).request('https://api.github.com/user', 'one'))
    ).rejects.toThrow('429')
    await expect(
        run((await transportClient(undefined, store)).request('https://api.github.com/user', 'one'))
    ).rejects.toThrow('paused')
    expect(requests).toBe(1)
    await expect(
        run((await transportClient(undefined, store)).request('https://api.github.com/user', 'two'))
    ).rejects.toThrow('429')
    expect(requests).toBe(2)
})
it('repeated refresh skips unchanged PR enrichment and unchanged Git histories', async () => {
    const app = await workspace()
    const log = vi.spyOn(gitModule, 'indexCommits')
    try {
        app.remote.github = true
        await run(app.service.refresh())
        const refs = (await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].refs
        const start = app.remote.requests.length
        await run(app.service.refresh())
        const github = app.remote.requests.slice(start).filter((request) => request.url.includes('api.github.com'))
        expect(
            github.filter((request) => /\/(commits|reviews|files|compare)(?:[/?]|$)/.test(request.url))
        ).toHaveLength(0)
        expect(github.some((request) => request.url.includes('/pulls?'))).toBe(true)
        expect(log.mock.calls.at(-1)?.[1]).toEqual(refs)
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].refs).toEqual(refs)
        const beforeHistory = app.remote.requests.length
        await run(app.service.handle({ type: 'refresh', since: '2020-01-01' }))
        expect(
            app.remote.requests.slice(beforeHistory).filter((request) => request.url.includes('/pulls?'))
        ).toHaveLength(1)
        expect(
            (await journalState(app.store)).activities.some(
                (activity) => activity.kind === 'review' && activity.date.startsWith('2026-10-07')
            )
        ).toBe(true)
    } finally {
        log.mockRestore()
        await app.close()
    }
})
it('loads hub file metadata without acquiring a patch and coalesces workspace diff reads', async () => {
    const app = await workspace()
    const read = vi.spyOn(gitModule, 'commitDetails')
    try {
        await run(app.service.refresh())
        const activity = (await journalState(app.store)).activities.find((item) => item.kind === 'commit')!
        await run(app.service.handle({ type: 'details', activityId: activity.id, content: 'files' }))
        expect((await journalState(app.store)).diffs[activity.id]).toBeUndefined()
        expect(read.mock.calls[0][2]).toBe(false)
        read.mockClear()
        const result = await Promise.all([
            run(app.service.handle({ type: 'details', activityId: activity.id })),
            run(app.service.handle({ type: 'details', activityId: activity.id }))
        ])
        expect(read).toHaveBeenCalledTimes(1)
        expect(result[0].diff).toContain('initial')
        await run(app.service.handle({ type: 'details', activityId: activity.id }))
        expect(read).toHaveBeenCalledTimes(1)
    } finally {
        read.mockRestore()
        await app.close()
    }
})
it('keeps patch bodies out of snapshots and retains patches and checkpoints after restart', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await run(app.service.refresh())
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'change-request')!
        await run(app.service.handle({ type: 'details', activityId: pr.id }))
        expect((await run(app.service.reply())).state.diffs).toEqual({})
        expect((await run(app.service.reply())).state.revisions.every((item) => item.diff === '')).toBe(true)
        const patch = (await journalState(app.store)).diffs[pr.id]
        const versions = structuredClone(
            (await journalState(app.store)).acquisition?.[`remote:${app.repository.id}`].versions
        )
        await app.store.close()
        const reopened = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
        try {
            expect((await journalState(reopened)).diffs[pr.id]).toBe(patch)
            expect((await journalState(reopened)).acquisition?.[`remote:${app.repository.id}`].versions).toEqual(
                versions
            )
        } finally {
            await reopened.close()
        }
    } finally {
        await app.close()
    }
})
it('retains successful PR batches when a later PR fails and skips them on retry', async () => {
    const remote = transport()
    const original = remote.fetch
    let fail = true
    let firstReads = 0
    const http = await transportClient(async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.includes('/pulls?')) {
            const response = await original(input, init)
            const pulls = (await response.json()) as {
                number: number
            }[]
            return new Response(JSON.stringify([pulls[0], { ...pulls[0], number: 2 }]))
        }
        if (url.includes('/pulls/1/commits')) firstReads++
        if (fail && url.includes('/pulls/2/reviews')) return new Response('{}', { status: 403 })
        return original(input, init)
    })
    const github = await githubClient(http, () => 'test')
    const versions: Record<string, string> = {}
    const captured: string[] = []
    const scan = {
        versions,
        batch: (
            items: {
                id: string
            }[]
        ) => {
            return Effect.sync(() => {
                captured.push(...items.map((item) => item.id))
            })
        }
    }
    await expect(run(github.activities(repository, 'me', [], scan))).rejects.toThrow('403')
    expect(captured).toContain('repo:pr:1')
    expect(versions['1']).toBeDefined()
    expect(versions['2']).toBeUndefined()
    fail = false
    await run(github.activities(repository, 'me', [], scan))
    expect(firstReads).toBe(1)
    expect(captured).toContain('repo:pr:2')
})
it('bounds contribution reads and resumes from durable pending pages', async () => {
    let calls = 0
    const pulls = Array.from({ length: 100 }, (_, index) => ({
        number: index + 1,
        title: 'My work',
        body: '',
        html_url: '',
        created_at: '2026-10-06T00:00:00Z',
        updated_at: '2026-10-06T00:00:00Z',
        merged_at: null,
        merge_commit_sha: null,
        user: { login: 'me' },
        base: { ref: 'main', sha: 'b'.repeat(40) },
        head: { ref: 'feature', sha: 'a'.repeat(40) }
    }))
    const github = await githubClient(
        await transportClient((input) => {
            calls++
            const url = input instanceof Request ? input.url : String(input)
            return Promise.resolve(
                new Response(JSON.stringify(url.includes('/pulls?') && url.endsWith('page=1') ? pulls : []))
            )
        }),
        () => 'test'
    )
    const versions: Record<string, string> = {}
    const batches: Activity[] = []
    let pending: ActivityScan['pending']
    const scan = () => ({
        versions,
        pending,
        savePending: (value: typeof pending) =>
            Effect.sync(() => {
                pending = value
            }),
        batch: (items: Activity[]) =>
            Effect.sync(() => {
                batches.push(...items)
            })
    })
    await expect(run(github.activities(repository, 'me', [], scan()))).rejects.toMatchObject({ status: 429 })
    expect(calls).toBe(25)
    expect(batches.filter((item) => item.kind === 'change-request')).toHaveLength(12)
    await expect(run(github.activities(repository, 'me', [], scan()))).rejects.toMatchObject({ status: 429 })
    expect(calls).toBe(50)
    expect(new Set(batches.filter((item) => item.kind === 'change-request').map((item) => item.id)).size).toBe(24)
})
it('a user pause survives scheduled refresh and explicit retry resumes it', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await run(app.service.refresh())
        await run(app.service.stopWork('remote', app.repository.id))
        expect((await journalState(app.store)).acquisition?.[`remote:${app.repository.id}`].error).toBeUndefined()
        const start = app.remote.requests.length
        await run(app.service.refresh({ repositoryId: app.repository.id, source: 'remote' }))
        expect(app.remote.requests).toHaveLength(start)
        expect((await journalState(app.store)).acquisition?.[`remote:${app.repository.id}`].status).toBe('cancelled')
        await run(app.service.refresh({ repositoryId: app.repository.id, source: 'remote', resume: true }))
        expect(
            app.remote.requests
                .slice(start)
                .filter((request) => /\/(commits|reviews|files|compare)(?:[/?]|$)/.test(request.url))
        ).toHaveLength(0)
        expect((await journalState(app.store)).acquisition?.[`remote:${app.repository.id}`].status).toBe('idle')
    } finally {
        await app.close()
    }
})
it('discovers a new review on an old PR without importing its old milestones', async () => {
    const remote = transport()
    const github = await githubClient(
        await transportClient(async (input, init) => {
            const response = await remote.fetch(input, init)
            const url = input instanceof Request ? input.url : String(input)
            if (!url.includes('/pulls?')) return response
            const pulls = (await response.json()) as {
                created_at: string
            }[]
            pulls[0].created_at = '2020-01-01T00:00:00Z'
            return new Response(JSON.stringify(pulls))
        }),
        () => 'test'
    )
    const activities = await run(github.activities(repository, 'me', []))
    expect(activities.some((item) => item.kind === 'review')).toBe(true)
    expect(activities.some((item) => item.kind === 'opened')).toBe(false)
})
it('indexes only new commit bodies after ref changes and updates known branch membership', async () => {
    const app = await workspace()
    try {
        // This scenario owns ref deltas, not week filtering. Local midnight
        // must not exclude a fixture commit whose author date is still yesterday in UTC.
        const since = '2000-01-01'
        const first = await gitModule.indexCommits(app.repository, {}, since)
        await app.git('commit', '--allow-empty', '-m', 'Incremental work')
        const incremental = await gitModule.indexCommits(app.repository, first.refs, since)
        expect(incremental.items.map((item) => item.title)).toEqual(['Incremental work'])
        await app.git('branch', 'new-branch')
        const branch = await gitModule.indexCommits(app.repository, incremental.refs, since, 0, [])
        expect(
            branch.memberships?.some(
                (group) => group.branches.includes('new-branch') && group.shas.includes(incremental.items[0].sha!)
            )
        ).toBe(true)
    } finally {
        await app.close()
    }
})
it('queues and coalesces an explicit source retry behind active acquisition', async () => {
    const app = await workspace()
    const admitted = deferred<undefined>()
    const { reads, release } = holdPulls(app, () => {
        admitted.resolve(undefined)
        return true
    })
    try {
        app.remote.github = true
        const active = run(app.service.refresh({ source: 'remote' }))
        await Promise.race([
            admitted.promise,
            active.then(() => {
                throw new Error('Refresh finished before the provider was reached')
            })
        ])
        const retry = run(app.service.refresh({ repositoryId: app.repository.id, source: 'remote', resume: true }))
        const duplicate = run(app.service.refresh({ repositoryId: app.repository.id, source: 'remote', resume: true }))
        expect(reads).toHaveLength(1)
        release()
        await Promise.all([active, retry, duplicate])
        expect(reads).toHaveLength(2)
    } finally {
        release()
        await app.close()
    }
})

it('resumes large PR review history from independently reloaded durable pages without replay', async () => {
    const app = await workspace()
    let calls = 0
    const client = makeGitHub(<A>(url: string) =>
        Effect.sync(() => {
            calls++
            const page = Number(new URL(url).searchParams.get('page') ?? 1)
            const value: unknown = url.includes('/pulls?')
                ? [
                      {
                          number: 1,
                          title: 'Large work',
                          body: '',
                          html_url: 'https://github.com/example/project/pull/1',
                          created_at: '2026-10-06T00:00:00Z',
                          updated_at: '2026-10-06T00:00:00Z',
                          user: { login: 'me' },
                          base: { ref: 'main', sha: 'b'.repeat(40) },
                          head: { ref: 'feature', sha: 'a'.repeat(40) }
                      }
                  ]
                : url.includes('/reviews?') && page <= 26
                  ? Array.from({ length: 100 }, (_, i) => ({
                        id: page * 100 + i,
                        user: { login: 'other' },
                        submitted_at: '2026-10-06T00:00:00Z',
                        state: 'COMMENTED',
                        body: 'Review',
                        html_url: ''
                    }))
                  : []
            return value as A
        })
    )
    app.repository.trackingStart = '2020-01-01'
    const key = `remote:${app.repository.id}`
    let pending: ActivityScan['pending']
    const versions: Record<string, string> = {}
    const scan = (): ActivityScan => ({
        versions,
        pending,
        savePending: (value) =>
            Effect.tryPromise({
                try: async () => {
                    pending = value
                    await app.store.saveCheckpoint(key, { status: 'running', pending, versions })
                },
                catch: (error) => (error instanceof Error ? error : new Error(String(error)))
            })
    })
    try {
        await expect(run(client.activities(app.repository, 'me', [], scan()))).rejects.toMatchObject({ status: 429 })
        expect(calls).toBe(25)
        const reopened = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
        try {
            pending = (await reopened.acquisitionCheckpoint(key))?.pending
        } finally {
            await reopened.close()
        }
        expect(pending).toBeDefined()
        const events = await run(client.activities(app.repository, 'me', [], scan()))
        expect(events.map((event) => event.kind).sort()).toEqual(['change-request', 'opened'])
        expect(calls).toBe(30)
        expect(pending).toBeUndefined()
    } finally {
        await app.close()
    }
})

it.each(['stop', 'remove'] as const)('reclaims staged contribution slots after %s on a repository', async (change) => {
    const app = await workspace()
    app.remote.github = true
    const reader = vi.spyOn(app.github, 'activities')
    try {
        for (const id of ['pending-a', 'pending-b']) {
            const repository = { ...app.repository, id, path: join(app.directory, id) }
            await app.store.saveRepository(repository)
            await app.store.assignProviderAccount(
                id,
                remoteConfiguration(app.store.config.repositories.find((item) => item.id === id)!),
                { accountId: app.repository.accountId, accountGeneration: 1, assignment: 'automatic' }
            )
            await app.store.saveCheckpoint(`remote:${id}`, {
                status: 'paused',
                pending: { key: '1:version', pages: {} }
            })
        }
        await run(app.service.refresh({ source: 'remote', repositoryId: app.repository.id }))
        expect(reader).not.toHaveBeenCalled()
        expect(await app.store.acquisitionCheckpoint(`remote:${app.repository.id}`)).toMatchObject({
            status: 'paused',
            pauseReason: 'queue'
        })
        if (change === 'stop') {
            await run(app.service.stopWork('remote', 'pending-a'))
            expect((await app.store.acquisitionCheckpoint('remote:pending-a'))?.pending).toBeUndefined()
        } else
            await app.store.saveRepository({
                ...app.store.config.repositories.find((item) => item.id === 'pending-a')!,
                removed: true
            })
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.now() + 2000)
        try {
            await run(app.service.refresh({ source: 'remote', repositoryId: app.repository.id }))
            expect(reader).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    } finally {
        reader.mockRestore()
        await app.close()
    }
})

it('stops the last owned provider read and retains the cancelled checkpoint', async () => {
    const app = await workspace()
    app.remote.github = true
    let signal: AbortSignal | undefined
    let pending: Promise<void> | undefined
    app.remote.fetch = (_input, init = {}) =>
        new Promise<Response>((_resolve, reject) => {
            signal = init.signal ?? undefined
            signal?.addEventListener('abort', () => reject(new Error('Provider read cancelled')), { once: true })
        })
    try {
        pending = run(app.service.refresh({ source: 'remote', repositoryId: app.repository.id }))
        await vi.waitFor(() => expect(signal).toBeDefined())
        await run(app.service.stopWork('remote', app.repository.id))
        await vi.waitFor(() => expect(signal?.aborted).toBe(true))
        await pending
        expect((await app.store.acquisitionCheckpoint(`remote:${app.repository.id}`))?.status).toBe('cancelled')
    } finally {
        await pending?.catch(() => undefined)
        await app.close()
    }
})

it('retains incomplete evidence at the GitHub commit cap and advances other PRs', async () => {
    const incomplete: Record<string, string> = {}
    const versions: Record<string, string> = {}
    let calls = 0
    const client = makeGitHub(<A>(url: string) =>
        Effect.sync(() => {
            calls++
            const page = Number(new URL(url).searchParams.get('page') ?? 1)
            const summary = (number: number) => ({
                number,
                title: 'Work',
                body: '',
                html_url: '',
                created_at: '2026-10-06T00:00:00Z',
                updated_at: '2026-10-06T00:00:00Z',
                user: { login: 'me' },
                base: { ref: 'main', sha: 'b'.repeat(40) },
                head: { ref: 'feature', sha: 'a'.repeat(40) }
            })
            const value: unknown = url.includes('/pulls?')
                ? [summary(1), summary(2)]
                : url.endsWith('/pulls/1')
                  ? { ...summary(1), commits: 251 }
                  : url.includes('/pulls/1/commits?')
                    ? Array.from({ length: page < 3 ? 100 : 50 }, () => ({
                          commit: { author: { email: 'other@example.test', date: '2026-10-06T00:00:00Z' } }
                      }))
                    : []
            return value as A
        })
    )
    const scan = {
        incomplete,
        versions,
        recordIncomplete: (key: string, reason: string) =>
            Effect.sync(() => {
                incomplete[key] = reason
            })
    }
    const events = await run(client.activities(repository, 'me', [], scan))
    expect(events.filter((event) => event.kind === 'change-request').map((event) => event.id)).toEqual(['repo:pr:2'])
    expect(Object.values(incomplete)[0]).toContain('250 commits')
    const before = calls
    expect(await run(client.activities(repository, 'me', [], scan))).toEqual([])
    expect(calls - before).toBe(1)
})

it.each(['body', 'membership'] as const)(
    'commits the Git %s page and cursor together across recovery',
    async (phase) => {
        const app = await journal()
        const repo: Repository = { ...repository, id: 'git-rollback', path: app.directory, remote: '', remotes: [] }
        const commit = (number: number): Activity => ({
            id: `${repo.id}:commit:${number}`,
            repositoryId: repo.id,
            kind: 'commit',
            sha: String(number).padStart(40, '0'),
            title: `Page ${number}`,
            author: 'me@example.com',
            date: '2026-10-06T00:00:00Z',
            description: '',
            branches: ['main'],
            deletedBranches: [],
            files: [],
            disposition: 'inbox',
            explicit: false
        })
        const path = join(app.directory, 'tracking.sqlite')
        const database = new DatabaseSync(path)
        const key = 'git:' + repo.id
        const firstCursor = { phase, offset: 0, group: 0, alias: 0 }
        const nextCursor = { ...firstCursor, offset: phase === 'body' ? 2000 : 1000 }
        const refs = { main: 'f'.repeat(40) }
        const first = { ...commit(1), branches: [] }
        const second = commit(2)
        const next = {
            repository: repo,
            historyDelta: {
                configuration: 'fixture',
                refs,
                items: phase === 'body' ? [second] : [],
                memberships: phase === 'membership' ? [{ branches: ['main'], shas: [first.sha!] }] : undefined
            },
            checkpoint: { key, value: { status: 'running' as const, gitCursor: nextCursor } }
        }
        try {
            await app.store.saveRepository(repo)
            await app.store.applyAcquisitionBatch({
                repository: repo,
                historyDelta: { configuration: 'fixture', refs, items: [first] },
                checkpoint: { key, value: { status: 'running', gitCursor: firstCursor } }
            })
            database.exec(
                "CREATE TRIGGER reject_cursor BEFORE UPDATE ON acquisition_checkpoints BEGIN SELECT RAISE(ABORT, 'cursor write failed'); END"
            )
            await expect(app.store.applyAcquisitionBatch(next)).rejects.toThrow('could not be saved')
            expect((await app.store.acquisitionCheckpoint(key))?.gitCursor).toEqual(firstCursor)
            expect((await app.store.history(repo.id))?.items.map(({ id, branches }) => ({ id, branches }))).toEqual([
                { id: first.id, branches: [] }
            ])
            database.exec('DROP TRIGGER reject_cursor')
            await app.store.applyAcquisitionBatch(next)
            const reopened = await JournalDatabase.open(path)
            try {
                expect((await reopened.acquisitionCheckpoint(key))?.gitCursor).toEqual(nextCursor)
                const items = (await reopened.history(repo.id))!.items
                if (phase === 'body') expect(items.map((item) => item.id).sort()).toEqual([first.id, second.id])
                else expect(items[0].branches).toEqual(['main'])
            } finally {
                await reopened.close()
            }
        } finally {
            database.close()
            await app.close()
        }
    }
)

it('retains account access-check cooldowns instead of requesting reconnection and retries assignment', async () => {
    const app = await journal()
    app.remote.github = true
    await app.store.saveRepository(repository)
    let limited = true
    app.remote.responseFor = (url) => {
        if (url !== 'https://api.github.com/repos/example/project') return undefined
        return limited
            ? Response.json({}, { status: 429, headers: { 'Retry-After': '1' } })
            : Response.json({ id: 42, owner: { login: 'me', type: 'User' } })
    }
    try {
        await run(app.service.refresh({ source: 'remote', repositoryId: repository.id }))
        const paused = await app.store.acquisitionCheckpoint('remote:repo')
        expect(paused).toMatchObject({ status: 'paused', pauseReason: 'provider' })
        expect(paused?.error).toContain('rate limit')
        expect(app.store.config.repositories[0].accountId).toBeUndefined()
        limited = false
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.parse(paused!.retryAt!) + 2000)
        try {
            await run(app.service.refresh({ source: 'remote', repositoryId: repository.id }))
            expect(app.store.config.repositories[0].accountId).toBeDefined()
            expect((await app.store.acquisitionCheckpoint('remote:repo'))?.status).toBe('idle')
        } finally {
            vi.useRealTimers()
        }
    } finally {
        await app.close()
    }
})

it.each(['network', 'unavailable'] as const)(
    'classifies token renewal %s failure according to whether the account can still retry',
    async (failure) => {
        const app = await journal({
            access_token: 'expired',
            refresh_token: 'one-use-refresh',
            expires: Date.now() - 1000
        })
        app.remote.github = true
        const account = app.store.config.accounts[0]
        await app.store.saveRepository({ ...repository, accountId: account.id, accountGeneration: account.generation })
        app.remote.responseFor = () => {
            if (failure === 'network') throw new Error('Connection lost during token renewal')
            return Response.json({}, { status: 503 })
        }
        try {
            await run(app.service.refresh({ source: 'remote', repositoryId: repository.id }))
            const state = { ...(await journalState(app.store)), accounts: app.store.config.accounts }
            const status = state.acquisition!['remote:repo']
            if (failure === 'network') {
                expect(app.store.config.accounts[0].status).toBe('reconnect')
                expect(status.status).toBe('error')
                expect(status.error).toMatch(/credentials.*reconnect/i)
                expect(status.retryAt).toBeUndefined()
                expect(sourceProblems(state).map(([key]) => key)).toEqual(['remote:repo'])
                expect(nextAcquisition(state, Date.now() + 60_000)).toBeUndefined()
            } else {
                expect(app.store.config.accounts[0].status).toBe('connected')
                expect(status).toMatchObject({ status: 'paused', pauseReason: 'connection' })
                expect(sourceProblems(state)).toEqual([])
                expect(nextAcquisition(state, Date.parse(status.retryAt!) + 1000)?.[0]).toBe('remote:repo')
            }
        } finally {
            await app.close()
        }
    }
)
