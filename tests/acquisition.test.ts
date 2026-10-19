import { expect, it, vi } from 'vitest'
import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'
import type { Repository } from '../src/shared/model'
import { WorkQueue } from '../src/main/work-queue'
import { workspace, transport } from './fixtures'
import { Store } from '../src/main/store'
import { join } from 'node:path'
import * as gitModule from '../src/main/git'
import { JournalService } from '../src/main/service'

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

it('stops before enriching old unrelated PR history', async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
        const url = input instanceof Request ? input.url : String(input)
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
        return Promise.resolve(new Response(JSON.stringify(value)))
    })
    const github = new GitHub(new Http(fetcher), () => 'test', vi.fn())
    expect(await github.activities(repository, 'me', [])).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
})

it('keeps PR summaries updated on the selected journal date across a UTC boundary', async () => {
    const remote = transport()
    const http = new Http(async (input, init) => {
        const response = await remote.fetch(input, init)
        const url = input instanceof Request ? input.url : String(input)
        if (!url.includes('/pulls?')) return response
        const pulls = (await response.json()) as { updated_at: string }[]
        pulls[0].updated_at = '2026-10-04T22:00:00Z'
        return new Response(JSON.stringify(pulls))
    })
    const github = new GitHub(http, () => 'test', vi.fn())
    const items = await github.activities(repository, 'me', [], { since: '2026-10-05', timezone: 'Europe/Istanbul' })
    expect(items.some((item) => item.kind === 'pr')).toBe(true)
})

it('reconsiders completed GitHub coverage when the journal timezone changes', async () => {
    const app = await workspace()
    try {
        app.repository.trackingStart = '2026-10-05'
        app.store.state.settings.timezone = 'UTC'
        const http = new Http(async (input, init) => {
            const response = await app.remote.fetch(input, init)
            const url = input instanceof Request ? input.url : String(input)
            if (!url.includes('/pulls?')) return response
            const pulls = (await response.json()) as { updated_at: string }[]
            pulls[0].updated_at = '2026-10-04T22:00:00Z'
            return new Response(JSON.stringify(pulls))
        })
        const service = new JournalService(app.store, new GitHub(http, () => 'test', vi.fn()), app.notion, () => ({
            github: true,
            notion: false,
            protectedStorage: false
        }))
        await service.handle({ type: 'loadWeek', since: '2026-10-05' })
        expect(app.store.state.activities.some((activity) => activity.kind === 'pr')).toBe(false)
        app.store.state.settings.timezone = 'Europe/Istanbul'
        await service.handle({ type: 'loadWeek', since: '2026-10-05' })
        expect(app.store.state.activities.some((activity) => activity.kind === 'pr')).toBe(true)
        expect(app.store.state.acquisition?.[`github:${app.repository.id}`].historyTimezone).toBe('Europe/Istanbul')
    } finally {
        await app.close()
    }
})

it('recognizes secondary throttling even with primary quota remaining', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
        Promise.resolve(
            new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), {
                status: 403,
                headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4000' }
            })
        )
    )
    const http = new Http(fetcher)
    await expect(http.request('https://api.github.com/repos/example/project', 'test')).rejects.toThrow()
    await expect(http.request('https://api.github.com/repos/example/project', 'test')).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
})

it('uses conditional reads and shares simultaneous readers without mixing credentials', async () => {
    const attempts: { token: string | null; etag: string | null }[] = []
    const http = new Http((_url, init) => {
        const headers = new Headers(init?.headers)
        attempts.push({ token: headers.get('Authorization'), etag: headers.get('If-None-Match') })
        if (headers.get('If-None-Match')) return Promise.resolve(new Response(null, { status: 304 }))
        return Promise.resolve(
            new Response(JSON.stringify({ private: headers.get('Authorization') }), { headers: { etag: 'version' } })
        )
    })
    const url = 'https://api.github.com/repos/example/project'
    const first = await Promise.all([http.request(url, 'one'), http.request(url, 'one')])
    expect(attempts).toHaveLength(1)
    expect(first[0]).toEqual(first[1])
    expect(await http.request(url, 'one')).toEqual(first[0])
    await http.request(url, 'two')
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
    const fetcher = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '60' } }))
    )
    const store = { pauses, changed: vi.fn() }
    await expect(new Http(fetcher, store).request('https://api.github.com/user', 'one')).rejects.toThrow('429')
    await expect(new Http(fetcher, store).request('https://api.github.com/user', 'one')).rejects.toThrow('paused')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(new Http(fetcher, store).request('https://api.github.com/user', 'two')).rejects.toThrow('429')
    expect(fetcher).toHaveBeenCalledTimes(2)
})

