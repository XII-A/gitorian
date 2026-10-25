import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { commits, commitDetails, inspectRepository, githubRemote } from '../src/main/git'
import { workspace } from './fixtures'
import { inbox, weekOf } from '../src/shared/model'
import { parseDiff } from 'react-diff-view'
import { hasCachedDetails } from '../src/renderer/activity-cache'

it('chooses a GitHub fetch source using upstream, origin, then another named remote', async () => {
    const app = await workspace()
    try {
        await app.git('remote', 'add', 'origin', 'https://example.com/local/project.git')
        await app.git('remote', 'add', 'work', 'ssh://git@github.com/team/project.git')
        expect((await inspectRepository(app.directory)).githubRemote).toBe('ssh://git@github.com/team/project.git')
        await app.git('remote', 'set-url', 'origin', 'git@github.com:author/project.git')
        expect((await inspectRepository(app.directory)).githubRemote).toBe('git@github.com:author/project.git')
        await app.git('remote', 'add', 'upstream', 'https://github.com/team/project.git')
        await app.git('remote', 'set-url', '--push', 'upstream', 'https://github.com/other/project.git')
        expect((await inspectRepository(app.directory)).githubRemote).toBe('https://github.com/team/project.git')
        for (const name of ['origin', 'work', 'upstream']) await app.git('remote', 'remove', name)
        expect((await inspectRepository(app.directory)).githubRemote).toBe('')
    } finally {
        await app.close()
    }
})

it('recognizes the GitHub SSH URL form used by automatic repository sources', () => {
    expect(githubRemote('ssh://git@github.com/team/project.git')).toBe('team/project')
    expect(githubRemote('ssh://git@example.com/team/project.git')).toBeUndefined()
})

it('loads first-parent merge changes and replaces cached combined patches', async () => {
    const app = await workspace()
    try {
        await app.git('checkout', '-b', 'feature')
        await writeFile(join(app.directory, 'work.txt'), 'feature\n')
        await writeFile(join(app.directory, 'feature.txt'), 'new feature\n')
        await app.git('add', 'work.txt', 'feature.txt')
        await app.git('commit', '-m', 'Feature work')
        await app.git('checkout', 'development')
        await writeFile(join(app.directory, 'work.txt'), 'development\n')
        await app.git('add', 'work.txt')
        await app.git('commit', '-m', 'Development work')
        await expect(app.git('merge', '--no-ff', 'feature')).rejects.toThrow()
        await writeFile(join(app.directory, 'work.txt'), 'resolved\n')
        await app.git('add', 'work.txt')
        await app.git('commit', '-m', 'Resolve merge')
        const sha = await app.git('rev-parse', 'HEAD')
        const combined = await app.git('show', '--format=', sha)
        expect(combined).toMatch(/^diff --cc /)
        const activity = (await commits(app.repository, 'development', 'history')).find((item) => item.sha === sha)!
        app.store.state.activities.push(activity)
        app.store.state.diffs[activity.id] = combined
        expect(hasCachedDetails(app.store.state, activity)).toBe(false)
        const reply = await app.service.handle({ type: 'details', activityId: activity.id })
        expect(reply.diff).toMatch(/^diff --git /)
        expect(
            parseDiff(reply.diff!)
                .map((file) => file.newPath)
                .sort()
        ).toEqual(['feature.txt', 'work.txt'])
        expect(activity.files).toEqual(
            expect.arrayContaining([
                { name: 'feature.txt', status: 'A', lineStats: { additions: 1, deletions: 0 } },
                { name: 'work.txt', status: 'M', lineStats: { additions: 1, deletions: 1 } }
            ])
        )
        expect(reply.diff).toContain('-development')
        expect(reply.diff).toContain('+resolved')
        expect(hasCachedDetails(app.store.state, activity)).toBe(true)
        expect((await commitDetails(app.repository, sha, false)).files).toEqual(activity.files)
    } finally {
        await app.close()
    }
})

it('preserves old and new rename paths and filenames containing whitespace in commit details', async () => {
    const app = await workspace()
    try {
        await app.git('mv', 'work.txt', 'renamed work.txt')
        await writeFile(join(app.directory, ' leading space.txt'), 'new file\n')
        await writeFile(join(app.directory, 'binary.dat'), Buffer.from([0, 1, 2, 3]))
        await app.git('add', 'binary.dat')
        await app.git('add', ' leading space.txt')
        await app.git('commit', '-m', 'Rename work and add a file')
        const details = await commitDetails(app.repository, await app.git('rev-parse', 'HEAD'), false)
        expect(details.files).toEqual(
            expect.arrayContaining([
                {
                    name: 'renamed work.txt',
                    previousName: 'work.txt',
                    status: 'R100',
                    lineStats: { additions: 0, deletions: 0 }
                },
                { name: ' leading space.txt', status: 'A', lineStats: { additions: 1, deletions: 0 } },
                { name: 'binary.dat', status: 'A', lineStats: null }
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

it('retains captured metadata, diffs and journal associations after a branch is deleted', async () => {
    const app = await workspace()
    try {
        await app.git('checkout', '-b', 'temporary')
        await app.git('commit', '--allow-empty', '-m', 'Temporary work')
        await app.service.handle({ type: 'refresh' })
        const activity = app.store.state.activities.find((item) => item.title === 'Temporary work')!
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
        const filtered = await app.service.handle({
            type: 'history',
            repositoryId: app.repository.id,
            branch: 'development',
            view: 'history',
            author: ['missing@example.com', ' OTHER@EXAMPLE.COM '],
            since: ''
        })
        expect(filtered.activityIds).toEqual([other.id])
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
