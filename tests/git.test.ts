import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { commits } from '../src/main/git'
import { workspace } from './fixtures'

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