it('repeated refresh skips unchanged PR enrichment and unchanged Git histories', async () => {
    const app = await workspace()
    const log = vi.spyOn(gitModule, 'indexCommits')
    try {
        app.remote.github = true
        await app.service.refresh()
        const refs = app.store.state.acquisition?.[`git:${app.repository.id}`].refs
        const start = app.remote.requests.length
        await app.service.refresh()
        const github = app.remote.requests.slice(start).filter((request) => request.url.includes('api.github.com'))
        expect(github).toHaveLength(1)
        expect(github[0].url).toContain('/pulls?')
        expect(log.mock.calls.at(-1)?.[1]).toEqual(refs)
        expect(app.store.state.acquisition?.[`git:${app.repository.id}`].refs).toEqual(refs)
    } finally {
        log.mockRestore()
        await app.close()
    }
})

it('loads hub file metadata without acquiring a patch and coalesces workspace diff reads', async () => {
    const app = await workspace()
    const read = vi.spyOn(gitModule, 'commitDetails')
    try {
        await app.service.refresh()
        const activity = app.store.state.activities.find((item) => item.kind === 'commit')!
        await app.service.handle({ type: 'details', activityId: activity.id, content: 'files' })
        expect(app.store.state.diffs[activity.id]).toBeUndefined()
        expect(read.mock.calls[0][2]).toBe(false)
        read.mockClear()
        const result = await Promise.all([
            app.service.handle({ type: 'details', activityId: activity.id }),
            app.service.handle({ type: 'details', activityId: activity.id })
        ])
        expect(read).toHaveBeenCalledTimes(1)
        expect(result[0].diff).toContain('initial')
        await app.service.handle({ type: 'details', activityId: activity.id })
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
        await app.service.refresh()
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        await app.service.handle({ type: 'details', activityId: pr.id })
        expect(app.service.reply().state.diffs).toEqual({})
        expect(app.service.reply().state.revisions.every((item) => item.diff === '')).toBe(true)
        const patch = app.store.state.diffs[pr.id]
        const versions = structuredClone(app.store.state.acquisition?.[`github:${app.repository.id}`].versions)
        app.store.close()
        const reopened = new Store(join(app.directory, 'tracking.sqlite'))
        try {
            expect(reopened.state.diffs[pr.id]).toBe(patch)
            expect(reopened.state.acquisition?.[`github:${app.repository.id}`].versions).toEqual(versions)
        } finally {
            reopened.close()
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
    const http = new Http(async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.includes('/pulls?')) {
            const response = await original(input, init)
            const pulls = (await response.json()) as { number: number }[]
            return new Response(JSON.stringify([pulls[0], { ...pulls[0], number: 2 }]))
        }
        if (url.includes('/pulls/1/commits')) firstReads++
        if (fail && url.includes('/pulls/2/reviews')) return new Response('{}', { status: 403 })
        return original(input, init)
    })
    const github = new GitHub(http, () => 'test', vi.fn())
    const versions: Record<string, string> = {}
    const captured: string[] = []
    const scan = {
        versions,
        batch: (items: { id: string }[]) => {
            captured.push(...items.map((item) => item.id))
            return Promise.resolve()
        }
    }
    await expect(github.activities(repository, 'me', [], scan)).rejects.toThrow('403')
    expect(captured).toContain('repo:pr:1')
    expect(versions['1']).toBeDefined()
    expect(versions['2']).toBeUndefined()
    fail = false
    await github.activities(repository, 'me', [], scan)
    expect(firstReads).toBe(1)
    expect(captured).toContain('repo:pr:2')
})

