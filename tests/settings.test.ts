import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { discoverRepositories } from '../src/main/repository-discovery'
import { hasUnsavedSettings } from '../src/renderer/settings-model'
import type { Repository, RepositoryImportProgress } from '../src/shared/model'
import { initialState } from '../src/shared/model'
import { required } from '../src/shared/required'
import { workspace } from './fixtures'

describe('settings', () => {
    it('warns for unsaved preferences, template, destination, repository edits and connection input', () => {
        const saved = initialState()
        const repository: Repository = {
            available: true,
            base: 'main',
            branchBases: {},
            branches: ['main'],
            emails: ['me@example.com'],
            id: 'repo',
            name: 'Project',
            path: 'project',
            remote: '',
            removed: false,
            trackingStart: '2026-10-05'
        }
        saved.repositories = [repository]
        const dirty = (settings = saved.settings, repos = saved.repositories, token = '') =>
            hasUnsavedSettings(settings, repos, saved, token)
        expect(dirty()).toBeFalsy()
        for (const patch of [
            { timezone: saved.settings.timezone === 'UTC' ? 'Europe/Istanbul' : 'UTC' },
            { refreshMinutes: saved.settings.refreshMinutes + 1 },
            { weekStart: (saved.settings.weekStart + 1) % 7 },
            { githubClientId: 'new-client' },
            {
                template: {
                    content: [{ content: [{ text: 'New template', type: 'text' }], type: 'paragraph' }],
                    type: 'doc'
                }
            },
            { destination: { dateProperty: '', id: 'new-page', kind: 'page' as const, titleProperty: 'Name' } }
        ]) {
            expect(dirty({ ...saved.settings, ...patch })).toBeTruthy()
        }
        for (const patch of [
            { base: 'develop' },
            { remote: 'https://github.com/example/project' },
            { trackingStart: '2026-10-06' },
            { emails: ['other@example.com'] },
            { removed: true }
        ]) {
            expect(dirty(saved.settings, [{ ...repository, ...patch }])).toBeTruthy()
        }
        expect([
            Boolean(dirty(saved.settings, saved.repositories, 'unsubmitted-token')),
            Boolean(dirty())
        ]).toStrictEqual([true, false])
    })

    it('compares against the latest saved settings and ignores refreshed metadata and object key order', () => {
        const saved = initialState()
        const template = { content: [{ attrs: { id: 'heading', level: 2 }, type: 'heading' }], type: 'doc' }
        saved.settings.template = template
        const local = { ...saved.settings, refreshMinutes: saved.settings.refreshMinutes + 1 }
        expect(hasUnsavedSettings(local, [], saved, '')).toBeTruthy()
        saved.settings = { ...local, githubLogin: 'signed-in', layout: { ...local.layout, hidden: ['details'] } }
        expect([
            Boolean(hasUnsavedSettings(local, [], saved, '')),
            Boolean(
                hasUnsavedSettings(
                    {
                        ...local,
                        template: { content: [{ attrs: { id: 'heading', level: 2 }, type: 'heading' }], type: 'doc' }
                    },
                    [],
                    saved,
                    ''
                )
            )
        ]).toStrictEqual([false, false])
    })

    const execute = promisify(execFile)

    it('imports nested repositories once, skips dependency folders, and resumes stopped tracking', async () => {
        const app = await workspace()
        const parent = await mkdtemp(nodePath.join(tmpdir(), 'weekly-j-discovery-'))
        try {
            const paths = [
                nodePath.join(parent, 'one'),
                nodePath.join(parent, 'team', 'two'),
                nodePath.join(parent, 'node_modules', 'ignored')
            ]
            for await (const path of paths) {
                await mkdir(path, { recursive: true })
                await execute('git', ['init', '-b', 'main'], { cwd: path, windowsHide: true })
            }
            await mkdir(nodePath.join(parent, 'one', 'nested'), { recursive: true })
            await execute('git', ['init'], { cwd: nodePath.join(parent, 'one', 'nested'), windowsHide: true })
            await mkdir(nodePath.join(parent, 'broken', '.git'), { recursive: true })
            const discovered = await discoverRepositories(parent)
            expect([
                discovered.paths?.includes(await realpath(paths[0])),
                discovered.paths?.includes(paths[2])
            ]).toStrictEqual([true, false])
            const progress: RepositoryImportProgress[] = []
            const first = await app.service.addRepositories(parent, (update) => progress.push(update))
            expect(progress[0]).toStrictEqual({ found: 0, scanned: 0, stage: 'discovering' })
            const discovery = progress.filter((update) => update.stage === 'discovering')
            expect([
                Object.is(discovery.at(-1)?.found, 3),
                discovery.map((update) => update.scanned),
                progress.filter((update) => update.stage === 'processing'),
                first.message?.includes('Added 2 repositories.'),
                first.message?.includes('1 unreadable or invalid folders skipped.'),
                first.state.repositories.map((repo) => repo.name)?.includes('two'),
                first.state.repositories?.length
            ]).toStrictEqual([
                true,
                [...discovery.keys()],
                [
                    { completed: 0, stage: 'processing', total: 3 },
                    { completed: 1, stage: 'processing', total: 3 },
                    { completed: 2, stage: 'processing', total: 3 },
                    { completed: 3, stage: 'processing', total: 3 }
                ],
                true,
                true,
                true,
                3
            ])
            const tracked = required(app.store.state.repositories.find((repo) => repo.name === 'one'))
            const { id } = tracked
            tracked.removed = true
            const again = await app.service.addRepositories(parent)
            expect([
                again.message?.includes('Added 0 repositories.'),
                again.message?.includes('Resumed tracking 1.'),
                again.state.repositories?.length,
                Boolean(again.state.repositories.find((repo) => repo.id === id)?.removed)
            ]).toStrictEqual([true, true, 3, false])
            // A selected subdirectory of an existing repository cannot create a duplicate.
            await expect(app.service.addRepository(nodePath.join(app.directory, '.git'))).rejects.toThrow(
                /git|tracked/u
            )
        } finally {
            await app.close()
            const target = nodePath.resolve(parent)
            if (
                target.startsWith(nodePath.resolve(tmpdir()) + nodePath.sep) &&
                target.includes('weekly-j-discovery-')
            ) {
                await rm(target, { force: true, recursive: true })
            }
        }
    })

    it('uses a saved Arc template for new drafts without changing existing writing', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const original = structuredClone(app.store.state.drafts[0].body)
            const template = {
                content: [
                    { attrs: { level: 2 }, content: [{ text: 'What changed', type: 'text' }], type: 'heading' },
                    {
                        content: [{ marks: [{ type: 'bold' }], text: 'Keep one lesson.', type: 'text' }],
                        type: 'paragraph'
                    }
                ],
                type: 'doc'
            }
            await app.service.handle({ settings: { ...app.store.state.settings, template }, type: 'settings' })
            await app.service.handle({ type: 'newDraft', week: '2026-10-12' })
            expect([app.store.state.drafts[1].body, app.store.state.drafts[0].body]).toStrictEqual([template, original])
            required(required(app.store.state.drafts[1].body.content)[0].content)[0].text = 'Edited independently'
            expect(app.store.state.settings.template).toStrictEqual(template)
        } finally {
            await app.close()
        }
    })
})
