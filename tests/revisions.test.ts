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
        app.repository.emails.push('second@example.com')
        app.repository.trackingStart = '2026-10-05'
        await app.service.handle({ type: 'refresh' })
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        expect(pr.base).toBe('main')
        expect(app.store.state.activities.some((item) => item.kind === 'review' && item.author === 'me')).toBe(true)
        expect(
            app.store.state.activities.some((item) => item.kind === 'commit' && item.author === 'second@example.com')
        ).toBe(true)
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        const draft = app.store.state.drafts[0]
        await app.service.handle({ type: 'select', draftId: draft.id, activityId: pr.id, included: true })
        const selectedRevision = draft.selections[0].revision
        app.remote.patch = patch.replace('+new', '+later')
        app.remote.head = 'e'.repeat(40)
        await app.service.handle({ type: 'refresh' })
        expect(pr.revision).not.toBe(selectedRevision)
        await app.service.handle({ type: 'publish', draftId: draft.id })
        expect(app.store.state.coverage[0].revision).toBe(selectedRevision)
        expect(coveredEntries(app.store.state, pr)).toEqual([])
        expect(inbox(app.store.state, '2026-10-05').filter((item) => item.kind === 'pr')).toHaveLength(1)
        app.remote.patch = patch.replace('1111111..2222222', '9999999..aaaaaaa').replace('@@ -1 +1 @@', '@@ -9 +9 @@')
        app.remote.head = 'f'.repeat(40)
        await app.service.handle({ type: 'refresh' })
        expect(pr.revision).toBe(selectedRevision)
        expect(coveredEntries(app.store.state, pr)).toHaveLength(1)
        app.remote.patch = patch.replace('+new', '+ new')
        await app.service.handle({ type: 'refresh' })
        expect(coveredEntries(app.store.state, pr)).toEqual([])
        app.remote.patch = 'Binary files a/image.png and b/image.png differ'
        await app.service.handle({ type: 'refresh' })
        expect(pr.fingerprint).toBeUndefined()
        expect(coveredEntries(app.store.state, pr)).toEqual([])
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
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        const commit = app.store.state.activities.find((item) => item.sha === 'd'.repeat(40))!
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        await app.service.handle({
            type: 'select',
            draftId: app.store.state.drafts[0].id,
            activityId: commit.id,
            included: true
        })
        await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
        expect(coveredEntries(app.store.state, pr)).toEqual([])
        app.store.state.activities.push({
            ...commit,
            id: 'integration',
            sha: 'c'.repeat(40),
            date: '2026-10-07T10:00:00Z'
        })
        const items = inbox(app.store.state, '2026-10-05')
        expect(items.some((item) => item.id === 'integration')).toBe(false)
        expect(items.some((item) => item.kind === 'merged')).toBe(true)
    } finally {
        await app.close()
    }
})

it('resumes a verified partial Notion save without creating a second page and maps the selected week', async () => {
    const app = await journal()
    try {
        app.store.state.settings.destination = {
            kind: 'database',
            id: 'source',
            titleProperty: 'Reflection',
            dateProperty: 'Week'
        }
        await app.service.handle({ type: 'newDraft', week: '2026-09-07' })
        const draft = app.store.state.drafts[0]
        draft.body = {
            type: 'doc',
            content: Array.from({ length: 120 }, (_, index) => ({
                type: 'paragraph',
                content: [{ type: 'text', text: `Reflection ${index}` }]
            }))
        }
        app.remote.failAppend = true
        await expect(app.service.handle({ type: 'publish', draftId: draft.id })).rejects.toThrow(
            'Append connection lost'
        )
        expect(app.store.state.saves[0].status).toBe('unknown')
        expect(app.store.state.coverage).toEqual([])
        await app.service.handle({ type: 'reconcile', saveId: app.store.state.saves[0].id })
        expect(app.remote.pages).toHaveLength(1)
        expect(app.remote.pages[0].blocks).toHaveLength(120)
        const creation = app.remote.requests.find(
            (request) => request.method === 'POST' && request.url.endsWith('/pages')
        )!
        expect(creation.body?.parent).toEqual({ data_source_id: 'source' })
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
        const commit = app.store.state.activities.find((item) => item.sha === 'd'.repeat(40))!
        const reply = await app.service.handle({ type: 'details', activityId: commit.id })
        expect(reply.diff).toContain('+new')
        expect(reply.state.activities.find((item) => item.id === commit.id)?.files).toEqual([
            { name: 'a.ts', status: 'modified' }
        ])
        app.remote.github = false
        expect((await app.service.handle({ type: 'details', activityId: commit.id })).diff).toContain('+new')
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
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBe(false)
        expect(app.store.state.diffs[pr.id]).toBeUndefined()
        app.remote.head = 'e'.repeat(40)
        app.remote.patch = patch.replace('1111111..2222222', '3333333..4444444')
        await app.service.handle({ type: 'refresh' })
        expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBe(false)
        app.remote.patch = patch.replace('+new', '+new work')
        await app.service.handle({ type: 'refresh' })
        expect(inbox(app.store.state, week).filter((item) => item.id === pr.id)).toHaveLength(1)
    } finally {
        await app.close()
    }
})

