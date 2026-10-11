import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { commits, commitDetails } from '../src/main/git'
import { workspace } from './fixtures'
import { inbox, weekOf } from '../src/shared/model'

it('preserves old and new rename paths and filenames containing whitespace in commit details', async () => {
    const app = await workspace()
    try {
        await app.git('mv', 'work.txt', 'renamed work.txt')
        await writeFile(join(app.directory, ' leading space.txt'), 'new file\n')
        await app.git('add', ' leading space.txt')
        await app.git('commit', '-m', 'Rename work and add a file')
        const details = await commitDetails(app.repository, await app.git('rev-parse', 'HEAD'), false)
        expect(details.files).toEqual(
            expect.arrayContaining([
                { name: 'renamed work.txt', previousName: 'work.txt', status: 'R100' },
                { name: ' leading space.txt', status: 'A' }
            ])
        )
        expect(details.diff).toBe('')
    } finally {
        await app.close()
    }
})

it('uses author dates after rewriting commits and compares ordinary branches against development', async () => {
    const app = await workspace()
    try {
        await app.git('checkout', '-b', 'feature')
        await writeFile(join(app.directory, 'work.txt'), 'feature\n')
        await app.git('add', 'work.txt')
        const execute = promisify(execFile)
        await execute('git', ['commit', '-m', 'Old authored work'], {
            cwd: app.directory,
            windowsHide: true,
            env: { ...process.env, GIT_AUTHOR_DATE: '2025-01-06T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-07T12:00:00Z' }
        })
        const introduced = await commits(app.repository, 'feature', 'introduced')
        expect(introduced.map((item) => item.title)).toEqual(['Old authored work'])
        expect(new Date(introduced[0].date).toISOString()).toBe('2025-01-06T12:00:00.000Z')
        const before = await app.git('status', '--porcelain')
        const refs = await app.git('show-ref')
        await app.service.handle({
            type: 'history',
            repositoryId: app.repository.id,
            branch: 'feature',
            view: 'introduced',
            author: 'first',
            since: ''
        })
        await app.service.handle({ type: 'details', activityId: introduced[0].id })
        expect(await app.git('status', '--porcelain')).toBe(before)
        expect(await app.git('show-ref')).toBe(refs)
    } finally {
        await app.close()
    }
})

it('retains captured metadata, diffs, features and journal associations after a branch is deleted', async () => {
    const app = await workspace()
    try {
        await app.git('checkout', '-b', 'temporary')
        await app.git('commit', '--allow-empty', '-m', 'Temporary work')
        await app.service.handle({ type: 'refresh' })
        const activity = app.store.state.activities.find((item) => item.title === 'Temporary work')!
        await app.service.handle({
            type: 'feature',
            id: 'feature',
            name: 'Persistent thread',
            archived: false,
            members: [`branch:${app.repository.id}:temporary`]
        })
        await app.service.handle({ type: 'details', activityId: activity.id })
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        await app.service.handle({
            type: 'select',
            draftId: app.store.state.drafts[0].id,
            activityId: activity.id,
            included: true
        })
        await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
        await app.git('checkout', 'development')
        await app.git('branch', '-D', 'temporary')
        await app.service.handle({ type: 'refresh' })
        expect(activity.deletedBranches).toContain('temporary')
        expect(app.store.state.coverage[0].activityId).toBe(activity.id)
        expect(app.store.state.diffs).toHaveProperty(activity.id)
        expect(app.store.state.features[0].members).toContain(`branch:${app.repository.id}:temporary`)
    } finally {
        await app.close()
    }
})

it('keeps other authors searchable without admitting their history to the personal inbox', async () => {
    const app = await workspace()
    try {
        await app.git(
            'commit',
            '--allow-empty',
            '--author',
            'Someone else <other@example.com>',
            '-m',
            'Other author work'
        )
        await app.service.handle({
            type: 'history',
            repositoryId: app.repository.id,
            branch: 'development',
            view: 'history',
            author: '',
            since: ''
        })
        const other = app.store.state.activities.find((item) => item.title === 'Other author work')!
        expect(other).toBeDefined()
        expect(
            inbox(app.store.state, weekOf(new Date(), app.store.state.settings)).some((item) => item.id === other.id)
        ).toBe(false)
        await app.service.handle({ type: 'newDraft', week: weekOf(new Date(), app.store.state.settings) })
        await app.service.handle({
            type: 'select',
            draftId: app.store.state.drafts[0].id,
            activityId: other.id,
            included: true
        })
        expect(
            inbox(app.store.state, weekOf(new Date(), app.store.state.settings)).some((item) => item.id === other.id)
        ).toBe(true)
    } finally {
        await app.close()
    }
})

it('uses the linked PR target when browsing a remote-tracking branch', async () => {
    const app = await workspace()
    try {
        await app.git('commit', '--allow-empty', '-m', 'Development ahead of main')
        await app.git('checkout', '-b', 'feature')
        await app.git('commit', '--allow-empty', '-m', 'Feature work')
        await app.git('remote', 'add', 'origin', 'https://github.com/example/project.git')
        await app.git('update-ref', 'refs/remotes/origin/feature', await app.git('rev-parse', 'feature'))
        app.remote.github = true
        await app.service.handle({ type: 'refresh' })
        const reply = await app.service.handle({
            type: 'history',
            repositoryId: app.repository.id,
            branch: 'origin/feature',
            view: 'introduced',
            author: '',
            since: ''
        })
        expect(reply.message).toBe('Comparison: main')
        expect(reply.activityIds).toHaveLength(2)
        expect(app.repository.base).toBe('development')
    } finally {
        await app.close()
    }
})
