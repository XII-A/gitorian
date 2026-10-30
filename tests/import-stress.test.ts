import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const evidence = `.ai-docs/verification/import-stress/runs/${Date.now()}`
import { journal } from './fixtures'
import { run } from './effect-fixtures'
import type { GitCursor } from '../src/main/git'
import { indexCommits } from '../src/main/git'
import { transportClient } from './effect-fixtures'
import { makeGitHub } from '../src/main/github'
import { Effect } from 'effect'
import { makeGitLab } from '../src/main/gitlab'

// Opt in: real Git and SQLite, disposable profile, synthetic history, no network.
it.skipIf(process.env.GITORIAN_IMPORT_STRESS !== '1')(
    'measures repository import and history breakpoints',
    async () => {
        const app = await journal()
        const samples: Record<string, unknown>[] = []
        const git = (path: string, args: string[], input?: string) => {
            const result = spawnSync('git', args, { cwd: path, input, encoding: 'utf8', windowsHide: true })
            if (result.status !== 0) throw new Error(result.stderr)
        }
        const measure = async (name: string, work: () => Promise<unknown>) => {
            const start = performance.now()
            const result = await work()
            samples.push({
                name,
                ms: Math.round(performance.now() - start),
                rssMiB: Math.round(process.memoryUsage().rss / 1048576)
            })
            // Preserve completed stages even if a later stage exceeds the stress deadline.
            await mkdir(evidence, { recursive: true })
            await writeFile(
                `${evidence}/results.json`,
                JSON.stringify({ at: new Date().toISOString(), samples }, null, 2)
            )
            const bounds: Record<string, number> = {
                'acquisition-persist-10000-commits-50-refs': 120000,
                'acquisition-unchanged-10000-commits-50-refs': 2000,
                'history-10000-commits-50-refs': 10000,
                'import-100-repos-10000-commits': 60000
            }
            if (bounds[name])
                expect(samples.at(-1)!.ms, `${name} exceeds its workload budget`).toBeLessThan(bounds[name])
            return result
        }
        try {
            const seed = join(app.directory, 'seed')
            await mkdir(seed)
            git(seed, ['init', '-b', 'main'])
            let stream = ''
            for (let i = 1; i <= 10000; i++) {
                const message = `Commit ${i}\n`
                stream += `commit refs/heads/main\nmark :${i}\ncommitter Stress <stress@example.com> 1791280800 +0000\ndata ${Buffer.byteLength(message)}\n${message}${i > 1 ? `from :${i - 1}\n` : ''}\n`
            }
            git(seed, ['fast-import', '--quiet'], stream)
            for (const count of [10, 100]) {
                const root = join(app.directory, `repos-${count}`)
                await mkdir(root)
                for (let i = 0; i < count; i++) await cp(seed, join(root, `repo-${i}`), { recursive: true })
                const scanStarted = performance.now()
                const scan = (await run(app.service.scanRepositories(root))).repositoryScan!
                samples.push({
                    name: `scan-${count}-repos-10000-commits`,
                    ms: Math.round(performance.now() - scanStarted),
                    rssMiB: Math.round(process.memoryUsage().rss / 1048576)
                })
                await measure(`import-${count}-repos-10000-commits`, () =>
                    run(
                        app.service.importRepositories(
                            scan.id,
                            scan.repositories.map((r) => r.path)
                        )
                    )
                )
                expect(app.store.config.repositories).toHaveLength(count === 10 ? 10 : 110)
            }
            expect(app.remote.requests).toHaveLength(0)
            const repository = app.store.config.repositories[0]
            for (const refs of [1, 50]) {
                for (let i = 1; i < refs; i++) git(repository.path, ['branch', `stress-${i}`])
                let previous = {}
                let offset = 0
                let cursor: GitCursor | undefined
                const known: Awaited<ReturnType<typeof indexCommits>>['items'] = []
                await measure(`history-10000-commits-${refs}-refs`, async () => {
                    do {
                        const batch = await indexCommits(
                            repository,
                            previous,
                            '2020-01-01',
                            offset,
                            [],
                            'UTC',
                            undefined,
                            cursor
                        )
                        cursor = batch.cursor
                        previous = batch.refs
                        known.push(...(batch.history ?? batch.items))
                        offset = batch.nextOffset ?? 0
                    } while (offset)
                })
                expect(known).toHaveLength(10000)
            }
            repository.emails = ['stress@example.com']
            repository.trackingStart = '2020-01-01'
            await app.store.saveRepository(repository)
            await measure('acquisition-persist-10000-commits-50-refs', () =>
                run(app.service.refresh({ repositoryId: repository.id, source: 'git', since: '2020-01-01' }))
            )
            const persisted = (await app.store.history(repository.id))!.items
            expect(persisted).toHaveLength(10000)
            expect(persisted.every((item) => item.branches.length === 50)).toBe(true)
            await measure('acquisition-unchanged-10000-commits-50-refs', () =>
                run(app.service.refresh({ repositoryId: repository.id, source: 'git', since: '2020-01-01' }))
            )
        } finally {
            await mkdir(evidence, { recursive: true })
            await writeFile(
                `${evidence}/results.json`,
                JSON.stringify(
                    { at: new Date().toISOString(), node: process.version, platform: process.platform, samples },
                    null,
                    2
                )
            )
            await app.close()
        }
    },
    600000
)

