import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { journal } from '../tests/fixtures'
import { run } from '../tests/run-effect'
import { indexCommits, type GitCursor } from '../src/main/git'

const evidence = '.ai-docs/verification/import-stress/runs/' + String(Date.now())

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
    await writeFile(`${evidence}/results.json`, JSON.stringify({ at: new Date().toISOString(), samples }, null, 2))
    const bounds: Record<string, number> = {
        'acquisition-persist-10000-commits-50-refs': 120000,
        'acquisition-unchanged-10000-commits-50-refs': 2000,
        'history-10000-commits-50-refs': 10000,
        'import-100-repos-10000-commits': 60000
    }
    if (bounds[name]) assert.ok(Number(samples.at(-1)!.ms) < bounds[name], name + ' exceeds its workload budget')
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
        assert.equal(app.store.config.repositories.length, count === 10 ? 10 : 110)
    }
    assert.equal(app.remote.requests.length, 0)
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
        assert.equal(known.length, 10000)
    }
    repository.emails = ['stress@example.com']
    repository.trackingStart = '2020-01-01'
    await app.store.saveRepository(repository)
    await measure('acquisition-persist-10000-commits-50-refs', () =>
        run(app.service.refresh({ repositoryId: repository.id, source: 'git', since: '2020-01-01' }))
    )
    const persisted = (await app.store.history(repository.id))!.items
    assert.equal(persisted.length, 10000)
    assert.ok(persisted.every((item) => item.branches.length === 50))
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
