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

it('warns for unsaved preferences, template, destination, repository edits and connection input', () => {
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
    const dirty = (settings = saved.settings, repos = saved.repositories, token = '') =>
        hasUnsavedSettings(settings, repos, saved, token)
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
        },
        { destination: { kind: 'page' as const, id: 'new-page', titleProperty: 'Name', dateProperty: '' } }
    ])
        expect(dirty({ ...saved.settings, ...patch })).toBe(true)
    for (const patch of [
        { base: 'develop' },
        { remote: 'https://github.com/example/project' },
        { trackingStart: '2026-10-06' },
        { emails: ['other@example.com'] },
        { removed: true }
    ])
        expect(dirty(saved.settings, [{ ...repository, ...patch }])).toBe(true)
    expect(dirty(saved.settings, saved.repositories, 'unsubmitted-token')).toBe(true)
    expect(dirty()).toBe(false)
})

it('compares against the latest saved settings and ignores refreshed metadata and object key order', () => {
    const saved = initialState()
    const template = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2, id: 'heading' } }] }
    saved.settings.template = template
    const local = { ...saved.settings, refreshMinutes: saved.settings.refreshMinutes + 1 }
    expect(hasUnsavedSettings(local, [], saved, '')).toBe(true)
    saved.settings = { ...local, githubLogin: 'signed-in', layout: { ...local.layout, hidden: ['details'] } }
    expect(hasUnsavedSettings(local, [], saved, '')).toBe(false)
    expect(
        hasUnsavedSettings(
            { ...local, template: { content: [{ attrs: { id: 'heading', level: 2 }, type: 'heading' }], type: 'doc' } },
            [],
            saved,
            ''
        )
    ).toBe(false)
})

const execute = promisify(execFile)
it('imports nested repositories once, skips dependency folders, and resumes stopped tracking', async () => {
    const app = await workspace()
    const parent = await mkdtemp(join(tmpdir(), 'weekly-j-discovery-'))
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
        const scan = (await app.service.scanRepositories(parent, (update) => progress.push(update))).repositoryScan!
        expect(app.store.state.repositories).toHaveLength(1)
        expect(app.store.state.repositoryImport).toBeUndefined()
        const first = await app.service.importRepositories(
            scan.id,
            scan.repositories.map((item) => item.path),
            (update) => progress.push(update)
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
        const tracked = app.store.state.repositories.find((repo) => repo.name === 'one')!
        const id = tracked.id
        tracked.removed = true
        const rescan = (await app.service.scanRepositories(parent)).repositoryScan!
        expect(rescan.repositories.find((item) => item.name === 'one')?.status).toBe('stopped')
        expect(rescan.repositories.find((item) => item.name === 'two')?.status).toBe('tracked')
        const again = await app.service.importRepositories(
            rescan.id,
            rescan.repositories.map((item) => item.path)
        )
        expect(again.message).toContain('Added 0 repositories.')
        expect(again.message).toContain('Resumed tracking 1.')
        expect(again.state.repositories).toHaveLength(3)
        expect(again.state.repositories.find((repo) => repo.id === id)?.removed).toBe(false)
        // A selected subdirectory of an existing repository cannot create a duplicate.
        await expect(app.service.addRepository(join(app.directory, '.git'))).rejects.toThrow()
    } finally {
        await app.close()
        const target = resolve(parent)
        if (target.startsWith(resolve(tmpdir()) + sep) && target.includes('weekly-j-discovery-'))
            await rm(target, { recursive: true, force: true })
    }
})

it('imports only checked repositories and rejects stale scans and paths outside the scan', async () => {
    const app = await workspace()
    const parent = await mkdtemp(join(tmpdir(), 'weekly-j-selection-'))
    try {
        for (const name of ['include', 'exclude']) {
            const path = join(parent, name)
            await mkdir(path)
            await promisify(execFile)('git', ['init', '-b', 'main'], { cwd: path, windowsHide: true })
        }
        const abandoned = (await app.service.scanRepositories(parent)).repositoryScan!
        const scan = (await app.service.scanRepositories(parent)).repositoryScan!
        await expect(app.service.importRepositories(abandoned.id, [scan.repositories[0].path])).rejects.toThrow(
            'expired'
        )
        await expect(app.service.importRepositories(scan.id, [app.directory])).rejects.toThrow('scanned folder')
        await expect(app.service.importRepositories(scan.id, [])).rejects.toThrow('Select repositories')
        expect(app.store.state.repositories).toHaveLength(1)
        const selected = scan.repositories.find((item) => item.name === 'include')!.path
        await app.service.importRepositories(scan.id, [selected, selected])
        expect(app.store.state.repositories.map((item) => item.name)).toContain('include')
        expect(app.store.state.repositories.map((item) => item.name)).not.toContain('exclude')
        expect(app.store.state.repositoryImport?.total).toBe(1)
        await expect(app.service.importRepositories(scan.id, [selected])).rejects.toThrow('expired')
    } finally {
        await app.close()
        const target = resolve(parent)
        if (target.startsWith(resolve(tmpdir()) + sep) && target.includes('weekly-j-selection-'))
            await rm(target, { recursive: true, force: true })
    }
})

it('uses a saved Arc template for new drafts without changing existing writing', async () => {
    const app = await journal()
    try {
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        const original = structuredClone(app.store.state.drafts[0].body)
        const template = {
            type: 'doc',
            content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What changed' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Keep one lesson.', marks: [{ type: 'bold' }] }] }
            ]
        }
        await app.service.handle({ type: 'settings', settings: { ...app.store.state.settings, template } })
        await app.service.handle({ type: 'newDraft', week: '2026-10-12' })
        expect(app.store.state.drafts[1].body).toEqual(template)
        expect(app.store.state.drafts[0].body).toEqual(original)
        app.store.state.drafts[1].body.content![0].content![0].text = 'Edited independently'
        expect(app.store.state.settings.template).toEqual(template)
    } finally {
        await app.close()
    }
})

it('discards obsolete OAuth app settings from old journals without losing account or writing', () => {
    const saved = initialState()
    saved.settings.githubLogin = 'existing-author'
    const restored = stateSchema.parse({ ...saved, settings: { ...saved.settings, githubClientId: 'old-user-app' } })
    expect(restored.settings).not.toHaveProperty('githubClientId')
    expect(restored.settings.githubLogin).toBe('existing-author')
    expect(restored.settings.template).toEqual(saved.settings.template)
})
