import { expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { discoverRepositories } from '../src/main/repository-discovery'
import { workspace } from './fixtures'

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
        const first = await app.service.addRepositories(parent)
        expect(first.message).toContain('Added 2 repositories.')
        expect(first.message).toContain('1 unreadable or invalid folders skipped.')
        expect(first.state.repositories.map((repo) => repo.name)).toContain('two')
        expect(first.state.repositories).toHaveLength(3)
        const tracked = app.store.state.repositories.find((repo) => repo.name === 'one')!
        const id = tracked.id
        tracked.removed = true
        const again = await app.service.addRepositories(parent)
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

it('uses a saved Arc template for new drafts without changing existing writing', async () => {
    const app = await workspace()
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