it.skipIf(process.env.GITORIAN_IMPORT_STRESS !== '1')('counts GitLab large unrelated MR hydration reads', async () => {
    let reads = 0
    const gitlab = makeGitLab(<A>(path: string) => {
        reads++
        const url = new URL(path, 'https://gitlab.com/api/v4/')
        let value: unknown = []
        if (url.pathname.endsWith('/merge_requests')) {
            const recent = url.searchParams.get('per_page') === '5'
            value = Array.from({ length: recent ? 5 : 20 }, (_, i) => ({
                iid: i + (recent ? 101 : 1),
                author: { id: 99 }
            }))
        } else if (url.pathname.endsWith('/commits') && Number(url.searchParams.get('page')) <= 10) {
            value = Array.from({ length: 100 }, () => ({ author_email: 'other@example.com' }))
        }
        return Effect.succeed(value as A)
    }, '42')
    await expect(
        run(
            gitlab.activities(
                {
                    id: 'stress',
                    path: '',
                    name: 'stress',
                    remote: 'https://gitlab.com/example/project.git',
                    base: 'main',
                    emails: ['stress@example.com'],
                    trackingStart: '2020-01-01',
                    available: true,
                    removed: false,
                    branchBases: {},
                    branches: []
                },
                'stress',
                []
            )
        )
    ).rejects.toMatchObject({ status: 429 })
    expect(reads).toBe(25)
    await mkdir(evidence, { recursive: true })
    await writeFile(
        `${evidence}/gitlab.json`,
        JSON.stringify({ reads, activities: 0, recent: 5, sweep: 5, commitsPerMR: 1000 }, null, 2)
    )
})

it.skipIf(process.env.GITORIAN_IMPORT_STRESS !== '1')(
    'proves byte limits and provider request amplification',
    async () => {
        const app = await journal()
        const repository = {
            id: 'stress',
            name: 'stress',
            path: '',
            remote: '',
            base: 'main',
            emails: ['stress@example.com'],
            trackingStart: '2020-01-01',
            available: true,
            removed: false,
            branchBases: {},
            branches: []
        }
        const samples: Record<string, unknown>[] = []
        const git = (path: string, args: string[], input?: string) => {
            const result = spawnSync('git', args, { cwd: path, input, encoding: 'utf8', windowsHide: true })
            if (result.status !== 0) throw new Error(result.stderr)
        }
        try {
            // A fixed commit-count page does not bound output bytes.
            const fat = join(app.directory, 'fat')
            await mkdir(fat)
            git(fat, ['init', '-b', 'main'])
            const message = 'x'.repeat(8_100_000) + '\n'
            git(
                fat,
                ['fast-import', '--quiet'],
                `commit refs/heads/main\ncommitter Stress <stress@example.com> 1791280800 +0000\ndata ${Buffer.byteLength(message)}\n${message}\n`
            )
            const oversized = await indexCommits({ ...repository, path: fat }, {}, '2020-01-01')
            expect(oversized.items).toHaveLength(1)
            expect(oversized.items[0].description).toContain('preview limit')
            samples.push({
                name: 'single-8.1MB-message',
                outcome: 'Commit retained with explicit bounded message preview'
            })
            let calls = 0
            const http = await transportClient(() => {
                calls++
                return Promise.resolve(
                    new Response('{}', {
                        headers: {
                            'x-ratelimit-remaining': '499',
                            'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 3600)
                        }
                    })
                )
            })
            const burst = await Promise.allSettled(
                Array.from({ length: 100 }, (_, i) =>
                    run(
                        http.request(`https://api.github.com/stress/${i}`, 'synthetic-token', {}, 'json', {
                            background: true
                        })
                    )
                )
            )
            expect(calls).toBe(1)
            expect(burst.filter((result) => result.status === 'rejected')).toHaveLength(99)
            await run(http.request('https://api.github.com/foreground', 'synthetic-token'))
            expect(calls).toBe(2)
            samples.push({
                name: '100-background-reads-at-quota-reserve',
                providerCalls: 1,
                deferred: 99,
                foregroundCalls: 1
            })
            let providerReads = 0
            const github = makeGitHub(<A>(url: string) => {
                providerReads++
                let value: unknown = []
                const page = Number(new URL(url).searchParams.get('page') ?? 1)
                if (url.includes('/pulls?'))
                    value = Array.from({ length: 100 }, (_, i) => ({
                        number: i + 1,
                        title: 'Unrelated PR',
                        created_at: '2026-10-06T10:00:00Z',
                        updated_at: '2026-10-06T10:00:00Z',
                        user: { login: 'other' },
                        base: { sha: 'a'.repeat(40) },
                        head: { sha: 'b'.repeat(40) }
                    }))
                else if (url.includes('/reviews?') && page <= 10)
                    value = Array.from({ length: 100 }, (_, i) => ({
                        id: page * 100 + i,
                        user: { login: 'other' },
                        submitted_at: '2026-10-06T00:00:00Z',
                        state: 'COMMENTED',
                        body: 'Review',
                        html_url: ''
                    }))
                return Effect.succeed(value as A)
            })
            await expect(
                run(
                    github.activities(
                        { ...repository, remote: 'https://github.com/example/project.git' },
                        'stress',
                        [],
                        {
                            since: '2020-01-01',
                            versions: {}
                        }
                    )
                )
            ).rejects.toMatchObject({ status: 429 })
            expect(providerReads).toBe(25)
            samples.push({
                name: 'github-20-unrelated-PRs-1000-reviews-each',
                providerReads,
                activities: 0,
                note: 'Provider adapter only; excludes HTTP pacing/cache/quota.'
            })
        } finally {
            await mkdir(evidence, { recursive: true })
            await writeFile(`${evidence}/boundaries.json`, JSON.stringify(samples, null, 2))
            await app.close()
        }
    }
)