it('bounds enrichment to twenty changed PRs per pass and resumes the same page', async () => {
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
    const github = new GitHub(
        new Http((input) => {
            calls++
            const url = input instanceof Request ? input.url : String(input)
            return Promise.resolve(
                new Response(JSON.stringify(url.includes('/pulls?') && url.endsWith('page=1') ? pulls : []))
            )
        }),
        () => 'test',
        vi.fn()
    )
    const versions: Record<string, string> = {}
    const first = await github.activities(repository, 'me', [], { versions })
    expect(first.filter((item) => item.kind === 'pr')).toHaveLength(20)
    expect(calls).toBe(41)
    const second = await github.activities(repository, 'me', [], { versions })
    expect(second.find((item) => item.kind === 'pr')?.id).toBe('repo:pr:21')
    expect(calls).toBe(82)
})

it('a user pause survives scheduled refresh and explicit retry resumes it', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await app.service.refresh()
        app.service.stopWork('github', app.repository.id)
        expect(app.store.state.acquisition?.[`github:${app.repository.id}`].error).toBeUndefined()
        const start = app.remote.requests.length
        await app.service.refresh({ repositoryId: app.repository.id, source: 'github' })
        expect(app.remote.requests).toHaveLength(start)
        expect(app.store.state.acquisition?.[`github:${app.repository.id}`].status).toBe('cancelled')
        await app.service.refresh({ repositoryId: app.repository.id, source: 'github', resume: true })
        expect(app.remote.requests).toHaveLength(start + 1)
        expect(app.store.state.acquisition?.[`github:${app.repository.id}`].status).toBe('idle')
    } finally {
        await app.close()
    }
})

it('discovers a new review on an old PR without importing its old milestones', async () => {
    const remote = transport()
    const github = new GitHub(
        new Http(async (input, init) => {
            const response = await remote.fetch(input, init)
            const url = input instanceof Request ? input.url : String(input)
            if (!url.includes('/pulls?')) return response
            const pulls = (await response.json()) as { created_at: string }[]
            pulls[0].created_at = '2020-01-01T00:00:00Z'
            return new Response(JSON.stringify(pulls))
        }),
        () => 'test',
        vi.fn()
    )
    const activities = await github.activities(repository, 'me', [])
    expect(activities.some((item) => item.kind === 'review')).toBe(true)
    expect(activities.some((item) => item.kind === 'opened')).toBe(false)
})

it('indexes only new commit bodies after ref changes and updates known branch membership', async () => {
    const app = await workspace()
    try {
        const first = await gitModule.indexCommits(app.repository, {}, app.repository.trackingStart)
        await app.git('commit', '--allow-empty', '-m', 'Incremental work')
        const incremental = await gitModule.indexCommits(app.repository, first.refs, app.repository.trackingStart)
        expect(incremental.items.map((item) => item.title)).toEqual(['Incremental work'])
        await app.git('branch', 'new-branch')
        const branch = await gitModule.indexCommits(
            app.repository,
            incremental.refs,
            app.repository.trackingStart,
            0,
            [],
            incremental.items
        )
        expect(branch.items[0].branches).toContain('new-branch')
    } finally {
        await app.close()
    }
})

it('queues and coalesces an explicit source retry behind active acquisition', async () => {
    const app = await workspace()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const original = gitModule.indexCommits
    const indexing = vi.spyOn(gitModule, 'indexCommits').mockImplementationOnce(async (...args) => {
        await gate
        return original(...args)
    })
    try {
        app.remote.github = true
        const active = app.service.refresh({ source: 'git' })
        const retry = app.service.refresh({ repositoryId: app.repository.id, source: 'git', resume: true })
        const duplicate = app.service.refresh({ repositoryId: app.repository.id, source: 'git', resume: true })
        expect(app.remote.requests).toHaveLength(0)
        release()
        await Promise.all([active, retry, duplicate])
        expect(indexing).toHaveBeenCalledTimes(2)
    } finally {
        release()
        indexing.mockRestore()
        await app.close()
    }
})
