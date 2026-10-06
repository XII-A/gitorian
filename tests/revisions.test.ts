import { expect, it } from 'vitest'
import { coveredEntries, inbox } from '../src/shared/model'
import { patch, workspace } from './fixtures'

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
    const app = await workspace()
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
        expect(app.remote.pages[0].blocks).toHaveLength(121)
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
