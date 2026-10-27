import { journalState } from './database-fixtures'
import { run } from './effect-fixtures'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { coveredEntries, inbox } from '../src/shared/model'
import { journal, patch, workspace } from './fixtures'
import { weekOf } from '../src/shared/model'
// Keep the live refresh timestamps and historical remote fixtures in the same week.
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())
it('pins a selected PR revision, retains coverage after equivalent rewrites, and groups later changes', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        {
            app.repository.emails.push('second@example.com')
            await app.store.saveRepository(app.repository)
        }
        {
            app.repository.trackingStart = '2026-10-05'
            await app.store.saveRepository(app.repository)
        }
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        expect((await app.store.activity(pr.id))!.base).toBe('main')
        expect(
            (await journalState(app.store)).activities.some((item) => item.kind === 'review' && item.author === 'me')
        ).toBe(true)
        expect(
            (await journalState(app.store)).activities.some(
                (item) => item.kind === 'commit' && item.author === 'second@example.com'
            )
        ).toBe(true)
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        await run(app.service.handle({ type: 'select', draftId: draft.id, activityId: pr.id, included: true }))
        const selectedRevision = (await app.store.draft(draft.id))!.selections[0].revision
        app.remote.patch = patch.replace('+new', '+later')
        app.remote.head = 'e'.repeat(40)
        await run(app.service.handle({ type: 'refresh' }))
        expect((await app.store.activity(pr.id))!.revision).not.toBe(selectedRevision)
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect((await journalState(app.store)).coverage[0].revision).toBe(selectedRevision)
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
        expect(inbox(await journalState(app.store), '2026-10-05').filter((item) => item.kind === 'pr')).toHaveLength(1)
        app.remote.patch = patch.replace('1111111..2222222', '9999999..aaaaaaa').replace('@@ -1 +1 @@', '@@ -9 +9 @@')
        app.remote.head = 'f'.repeat(40)
        await run(app.service.handle({ type: 'refresh' }))
        expect((await app.store.activity(pr.id))!.revision).toBe(selectedRevision)
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toHaveLength(1)
        app.remote.patch = patch.replace('+new', '+ new')
        await run(app.service.handle({ type: 'refresh' }))
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
        app.remote.patch = 'Binary files a/image.png and b/image.png differ'
        await run(app.service.handle({ type: 'refresh' }))
        expect((await app.store.activity(pr.id))!.fingerprint).toBeUndefined()
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
    } finally {
        await app.close()
    }
})
it('does not infer whole-PR coverage from commits and suppresses a known integration duplicate', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        app.remote.merged = true
        {
            app.repository.emails.push('second@example.com')
            await app.store.saveRepository(app.repository)
        }
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        const commit = (await journalState(app.store)).activities.find((item) => item.sha === 'd'.repeat(40))!
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        await run(
            app.service.handle({
                type: 'select',
                draftId: (await journalState(app.store)).drafts[0].id,
                activityId: commit.id,
                included: true
            })
        )
        await run(app.service.handle({ type: 'publish', draftId: (await journalState(app.store)).drafts[0].id }))
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
        await app.store.applyAcquisitionBatch({
            activities: [
                {
                    ...commit,
                    id: 'integration',
                    sha: 'c'.repeat(40),
                    date: '2026-10-07T10:00:00Z'
                }
            ]
        })
        const items = inbox(await journalState(app.store), '2026-10-05')
        expect(items.some((item) => item.id === 'integration')).toBe(false)
        expect(items.some((item) => item.kind === 'merged')).toBe(true)
    } finally {
        await app.close()
    }
})
it('resumes a verified partial Notion save without creating a second page and maps the selected week', async () => {
    const app = await journal()
    try {
        await app.store.setDestination({
            kind: 'database',
            id: 'source',
            titleProperty: 'Reflection',
            dateProperty: 'Week'
        })
        await run(app.service.handle({ type: 'newDraft', week: '2026-09-07' }))
        const draft = (await journalState(app.store)).drafts[0]
        {
            draft.body = {
                type: 'doc',
                content: Array.from({ length: 120 }, (_, index) => ({
                    type: 'paragraph',
                    content: [{ type: 'text', text: `Reflection ${index}` }]
                }))
            }
            await app.store.saveDraft(draft, draft.version)
        }
        app.remote.failAppend = true
        await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow(
            'Append connection lost'
        )
        expect((await journalState(app.store)).saves[0].status).toBe('unknown')
        expect((await journalState(app.store)).coverage).toEqual([])
        await run(app.service.handle({ type: 'reconcile', saveId: (await journalState(app.store)).saves[0].id }))
        expect(app.remote.pages).toHaveLength(1)
        expect(app.remote.pages[0].blocks).toHaveLength(120)
        const creation = app.remote.requests.find(
            (request) => request.method === 'POST' && request.url.endsWith('/pages')
        )!
        expect(creation.body?.parent).toEqual({ data_source_id: 'source' })
        expect(creation.body?.properties).toHaveProperty('Week.date.start', '2026-09-07')
        expect((await journalState(app.store)).saves[0].status).toBe('confirmed')
    } finally {
        await app.close()
    }
})
it('loads and caches remote authored commit diffs when the object is absent locally', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        {
            app.repository.emails.push('second@example.com')
            await app.store.saveRepository(app.repository)
        }
        await run(app.service.handle({ type: 'refresh' }))
        const commit = (await journalState(app.store)).activities.find((item) => item.sha === 'd'.repeat(40))!
        const reply = await run(app.service.handle({ type: 'details', activityId: commit.id }))
        expect(reply.diff).toContain('+new')
        expect((await journalState(app.store)).activities.find((item) => item.id === commit.id)?.files).toEqual([
            { name: 'a.ts', status: 'modified' }
        ])
        app.remote.github = false
        expect((await run(app.service.handle({ type: 'details', activityId: commit.id }))).diff).toContain('+new')
    } finally {
        await app.close()
    }
})
it('does not import newly discovered old PR work as fresh but detects later net changes with old author dates', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        app.remote.authorDate = '2025-01-01T12:00:00Z'
        {
            app.repository.trackingStart = '2026-10-05'
            await app.store.saveRepository(app.repository)
        }
        const week = weekOf(new Date(), (await journalState(app.store)).settings)
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        expect(inbox(await journalState(app.store), week).some((item) => item.id === pr.id)).toBe(false)
        expect((await journalState(app.store)).diffs[pr.id]).toBeUndefined()
        app.remote.head = 'e'.repeat(40)
        app.remote.patch = patch.replace('1111111..2222222', '3333333..4444444')
        await run(app.service.handle({ type: 'refresh' }))
        expect(inbox(await journalState(app.store), week).some((item) => item.id === pr.id)).toBe(false)
        app.remote.patch = patch.replace('+new', '+new work')
        await run(app.service.handle({ type: 'refresh' }))
        expect(inbox(await journalState(app.store), week).filter((item) => item.id === pr.id)).toHaveLength(1)
    } finally {
        await app.close()
    }
})
it('keeps edits made after an uncertain save editable when the earlier captured entry is reconciled', async () => {
    const app = await journal()
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        app.remote.loseCreateResponse = true
        await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow()
        await run(app.service.handle({ type: 'draft', draft: { ...draft, title: 'Further reflection' } }))
        await run(app.service.handle({ type: 'reconcile', saveId: (await journalState(app.store)).saves[0].id }))
        expect((await app.store.draft(draft.id))!.title).toBe('Further reflection')
        expect((await app.store.draft(draft.id))!.publishedEntryId).toBe((await journalState(app.store)).entries[0].id)
        expect((await journalState(app.store)).entries[0].title).not.toBe('Further reflection')
        await run(
            app.service.handle({
                type: 'draft',
                draft: { ...(await app.store.draft(draft.id))!, title: 'Further reflection, edited again' }
            })
        )
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect(app.remote.pages).toHaveLength(1)
        expect((await journalState(app.store)).entries[0].title).toBe('Further reflection, edited again')
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
        {
            app.repository.trackingStart = '2026-10-05'
            await app.store.saveRepository(app.repository)
        }
        const week = weekOf(new Date(), (await journalState(app.store)).settings)
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        expect(inbox(await journalState(app.store), week).some((item) => item.id === pr.id)).toBe(false)
        await run(app.service.handle({ type: 'refresh' }))
        expect(inbox(await journalState(app.store), week).some((item) => item.id === pr.id)).toBe(false)
        app.remote.head = 'f'.repeat(40)
        await run(app.service.handle({ type: 'refresh' }))
        expect(inbox(await journalState(app.store), week).some((item) => item.id === pr.id)).toBe(true)
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
    } finally {
        await app.close()
    }
})
it('identifies an old cached patch after a failed refresh rather than presenting it as the new revision', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        await run(app.service.handle({ type: 'details', activityId: pr.id }))
        const cachedRevision = (await app.store.activity(pr.id))!.diffRevision
        app.remote.head = 'f'.repeat(40)
        app.remote.failDiff = true
        await run(app.service.handle({ type: 'refresh' }))
        expect((await app.store.activity(pr.id))!.revision).toBeUndefined()
        expect((await app.store.activity(pr.id))!.diffRevision).toBe(cachedRevision)
        expect((await journalState(app.store)).diffs[pr.id]).toContain('+new')
        await expect(run(app.service.handle({ type: 'details', activityId: pr.id }))).rejects.toThrow('unavailable')
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
    } finally {
        await app.close()
    }
})
it('compares the final integration patch separately from the covered pre-merge PR snapshot', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        await run(
            app.service.handle({
                type: 'select',
                draftId: (await journalState(app.store)).drafts[0].id,
                activityId: pr.id,
                included: true
            })
        )
        await run(app.service.handle({ type: 'publish', draftId: (await journalState(app.store)).drafts[0].id }))
        app.remote.merged = true
        app.remote.finalPatch = patch.replace('+new', '+resolved during integration')
        await run(app.service.handle({ type: 'refresh' }))
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
        expect((await app.store.activity(pr.id))!.head).toBe('c'.repeat(40))
        expect((await journalState(app.store)).diffs[pr.id]).toContain('+resolved during integration')
        expect((await journalState(app.store)).activities.some((item) => item.kind === 'merged')).toBe(true)
    } finally {
        await app.close()
    }
})
it('retains the whole PR patch and uncertain coverage for an unproven linear merge range', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await run(app.service.handle({ type: 'refresh' }))
        const pr = (await journalState(app.store)).activities.find((item) => item.kind === 'pr')!
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        await run(
            app.service.handle({
                type: 'select',
                draftId: (await journalState(app.store)).drafts[0].id,
                activityId: pr.id,
                included: true
            })
        )
        await run(app.service.handle({ type: 'publish', draftId: (await journalState(app.store)).drafts[0].id }))
        app.remote.merged = true
        app.remote.mergeParents = ['b'.repeat(40)]
        app.remote.finalPatch = patch.replace('+new', '+last rebased commit only')
        await run(app.service.handle({ type: 'refresh' }))
        await run(app.service.handle({ type: 'details', activityId: pr.id }))
        expect((await journalState(app.store)).diffs[pr.id]).toBe(patch)
        expect((await app.store.activity(pr.id))!.fingerprint).toBeUndefined()
        expect((await app.store.activity(pr.id))!.head).toBe('c'.repeat(40))
        expect(coveredEntries(await journalState(app.store), (await app.store.activity(pr.id))!)).toEqual([])
    } finally {
        await app.close()
    }
})