it('keeps edits made after an uncertain save editable when the earlier captured entry is reconciled', async () => {
    const app = await journal()
    try {
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        const draft = app.store.state.drafts[0]
        app.remote.loseCreateResponse = true
        await expect(app.service.handle({ type: 'publish', draftId: draft.id })).rejects.toThrow()
        await app.service.handle({ type: 'draft', draft: { ...draft, title: 'Further reflection' } })
        await app.service.handle({ type: 'reconcile', saveId: app.store.state.saves[0].id })
        expect(draft.title).toBe('Further reflection')
        expect(draft.publishedEntryId).toBe(app.store.state.entries[0].id)
        expect(app.store.state.entries[0].title).not.toBe('Further reflection')
        await app.service.handle({ type: 'draft', draft: { ...draft, title: 'Further reflection, edited again' } })
        await app.service.handle({ type: 'publish', draftId: draft.id })
        expect(app.remote.pages).toHaveLength(1)
        expect(app.store.state.entries[0].title).toBe('Further reflection, edited again')
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
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBe(false)
        await app.service.handle({ type: 'refresh' })
        expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBe(false)
        app.remote.head = 'f'.repeat(40)
        await app.service.handle({ type: 'refresh' })
        expect(inbox(app.store.state, week).some((item) => item.id === pr.id)).toBe(true)
        expect(coveredEntries(app.store.state, pr)).toEqual([])
    } finally {
        await app.close()
    }
})

it('identifies an old cached patch after a failed refresh rather than presenting it as the new revision', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await app.service.handle({ type: 'refresh' })
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        await app.service.handle({ type: 'details', activityId: pr.id })
        const cachedRevision = pr.diffRevision
        app.remote.head = 'f'.repeat(40)
        app.remote.failDiff = true
        await app.service.handle({ type: 'refresh' })
        expect(pr.revision).toBeUndefined()
        expect(pr.diffRevision).toBe(cachedRevision)
        expect(app.store.state.diffs[pr.id]).toContain('+new')
        await expect(app.service.handle({ type: 'details', activityId: pr.id })).rejects.toThrow('unavailable')
        expect(coveredEntries(app.store.state, pr)).toEqual([])
    } finally {
        await app.close()
    }
})

it('compares the final integration patch separately from the covered pre-merge PR snapshot', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await app.service.handle({ type: 'refresh' })
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        await app.service.handle({
            type: 'select',
            draftId: app.store.state.drafts[0].id,
            activityId: pr.id,
            included: true
        })
        await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
        app.remote.merged = true
        app.remote.finalPatch = patch.replace('+new', '+resolved during integration')
        await app.service.handle({ type: 'refresh' })
        expect(coveredEntries(app.store.state, pr)).toEqual([])
        expect(pr.head).toBe('c'.repeat(40))
        expect(app.store.state.diffs[pr.id]).toContain('+resolved during integration')
        expect(app.store.state.activities.some((item) => item.kind === 'merged')).toBe(true)
    } finally {
        await app.close()
    }
})

it('retains the whole PR patch and uncertain coverage for an unproven linear merge range', async () => {
    const app = await workspace()
    try {
        app.remote.github = true
        await app.service.handle({ type: 'refresh' })
        const pr = app.store.state.activities.find((item) => item.kind === 'pr')!
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        await app.service.handle({
            type: 'select',
            draftId: app.store.state.drafts[0].id,
            activityId: pr.id,
            included: true
        })
        await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
        app.remote.merged = true
        app.remote.mergeParents = ['b'.repeat(40)]
        app.remote.finalPatch = patch.replace('+new', '+last rebased commit only')
        await app.service.handle({ type: 'refresh' })
        await app.service.handle({ type: 'details', activityId: pr.id })
        expect(app.store.state.diffs[pr.id]).toBe(patch)
        expect(pr.fingerprint).toBeUndefined()
        expect(pr.head).toBe('c'.repeat(40))
        expect(coveredEntries(app.store.state, pr)).toEqual([])
    } finally {
        await app.close()
    }
})
