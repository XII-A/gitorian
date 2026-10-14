import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import nodePath from 'node:path'
import { promisify } from 'node:util'

import { parseDiff } from 'react-diff-view'
import { describe, expect, it } from 'vitest'

import { commitDetails, commits } from '../src/main/git'
import { hasCachedDetails } from '../src/renderer/activity-cache'
import { inbox, weekOf } from '../src/shared/model'
import { required } from '../src/shared/required'
import { workspace } from './fixtures'

describe('git', () => {
    it('loads first-parent merge changes and replaces cached combined patches', async () => {
        const app = await workspace()
        try {
            await app.git('checkout', '-b', 'feature')
            await writeFile(nodePath.join(app.directory, 'work.txt'), 'feature\n')
            await writeFile(nodePath.join(app.directory, 'feature.txt'), 'new feature\n')
            await app.git('add', 'work.txt', 'feature.txt')
            await app.git('commit', '-m', 'Feature work')
            await app.git('checkout', 'development')
            await writeFile(nodePath.join(app.directory, 'work.txt'), 'development\n')
            await app.git('add', 'work.txt')
            await app.git('commit', '-m', 'Development work')
            await expect(app.git('merge', '--no-ff', 'feature')).rejects.toThrow(
                'Command failed: git merge --no-ff feature'
            )
            await writeFile(nodePath.join(app.directory, 'work.txt'), 'resolved\n')
            await app.git('add', 'work.txt')
            await app.git('commit', '-m', 'Resolve merge')
            const sha = await app.git('rev-parse', 'HEAD')
            const combined = await app.git('show', '--format=', sha)
            expect(combined).toMatch(/^diff --cc /u)
            const awaited1 = await commits(app.repository, 'development', 'history')
            const activity = required(awaited1.find((item) => item.sha === sha))
            app.store.state.activities.push(activity)
            app.store.state.diffs[activity.id] = combined
            expect(hasCachedDetails(app.store.state, activity)).toBeFalsy()
            const reply = await app.service.handle({ activityId: activity.id, type: 'details' })
            expect(reply.diff).toMatch(/^diff --git /u)
            const awaited2 = await commitDetails(app.repository, sha, false)
            expect([
                parseDiff(required(reply.diff))
                    .map((file) => file.newPath)
                    .toSorted(),
                activity.files,
                reply.diff?.includes('-development'),
                reply.diff?.includes('+resolved'),
                Boolean(hasCachedDetails(app.store.state, activity)),
                awaited2.files
            ]).toStrictEqual([
                ['feature.txt', 'work.txt'],
                expect.arrayContaining([
                    { name: 'feature.txt', status: 'A' },
                    { name: 'work.txt', status: 'M' }
                ]),
                true,
                true,
                true,
                activity.files
            ])
        } finally {
            await app.close()
        }
    })

    it('preserves old and new rename paths and filenames containing whitespace in commit details', async () => {
        const app = await workspace()
        try {
            await app.git('mv', 'work.txt', 'renamed work.txt')
            await writeFile(nodePath.join(app.directory, ' leading space.txt'), 'new file\n')
            await app.git('add', ' leading space.txt')
            await app.git('commit', '-m', 'Rename work and add a file')
            const details = await commitDetails(app.repository, await app.git('rev-parse', 'HEAD'), false)
            expect([details.files, Object.is(details.diff, '')]).toStrictEqual([
                expect.arrayContaining([
                    { name: 'renamed work.txt', previousName: 'work.txt', status: 'R100' },
                    { name: ' leading space.txt', status: 'A' }
                ]),
                true
            ])
        } finally {
            await app.close()
        }
    })

    it('uses author dates after rewriting commits and compares ordinary branches against development', async () => {
        const app = await workspace()
        try {
            await app.git('checkout', '-b', 'feature')
            await writeFile(nodePath.join(app.directory, 'work.txt'), 'feature\n')
            await app.git('add', 'work.txt')
            const execute = promisify(execFile)
            await execute('git', ['commit', '-m', 'Old authored work'], {
                cwd: app.directory,
                env: {
                    ...process.env,
                    GIT_AUTHOR_DATE: '2025-01-06T12:00:00Z',
                    GIT_COMMITTER_DATE: '2026-10-07T12:00:00Z'
                },
                windowsHide: true
            })
            const introduced = await commits(app.repository, 'feature', 'introduced')
            expect([
                introduced.map((item) => item.title),
                Object.is(new Date(introduced[0].date).toISOString(), '2025-01-06T12:00:00.000Z')
            ]).toStrictEqual([['Old authored work'], true])
            const before = await app.git('status', '--porcelain')
            const refs = await app.git('show-ref')
            await app.service.handle({
                author: 'first',
                branch: 'feature',
                repositoryId: app.repository.id,
                since: '',
                type: 'history',
                view: 'introduced'
            })
            await app.service.handle({ activityId: introduced[0].id, type: 'details' })
            await expect(app.git('status', '--porcelain')).resolves.toBe(before)
            await expect(app.git('show-ref')).resolves.toBe(refs)
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
            const activity = required(app.store.state.activities.find((item) => item.title === 'Temporary work'))
            await app.service.handle({
                archived: false,
                id: 'feature',
                members: [`branch:${app.repository.id}:temporary`],
                name: 'Persistent thread',
                type: 'feature'
            })
            await app.service.handle({ activityId: activity.id, type: 'details' })
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            await app.service.handle({
                activityId: activity.id,
                draftId: app.store.state.drafts[0].id,
                included: true,
                type: 'select'
            })
            await app.service.handle({ draftId: app.store.state.drafts[0].id, type: 'publish' })
            await app.git('checkout', 'development')
            await app.git('branch', '-D', 'temporary')
            await app.service.handle({ type: 'refresh' })
            expect([
                activity.deletedBranches?.includes('temporary'),
                Object.is(app.store.state.coverage[0].activityId, activity.id)
            ]).toStrictEqual([true, true])
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
                author: '',
                branch: 'development',
                repositoryId: app.repository.id,
                since: '',
                type: 'history',
                view: 'history'
            })
            const other = required(app.store.state.activities.find((item) => item.title === 'Other author work'))
            expect(other).toBeDefined()
            const filtered = await app.service.handle({
                author: ['missing@example.com', ' OTHER@EXAMPLE.COM '],
                branch: 'development',
                repositoryId: app.repository.id,
                since: '',
                type: 'history',
                view: 'history'
            })
            expect([
                filtered.activityIds,
                Boolean(
                    inbox(app.store.state, weekOf(new Date(), app.store.state.settings)).some(
                        (item) => item.id === other.id
                    )
                )
            ]).toStrictEqual([[other.id], false])
            await app.service.handle({ type: 'newDraft', week: weekOf(new Date(), app.store.state.settings) })
            await app.service.handle({
                activityId: other.id,
                draftId: app.store.state.drafts[0].id,
                included: true,
                type: 'select'
            })
            expect(
                inbox(app.store.state, weekOf(new Date(), app.store.state.settings)).some(
                    (item) => item.id === other.id
                )
            ).toBeTruthy()
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
                author: '',
                branch: 'origin/feature',
                repositoryId: app.repository.id,
                since: '',
                type: 'history',
                view: 'introduced'
            })
            expect([
                Object.is(reply.message, 'Comparison: main'),
                reply.activityIds?.length,
                Object.is(app.repository.base, 'development')
            ]).toStrictEqual([true, 2, true])
        } finally {
            await app.close()
        }
    })
})
