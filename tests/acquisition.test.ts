import nodePath from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import * as gitModule from '../src/main/git'
import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'
import { Store } from '../src/main/store'
import { WorkQueue } from '../src/main/work-queue'
import type { Repository } from '../src/shared/model'
import { required } from '../src/shared/required'
import { transport, workspace } from './fixtures'

describe('acquisition', () => {
    it('limits a failed network read to three attempts', async () => {
        vi.useFakeTimers()
        try {
            const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Connection failed'))
            const http = new Http(fetcher)
            const failure = expect(
                http.request('https://api.github.com/repos/example/project', 'test')
            ).rejects.toThrow('Connection failed')
            await vi.runAllTimersAsync()
            await failure
            expect(fetcher).toHaveBeenCalledTimes(3)
        } finally {
            vi.useRealTimers()
        }
    })
    const repository: Repository = {
        available: true,
        base: 'main',
        branchBases: {},
        branches: [],
        emails: ['me@example.com'],
        id: 'repo',
        name: 'Project',
        path: '',
        remote: 'https://github.com/example/project',
        removed: false,
        trackingStart: '2026-10-05'
    }

    it('stops before enriching old unrelated PR history', async () => {
        const fetcher = vi.fn<typeof fetch>((input) => {
            const url = input instanceof Request ? input.url : String(input)
            const pulls = Array.from({ length: 100 }, (_, index) => ({
                base: { ref: 'main', sha: 'b'.repeat(40) },
                body: '',
                created_at: '2020-01-01T00:00:00Z',
                head: { ref: 'feature', sha: 'a'.repeat(40) },
                html_url: '',
                merge_commit_sha: null,
                merged_at: null,
                number: index + 1,
                title: 'Old work',
                updated_at: '2020-01-01T00:00:00Z',
                user: { login: 'other' }
            }))
            const value = (() => {
                if (url.includes('/pulls?')) {
                    if (url.includes('page=1&') || url.endsWith('page=1')) {
                        return pulls
                    }
                    return []
                }
                if (/\/(?<group1>commits|reviews|files)\?/u.test(url)) {
                    return []
                }
                return pulls[0]
            })()
            return Promise.resolve(Response.json(value))
        })
        const github = new GitHub(new Http(fetcher), () => 'test', vi.fn<(...args: unknown[]) => void>())
        await expect(github.activities(repository, 'me', [])).resolves.toStrictEqual([])
        expect(fetcher).toHaveBeenCalledOnce()
    })

    it('recognizes secondary throttling even with primary quota remaining', async () => {
        const fetcher = vi.fn<typeof fetch>(() =>
            Promise.resolve(
                Response.json(
                    { message: 'You have exceeded a secondary rate limit.' },
                    {
                        headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4000' },
                        status: 403
                    }
                )
            )
        )
        const http = new Http(fetcher)
        await expect(http.request('https://api.github.com/repos/example/project', 'test')).rejects.toThrow('rate limit')
        await expect(http.request('https://api.github.com/repos/example/project', 'test')).rejects.toThrow(
            'requests paused'
        )
        expect(fetcher).toHaveBeenCalledOnce()
    })

    it('uses conditional reads and shares simultaneous readers without mixing credentials', async () => {
        const attempts: { token: string | null; etag: string | null }[] = []
        const http = new Http((_url, init) => {
            const headers = new Headers(init?.headers)
            attempts.push({ etag: headers.get('If-None-Match'), token: headers.get('Authorization') })
            if (headers.get('If-None-Match')) {
                return Promise.resolve(new Response(null, { status: 304 }))
            }
            return Promise.resolve(
                Response.json({ private: headers.get('Authorization') }, { headers: { etag: 'version' } })
            )
        })
        const url = 'https://api.github.com/repos/example/project'
        const first = await Promise.all([http.request(url, 'one'), http.request(url, 'one')])
        expect([attempts?.length, first[0]]).toStrictEqual([1, first[1]])
        await expect(http.request(url, 'one')).resolves.toStrictEqual(first[0])
        await http.request(url, 'two')
        expect(attempts.map((attempt) => attempt.etag)).toStrictEqual([null, 'version', null])
    })

    it('admits foreground work ahead of queued backfill and bounds concurrency', async () => {
        const queue = new WorkQueue(1)
        const order: string[] = []
        let release: (() => void) | undefined
        const first = queue.run(() =>
            Promise.resolve(
                (() => {
                    const { promise, resolve: done, reject } = Promise.withResolvers<void>()
                    try {
                        release = done
                    } catch (error) {
                        reject(error)
                    }
                    return promise
                })()
            )
        )
        const background = queue.run(() => {
            order.push('background')
            return Promise.resolve()
        })
        const foreground = queue.run(() => {
            order.push('foreground')
            return Promise.resolve()
        }, 1)
        expect(order).toStrictEqual([])
        required(release)()
        await Promise.all([first, background, foreground])
        expect(order).toStrictEqual(['foreground', 'background'])
    })

    it('preserves credential-scoped throttle pauses across transport restart', async () => {
        const pauses = {}
        const fetcher = vi.fn<typeof fetch>(() =>
            Promise.resolve(new Response('{}', { headers: { 'retry-after': '60' }, status: 429 }))
        )
        const store = { changed: vi.fn<(...args: unknown[]) => void>(), pauses }
        await expect(new Http(fetcher, store).request('https://api.github.com/user', 'one')).rejects.toThrow('429')
        await expect(new Http(fetcher, store).request('https://api.github.com/user', 'one')).rejects.toThrow('paused')
        expect(fetcher).toHaveBeenCalledOnce()
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
            expect([
                github?.length,
                github[0].url?.includes('/pulls?'),
                log.mock.calls.at(-1)?.[1],
                app.store.state.acquisition?.[`git:${app.repository.id}`].refs
            ]).toStrictEqual([1, true, refs, refs])
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
            const activity = required(app.store.state.activities.find((item) => item.kind === 'commit'))
            await app.service.handle({ activityId: activity.id, content: 'files', type: 'details' })
            expect([app.store.state.diffs[activity.id] === undefined, Boolean(read.mock.calls[0][2])]).toStrictEqual([
                true,
                false
            ])
            read.mockClear()
            const result = await Promise.all([
                app.service.handle({ activityId: activity.id, type: 'details' }),
                app.service.handle({ activityId: activity.id, type: 'details' })
            ])
            expect([read.mock.calls.length, result[0].diff?.includes('initial')]).toStrictEqual([1, true])
            await app.service.handle({ activityId: activity.id, type: 'details' })
            expect(read).toHaveBeenCalledOnce()
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
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            await app.service.handle({ activityId: pr.id, type: 'details' })
            expect([
                app.service.reply().state.diffs,
                Boolean(app.service.reply().state.revisions.every((item) => item.diff === ''))
            ]).toStrictEqual([{}, true])
            const patch = app.store.state.diffs[pr.id]
            const versions = structuredClone(app.store.state.acquisition?.[`github:${app.repository.id}`].versions)
            app.store.close()
            const reopened = new Store(nodePath.join(app.directory, 'tracking.sqlite'))
            try {
                expect([
                    Object.is(reopened.state.diffs[pr.id], patch),
                    reopened.state.acquisition?.[`github:${app.repository.id}`].versions
                ]).toStrictEqual([true, versions])
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
                return Response.json([pulls[0], { ...pulls[0], number: 2 }])
            }
            if (url.includes('/pulls/1/commits')) {
                firstReads += 1
            }
            if (fail && url.includes('/pulls/2/reviews')) {
                return new Response('{}', { status: 403 })
            }
            return await original(input, init)
        })
        const github = new GitHub(http, () => 'test', vi.fn<(...args: unknown[]) => void>())
        const versions: Record<string, string> = {}
        const captured: string[] = []
        const scan = {
            batch: (items: { id: string }[]) => {
                captured.push(...items.map((item) => item.id))
                return Promise.resolve()
            },
            versions
        }
        await expect(github.activities(repository, 'me', [], scan)).rejects.toThrow('403')
        expect([
            captured?.includes('repo:pr:1'),
            versions['1'] !== undefined,
            versions['2'] === undefined
        ]).toStrictEqual([true, true, true])
        fail = false
        await github.activities(repository, 'me', [], scan)
        expect([Object.is(firstReads, 1), captured?.includes('repo:pr:2')]).toStrictEqual([true, true])
    })

    it('bounds enrichment to twenty changed PRs per pass and resumes the same page', async () => {
        let calls = 0
        const pulls = Array.from({ length: 100 }, (_, index) => ({
            base: { ref: 'main', sha: 'b'.repeat(40) },
            body: '',
            created_at: '2026-10-06T00:00:00Z',
            head: { ref: 'feature', sha: 'a'.repeat(40) },
            html_url: '',
            merge_commit_sha: null,
            merged_at: null,
            number: index + 1,
            title: 'My work',
            updated_at: '2026-10-06T00:00:00Z',
            user: { login: 'me' }
        }))
        const github = new GitHub(
            new Http((input) => {
                calls += 1
                const url = input instanceof Request ? input.url : String(input)
                return Promise.resolve(Response.json(url.includes('/pulls?') && url.endsWith('page=1') ? pulls : []))
            }),
            () => 'test',
            vi.fn<(...args: unknown[]) => void>()
        )
        const versions: Record<string, string> = {}
        const first = await github.activities(repository, 'me', [], { versions })
        expect([first.filter((item) => item.kind === 'pr')?.length, Object.is(calls, 41)]).toStrictEqual([20, true])
        const second = await github.activities(repository, 'me', [], { versions })
        expect([
            Object.is(second.find((item) => item.kind === 'pr')?.id, 'repo:pr:21'),
            Object.is(calls, 82)
        ]).toStrictEqual([true, true])
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
            expect([
                app.remote.requests?.length,
                Object.is(app.store.state.acquisition?.[`github:${app.repository.id}`].status, 'cancelled')
            ]).toStrictEqual([start, true])
            await app.service.refresh({ repositoryId: app.repository.id, resume: true, source: 'github' })
            expect([
                app.remote.requests?.length,
                Object.is(app.store.state.acquisition?.[`github:${app.repository.id}`].status, 'idle')
            ]).toStrictEqual([start + 1, true])
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
                if (!url.includes('/pulls?')) {
                    return response
                }
                const pulls = (await response.json()) as { created_at: string }[]
                pulls[0].created_at = '2020-01-01T00:00:00Z'
                return Response.json(pulls)
            }),
            () => 'test',
            vi.fn<(...args: unknown[]) => void>()
        )
        const activities = await github.activities(repository, 'me', [])
        expect([
            Boolean(activities.some((item) => item.kind === 'review')),
            Boolean(activities.some((item) => item.kind === 'opened'))
        ]).toStrictEqual([true, false])
    })

    it('indexes only new commit bodies after ref changes and updates known branch membership', async () => {
        const app = await workspace()
        try {
            const first = await gitModule.indexCommits(app.repository, {}, app.repository.trackingStart)
            await app.git('commit', '--allow-empty', '-m', 'Incremental work')
            const incremental = await gitModule.indexCommits(app.repository, first.refs, app.repository.trackingStart)
            expect(incremental.items.map((item) => item.title)).toStrictEqual(['Incremental work'])
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
        const gate = (() => {
            const { promise, resolve, reject } = Promise.withResolvers<void>()
            try {
                release = resolve
            } catch (error) {
                reject(error)
            }
            return promise
        })()
        const original = gitModule.indexCommits
        const indexing = vi.spyOn(gitModule, 'indexCommits').mockImplementationOnce(async (...args) => {
            await gate
            return await original(...args)
        })
        try {
            app.remote.github = true
            const active = app.service.refresh({ source: 'git' })
            const retry = app.service.refresh({ repositoryId: app.repository.id, resume: true, source: 'github' })
            const duplicate = app.service.refresh({ repositoryId: app.repository.id, resume: true, source: 'github' })
            expect(app.remote.requests).toHaveLength(0)
            release()
            await Promise.all([active, retry, duplicate])
            expect(app.remote.requests.filter((request) => request.url.includes('/pulls?'))).toHaveLength(1)
        } finally {
            release()
            indexing.mockRestore()
            await app.close()
        }
    })
})
