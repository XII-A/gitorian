import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { coveredEntries, inbox, weekOf } from '../src/shared/model'
import { required } from '../src/shared/required'
import { patch, workspace } from './fixtures'

describe('revisions', () => {
    beforeEach(() => {
        vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('pins a selected PR revision, retains coverage after equivalent rewrites, and groups later changes', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.repository.emails.push('second@example.com')
            app.repository.trackingStart = '2026-10-05'
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            expect([
                Object.is(pr.base, 'main'),
                Boolean(app.store.state.activities.some((item) => item.kind === 'review' && item.author === 'me')),
                Boolean(
                    app.store.state.activities.some(
                        (item) => item.kind === 'commit' && item.author === 'second@example.com'
                    )
                )
            ]).toStrictEqual([true, true, true])
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const [draft] = app.store.state.drafts
            await app.service.handle({ activityId: pr.id, draftId: draft.id, included: true, type: 'select' })
            const selectedRevision = draft.selections[0].revision
            app.remote.patch = patch.replace('+new', '+later')
            app.remote.head = 'e'.repeat(40)
            await app.service.handle({ type: 'refresh' })
            expect(pr.revision).not.toBe(selectedRevision)
            await app.service.handle({ draftId: draft.id, type: 'publish' })
            expect([
                Object.is(app.store.state.coverage[0].revision, selectedRevision),
                coveredEntries(app.store.state, pr),
                inbox(app.store.state, '2026-10-05').filter((item) => item.kind === 'pr')?.length
            ]).toStrictEqual([true, [], 1])
            app.remote.patch = patch
                .replace('1111111..2222222', '9999999..aaaaaaa')
                .replace('@@ -1 +1 @@', '@@ -9 +9 @@')
            app.remote.head = 'f'.repeat(40)
            await app.service.handle({ type: 'refresh' })
            expect([
                Object.is(pr.revision, selectedRevision),
                coveredEntries(app.store.state, pr)?.length
            ]).toStrictEqual([true, 1])
            app.remote.patch = patch.replace('+new', '+ new')
            await app.service.handle({ type: 'refresh' })
            expect(coveredEntries(app.store.state, pr)).toStrictEqual([])
            app.remote.patch = 'Binary files a/image.png and b/image.png differ'
            await app.service.handle({ type: 'refresh' })
            expect([pr.fingerprint === undefined, coveredEntries(app.store.state, pr)]).toStrictEqual([true, []])
        } finally {
            await app.close()
        }
    })

    it('does not infer whole-PR coverage from commits and suppresses a known integration duplicate', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.remote.merged = true
            app.repository.emails.push('second@example.com')
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            const commit = required(app.store.state.activities.find((item) => item.sha === 'd'.repeat(40)))
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            await app.service.handle({
                activityId: commit.id,
                draftId: app.store.state.drafts[0].id,
                included: true,
                type: 'select'
            })
            await app.service.handle({ draftId: app.store.state.drafts[0].id, type: 'publish' })
            expect(coveredEntries(app.store.state, pr)).toStrictEqual([])
            app.store.state.activities.push({
                ...commit,
                date: '2026-10-07T10:00:00Z',
                id: 'integration',
                sha: 'c'.repeat(40)
            })
            const items = inbox(app.store.state, '2026-10-05')
            expect([
                Boolean(items.some((item) => item.id === 'integration')),
                Boolean(items.some((item) => item.kind === 'merged'))
            ]).toStrictEqual([false, true])
        } finally {
            await app.close()
        }
    })

    it('resumes a verified partial Notion save without creating a second page and maps the selected week', async () => {
        const app = await workspace()
        try {
            app.store.state.settings.destination = {
                dateProperty: 'Week',
                id: 'source',
                kind: 'database',
                titleProperty: 'Reflection'
            }
            await app.service.handle({ type: 'newDraft', week: '2026-09-07' })
            const [draft] = app.store.state.drafts
            draft.body = {
                content: Array.from({ length: 120 }, (_, index) => ({
                    content: [{ text: `Reflection ${index}`, type: 'text' }],
                    type: 'paragraph'
                })),
                type: 'doc'
            }
            app.remote.failAppend = true
            await expect(app.service.handle({ draftId: draft.id, type: 'publish' })).rejects.toThrow(
                'Append connection lost'
            )
            expect([Object.is(app.store.state.saves[0].status, 'unknown'), app.store.state.coverage]).toStrictEqual([
                true,
                []
            ])
            await app.service.handle({ saveId: app.store.state.saves[0].id, type: 'reconcile' })
            expect([app.remote.pages?.length, app.remote.pages[0].blocks?.length]).toStrictEqual([1, 121])
            const creation = required(
                app.remote.requests.find((request) => request.method === 'POST' && request.url.endsWith('/pages'))
            )
            expect(creation.body?.parent).toStrictEqual({ data_source_id: 'source' })
            expect(creation.body?.properties).toHaveProperty('Week.date.start', '2026-09-07')
            expect(app.store.state.saves[0].status).toBe('confirmed')
        } finally {
            await app.close()
        }
    })

    it('loads and caches remote authored commit diffs when the object is absent locally', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.repository.emails.push('second@example.com')
            await app.service.handle({ type: 'refresh' })
            const commit = required(app.store.state.activities.find((item) => item.sha === 'd'.repeat(40)))
            const reply = await app.service.handle({ activityId: commit.id, type: 'details' })
            expect([
                reply.diff?.includes('+new'),
                reply.state.activities.find((item) => item.id === commit.id)?.files
            ]).toStrictEqual([true, [{ name: 'a.ts', status: 'modified' }]])
            app.remote.github = false
            const awaited1 = await app.service.handle({ activityId: commit.id, type: 'details' })
            expect(awaited1.diff).toContain('+new')
        } finally {
            await app.close()
        }
    })

    it('does not import newly discovered old PR work as fresh but detects later net changes with old author dates', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.remote.authorDate = '2025-01-01T12:00:00Z'
            app.repository.trackingStart = '2026-10-05'
            const week = weekOf(new Date(), app.store.state.settings)
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            expect([
                Boolean(inbox(app.store.state, week).some((item) => item.id === pr.id)),
                app.store.state.diffs[pr.id] === undefined
            ]).toStrictEqual([false, true])
            app.remote.head = 'e'.repeat(40)
            app.remote.patch = patch.replace('1111111..2222222', '3333333..4444444')
            await app.service.handle({ type: 'refresh' })
            expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBeFalsy()
            app.remote.patch = patch.replace('+new', '+new work')
            await app.service.handle({ type: 'refresh' })
            expect(inbox(app.store.state, week).filter((item) => item.id === pr.id)).toHaveLength(1)
        } finally {
            await app.close()
        }
    })

    it('keeps edits made after an uncertain save editable when the earlier captured entry is reconciled', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const [draft] = app.store.state.drafts
            app.remote.loseCreateResponse = true
            await expect(app.service.handle({ draftId: draft.id, type: 'publish' })).rejects.toThrow(
                'Connection lost after server commit'
            )
            await app.service.handle({ draft: { ...draft, title: 'Further reflection' }, type: 'draft' })
            await app.service.handle({ saveId: app.store.state.saves[0].id, type: 'reconcile' })
            expect([
                Object.is(draft.title, 'Further reflection'),
                draft.publishedEntryId === undefined,
                Object.is(app.store.state.entries[0].title, 'Further reflection')
            ]).toStrictEqual([true, true, false])
        } finally {
            await app.close()
        }
    })

    it('conservatively surfaces changed references for old PRs whose patches cannot be compared', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            app.remote.authorDate = '2025-01-01T12:00:00Z'
            app.remote.patch = 'Binary files a/image.png and b/image.png differ'
            app.repository.trackingStart = '2026-10-05'
            const week = weekOf(new Date(), app.store.state.settings)
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBeFalsy()
            await app.service.handle({ type: 'refresh' })
            expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBeFalsy()
            app.remote.head = 'f'.repeat(40)
            await app.service.handle({ type: 'refresh' })
            expect([
                Boolean(inbox(app.store.state, week).some((item) => item.id === pr.id)),
                coveredEntries(app.store.state, pr)
            ]).toStrictEqual([true, []])
        } finally {
            await app.close()
        }
    })

    it('identifies an old cached patch after a failed refresh rather than presenting it as the new revision', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            await app.service.handle({ activityId: pr.id, type: 'details' })
            const cachedRevision = pr.diffRevision
            app.remote.head = 'f'.repeat(40)
            app.remote.failDiff = true
            await app.service.handle({ type: 'refresh' })
            expect([
                pr.revision === undefined,
                Object.is(pr.diffRevision, cachedRevision),
                app.store.state.diffs[pr.id]?.includes('+new')
            ]).toStrictEqual([true, true, true])
            await expect(app.service.handle({ activityId: pr.id, type: 'details' })).rejects.toThrow('unavailable')
            expect(coveredEntries(app.store.state, pr)).toStrictEqual([])
        } finally {
            await app.close()
        }
    })

    it('compares the final integration patch separately from the covered pre-merge PR snapshot', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            await app.service.handle({
                activityId: pr.id,
                draftId: app.store.state.drafts[0].id,
                included: true,
                type: 'select'
            })
            await app.service.handle({ draftId: app.store.state.drafts[0].id, type: 'publish' })
            app.remote.merged = true
            app.remote.finalPatch = patch.replace('+new', '+resolved during integration')
            await app.service.handle({ type: 'refresh' })
            expect([
                coveredEntries(app.store.state, pr),
                Object.is(pr.head, 'c'.repeat(40)),
                app.store.state.diffs[pr.id]?.includes('+resolved during integration'),
                Boolean(app.store.state.activities.some((item) => item.kind === 'merged'))
            ]).toStrictEqual([[], true, true, true])
        } finally {
            await app.close()
        }
    })

    it('retains the whole PR patch and uncertain coverage for an unproven linear merge range', async () => {
        const app = await workspace()
        try {
            app.remote.github = true
            await app.service.handle({ type: 'refresh' })
            const pr = required(app.store.state.activities.find((item) => item.kind === 'pr'))
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            await app.service.handle({
                activityId: pr.id,
                draftId: app.store.state.drafts[0].id,
                included: true,
                type: 'select'
            })
            await app.service.handle({ draftId: app.store.state.drafts[0].id, type: 'publish' })
            app.remote.merged = true
            app.remote.mergeParents = ['b'.repeat(40)]
            app.remote.finalPatch = patch.replace('+new', '+last rebased commit only')
            await app.service.handle({ type: 'refresh' })
            await app.service.handle({ activityId: pr.id, type: 'details' })
            expect([
                Object.is(app.store.state.diffs[pr.id], patch),
                pr.fingerprint === undefined,
                Object.is(pr.head, 'c'.repeat(40)),
                coveredEntries(app.store.state, pr)
            ]).toStrictEqual([true, true, true, []])
        } finally {
            await app.close()
        }
    })
})
