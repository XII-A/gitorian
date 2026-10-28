import { journalState, editDraft } from './database-fixtures'
import { Effect } from 'effect'
import { JournalError } from '../src/main/journal-context'
import { run } from './effect-fixtures'
import { expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { discoverRepositories } from '../src/main/repository-discovery'
import { journal, workspace } from './fixtures'
import { stateSchema, initialState, type Repository, type RepositoryImportProgress } from '../src/shared/model'
import { hasUnsavedSettings } from '../src/renderer/settings-model'
it('warns for unsaved preferences, template and repository edits while destination changes apply independently', () => {
    const saved = initialState()
    const repository: Repository = {
        id: 'repo',
        name: 'Project',
        path: 'project',
        remote: '',
        base: 'main',
        trackingStart: '2026-10-05',
        emails: ['me@example.com'],
        available: true,
        removed: false,
        branchBases: {},
        branches: ['main']
    }
    saved.repositories = [repository]
    const dirty = (settings = saved.settings, repos = saved.repositories) => hasUnsavedSettings(settings, repos, saved)
    expect(dirty()).toBe(false)
    for (const patch of [
        { timezone: 'UTC' === saved.settings.timezone ? 'Europe/Istanbul' : 'UTC' },
        { refreshMinutes: saved.settings.refreshMinutes + 1 },
        { weekStart: (saved.settings.weekStart + 1) % 7 },
        {
            template: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New template' }] }]
            }
        }
    ])
        expect(dirty({ ...saved.settings, ...patch })).toBe(true)
    expect(
        dirty({
            ...saved.settings,
            destination: { kind: 'page', id: 'confirmed-page', titleProperty: 'Name', dateProperty: '' }
        })
    ).toBe(false)
    for (const patch of [
        { base: 'develop' },
        { remote: 'https://github.com/example/project' },
        { trackingStart: '2026-10-06' },
        { emails: ['other@example.com'] },
        { removed: true }
    ])
        expect(dirty(saved.settings, [{ ...repository, ...patch }])).toBe(true)
    expect(dirty()).toBe(false)
})
it('compares against the latest saved settings and ignores refreshed metadata and object key order', () => {
    const saved = initialState()
    const template = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2, id: 'heading' } }] }
    saved.settings.template = template
    const local = { ...saved.settings, refreshMinutes: saved.settings.refreshMinutes + 1 }
    expect(hasUnsavedSettings(local, [], saved)).toBe(true)
    saved.settings = { ...local, layout: { ...local.layout, hidden: ['details'] } }
    expect(hasUnsavedSettings(local, [], saved)).toBe(false)
    expect(
        hasUnsavedSettings(
            { ...local, template: { content: [{ attrs: { id: 'heading', level: 2 }, type: 'heading' }], type: 'doc' } },
            [],
            saved
        )
    ).toBe(false)
})
const execute = promisify(execFile)
it('imports nested repositories once, skips dependency folders, and resumes stopped tracking', async () => {
    const app = await workspace()
    const parent = await mkdtemp(join(tmpdir(), 'gitorian-discovery-'))
    try {
        const paths = [join(parent, 'one'), join(parent, 'team', 'two'), join(parent, 'node_modules', 'ignored')]
        for (const path of paths) {
            await mkdir(path, { recursive: true })
            await execute('git', ['init', '-b', 'main'], { cwd: path, windowsHide: true })
        }
        await mkdir(join(parent, 'one', 'nested'), { recursive: true })
        await execute('git', ['init'], { cwd: join(parent, 'one', 'nested'), windowsHide: true })
        await mkdir(join(parent, 'broken', '.git'), { recursive: true })
        const discovered = await discoverRepositories(parent)
        expect(discovered.paths).toContain(await realpath(paths[0]))
        expect(discovered.paths).not.toContain(paths[2])
        const progress: RepositoryImportProgress[] = []
        const scan = (await run(app.service.scanRepositories(parent, (update) => progress.push(update))))
            .repositoryScan!
        expect((await journalState(app.store)).repositories).toHaveLength(1)
        expect((await journalState(app.store)).repositoryImport).toBeUndefined()
        const first = await run(
            app.service.importRepositories(
                scan.id,
                scan.repositories.map((item) => item.path),
                (update) => progress.push(update)
            )
        )
        expect(progress[0]).toEqual({ stage: 'discovering', scanned: 0, found: 0 })
        const discovery = progress.filter((update) => update.stage === 'discovering')
        expect(discovery.at(-1)?.found).toBe(3)
        expect(discovery.map((update) => update.scanned)).toEqual([...discovery.keys()])
        expect(progress.filter((update) => update.stage === 'processing')).toEqual([
            { stage: 'processing', completed: 0, total: 3 },
            { stage: 'processing', completed: 1, total: 3 },
            { stage: 'processing', completed: 2, total: 3 },
            { stage: 'processing', completed: 3, total: 3 }
        ])
        expect(first.message).toContain('Added 2 repositories.')
        expect(first.message).toContain('1 unreadable or invalid folders skipped.')
        expect(first.state.repositories.map((repo) => repo.name)).toContain('two')
        expect(first.state.repositories).toHaveLength(3)
        const tracked = (await journalState(app.store)).repositories.find((repo) => repo.name === 'one')!
        const id = tracked.id
        tracked.removed = true
        await app.store.saveRepository(tracked)
        const rescan = (await run(app.service.scanRepositories(parent))).repositoryScan!
        expect(rescan.repositories.find((item) => item.name === 'one')?.status).toBe('stopped')
        expect(rescan.repositories.find((item) => item.name === 'two')?.status).toBe('tracked')
        const again = await run(
            app.service.importRepositories(
                rescan.id,
                rescan.repositories.map((item) => item.path)
            )
        )
        expect(again.message).toContain('Added 0 repositories.')
        expect(again.message).toContain('Resumed tracking 1.')
        expect(again.state.repositories).toHaveLength(3)
        expect(again.state.repositories.find((repo) => repo.id === id)?.removed).toBe(false)
        // A selected subdirectory of an existing repository cannot create a duplicate.
        await expect(run(app.service.addRepository(join(app.directory, '.git')))).rejects.toThrow()
    } finally {
        await app.close()
        const target = resolve(parent)
        if (target.startsWith(resolve(tmpdir()) + sep) && target.includes('gitorian-discovery-'))
            await rm(target, { recursive: true, force: true })
    }
})
it('imports only checked repositories and rejects stale scans and paths outside the scan', async () => {
    const app = await workspace()
    const parent = await mkdtemp(join(tmpdir(), 'gitorian-selection-'))
    try {
        for (const name of ['include', 'exclude']) {
            const path = join(parent, name)
            await mkdir(path)
            await promisify(execFile)('git', ['init', '-b', 'main'], { cwd: path, windowsHide: true })
        }
        const abandoned = (await run(app.service.scanRepositories(parent))).repositoryScan!
        const scan = (await run(app.service.scanRepositories(parent))).repositoryScan!
        await expect(run(app.service.importRepositories(abandoned.id, [scan.repositories[0].path]))).rejects.toThrow(
            'expired'
        )
        await expect(run(app.service.importRepositories(scan.id, [app.directory]))).rejects.toThrow('scanned folder')
        await expect(run(app.service.importRepositories(scan.id, []))).rejects.toThrow('Select repositories')
        expect((await journalState(app.store)).repositories).toHaveLength(1)
        const selected = scan.repositories.find((item) => item.name === 'include')!.path
        await run(app.service.importRepositories(scan.id, [selected, selected]))
        expect((await journalState(app.store)).repositories.map((item) => item.name)).toContain('include')
        expect((await journalState(app.store)).repositories.map((item) => item.name)).not.toContain('exclude')
        expect((await journalState(app.store)).repositoryImport?.total).toBe(1)
        await expect(run(app.service.importRepositories(scan.id, [selected]))).rejects.toThrow('expired')
    } finally {
        await app.close()
        const target = resolve(parent)
        if (target.startsWith(resolve(tmpdir()) + sep) && target.includes('gitorian-selection-'))
            await rm(target, { recursive: true, force: true })
    }
})
it('uses a saved Arc template for new drafts without changing existing writing', async () => {
    const app = await journal()
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const original = structuredClone((await journalState(app.store)).drafts[0].body)
        const template = {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What changed' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Keep one lesson.', marks: [{ type: 'bold' }] }] }
            ]
        }
        const openSettings = structuredClone((await journalState(app.store)).settings)
        await app.store.setDestination({
            kind: 'page',
            id: 'newly-confirmed-page',
            titleProperty: 'Name',
            dateProperty: ''
        })
        await run(app.service.handle({ type: 'settings', settings: { ...openSettings, template } }))
        expect((await journalState(app.store)).settings.destination?.id).toBe('newly-confirmed-page')
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-12' }))
        expect((await journalState(app.store)).drafts[1].body).toEqual(template)
        expect((await journalState(app.store)).drafts[0].body).toEqual(original)
        await editDraft(app.store, 1, (draft) => {
            draft.body.content![0].content![0].text = 'Edited independently'
        })
        expect((await journalState(app.store)).settings.template).toEqual(template)
    } finally {
        await app.close()
    }
})
it('discards obsolete OAuth app settings from old journals without losing account or writing', () => {
    const saved = initialState()
    const restored = stateSchema.parse({ ...saved, settings: { ...saved.settings, githubClientId: 'old-user-app' } })
    expect(restored.settings).not.toHaveProperty('githubClientId')
    expect(restored.settings.template).toEqual(saved.settings.template)
})
it('reports invalid timezone settings through the recoverable journal failure channel', async () => {
    const app = await journal()
    try {
        const before = structuredClone((await journalState(app.store)).settings)
        const result = await run(
            app.service
                .handle({ type: 'settings', settings: { ...before, timezone: 'Invalid/Zone' } })
                .pipe(Effect.catchAll((error) => Effect.succeed({ failure: error instanceof JournalError })))
        )
        expect(result).toEqual({ failure: true })
        expect((await journalState(app.store)).settings).toEqual(before)
    } finally {
        await app.close()
    }
})
