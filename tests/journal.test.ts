import { describe, expect, it, vi } from 'vitest'
import { Store } from '../src/main/store'
import { commandSchema, coveredEntries, inbox, weekOf } from '../src/shared/model'
import { workspace } from './fixtures'
import type { JournalNode } from '../src/shared/model'

const reflection: JournalNode = {
    type: 'doc',
    content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What I learned' }] },
        {
            type: 'taskList',
            content: [
                {
                    type: 'taskItem',
                    attrs: { checked: true },
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Reflect', marks: [{ type: 'bold' }] }] }
                    ]
                }
            ]
        }
    ]
}
describe('local journal workflow through application commands', () => {
    it('waits for durable publish intent before sending a Notion create request', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            app.store.state.drafts[0].title = 'Durable intent'
            let release: (() => void) | undefined
            const commit = new Promise<void>((resolve) => {
                release = resolve
            })
            vi.spyOn(app.store, 'flush').mockReturnValueOnce(commit)
            const publishing = app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
            await Promise.resolve()
            expect(app.remote.pages).toHaveLength(0)
            release?.()
            await publishing
            expect(app.remote.pages).toHaveLength(1)
        } finally {
            await app.close()
        }
    })
    it('refuses ambiguous matching pages after a lost creation response', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const draft = app.store.state.drafts[0]
            app.remote.loseCreateResponse = true
            await expect(app.service.handle({ type: 'publish', draftId: draft.id })).rejects.toThrow('Connection lost')
            app.remote.pages.push({ ...structuredClone(app.remote.pages[0]), id: 'another-page' })
            await expect(
                app.service.handle({ type: 'reconcile', saveId: app.store.state.saves[0].id })
            ).rejects.toThrow('More than one matching')
            expect(app.store.state.saves[0].status).toBe('unknown')
            expect(app.store.state.coverage).toEqual([])
        } finally {
            await app.close()
        }
    })
    it('publishes only the writing, without an attribution block', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const draft = app.store.state.drafts[0]
            await app.service.handle({ type: 'draft', draft: { ...draft, body: reflection } })
            await app.service.handle({ type: 'publish', draftId: draft.id })
            expect(JSON.stringify(app.remote.pages[0].blocks)).not.toContain('Published with weekly-j')
            expect(app.remote.pages[0].blocks).toHaveLength(reflection.content!.length)
        } finally {
            await app.close()
        }
    })
    it('recovers a formatted draft and captured selection after layout changes and restart', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            const activity = app.store.state.activities[0]
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const draft = app.store.state.drafts[0]
            await app.service.handle({ type: 'draft', draft: { ...draft, body: reflection } })
            await app.service.handle({ type: 'select', draftId: draft.id, activityId: activity.id, included: true })
            await app.service.handle({
                type: 'settings',
                settings: {
                    ...app.store.state.settings,
                    layout: {
                        order: ['draft', 'details', 'activity'],
                        hidden: ['activity'],
                        sizes: { draft: 60, details: 40 }
                    }
                }
            })
            expect(app.service.reply().state.coverage).toEqual([])
            app.store.close()
            const reopened = new Store(`${app.directory}/tracking.sqlite`)
            expect(reopened.state.drafts[0].body).toEqual(reflection)
            expect(reopened.state.drafts[0].selections).toEqual([{ activityId: activity.id }])
            expect(reopened.state.settings.layout.order).toEqual(['draft', 'details', 'activity'])
            reopened.close()
        } finally {
            await app.close()
        }
    })
    it('keeps older history out of the inbox and returns deferred work only in its chosen week', async () => {
        const app = await workspace()
        try {
            expect(app.repository.trackingStart).toBe(weekOf(new Date(), app.store.state.settings))
            await app.service.handle({
                type: 'history',
                repositoryId: app.repository.id,
                branch: 'development',
                view: 'history',
                author: '',
                since: ''
            })
            const activity = app.store.state.activities[0]
            activity.date = '2025-01-01T12:00:00Z'
            expect(inbox(app.store.state, '2026-10-05')).toEqual([])
            await app.service.handle({
                type: 'disposition',
                activityId: activity.id,
                disposition: 'deferred',
                until: '2026-10-12'
            })
            expect(inbox(app.store.state, '2026-10-05')).toEqual([])
            expect(inbox(app.store.state, '2026-10-12').map((item) => item.id)).toEqual([activity.id])
            await app.service.handle({
                type: 'disposition',
                activityId: activity.id,
                disposition: 'dismissed',
                reason: 'Already understood'
            })
            expect(inbox(app.store.state, '2026-10-12')).toEqual([])
            expect(app.service.reply().state.activities[0].reason).toBe('Already understood')
            await app.service.handle({
                type: 'disposition',
                activityId: activity.id,
                disposition: 'deferred',
                until: '2026-10-12'
            })
            expect(inbox(app.store.state, '2026-10-12')).toHaveLength(1)
            expect(app.store.state.coverage).toEqual([])
        } finally {
            await app.close()
        }
    })
    it('preserves pending coverage across an ambiguous save and verifies before any retry', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            const activity = app.store.state.activities[0]
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const draft = app.store.state.drafts[0]
            await app.service.handle({ type: 'draft', draft: { ...draft, body: reflection } })
            await app.service.handle({ type: 'select', draftId: draft.id, activityId: activity.id, included: true })
            app.remote.loseCreateResponse = true
            await expect(app.service.handle({ type: 'publish', draftId: draft.id })).rejects.toThrow('Connection lost')
            expect(app.service.reply().state.coverage).toEqual([])
            expect(app.store.state.saves[0].status).toBe('unknown')
            expect(app.store.state.drafts[0].body).toEqual(reflection)
            await expect(app.service.handle({ type: 'publish', draftId: draft.id })).rejects.toThrow('uncertain save')
            await app.service.handle({ type: 'reconcile', saveId: app.store.state.saves[0].id })
            expect(app.remote.pages).toHaveLength(1)
            expect(coveredEntries(app.store.state, activity)).toHaveLength(1)
            expect(app.store.state.saves[0].status).toBe('confirmed')
        } finally {
            await app.close()
        }
    })
    it('retains a failed draft and supports a deliberate retry after a confirmed rejection', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const draft = app.store.state.drafts[0]
            app.remote.failCreate = true
            await expect(app.service.handle({ type: 'publish', draftId: draft.id })).rejects.toThrow('400')
            expect(app.store.state.saves[0].status).toBe('failed')
            expect(app.store.state.drafts).toHaveLength(1)
            expect(app.store.state.coverage).toEqual([])
            app.remote.failCreate = false
            await app.service.handle({ type: 'publish', draftId: draft.id })
            expect(app.remote.pages).toHaveLength(1)
        } finally {
            await app.close()
        }
    })
    it('exports tracking and journal text without credentials, source patches, or repository contents', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            await app.service.handle({ type: 'details', activityId: app.store.state.activities[0].id })
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
            const backup = app.store.export()
            expect(backup).not.toContain('test-token')
            expect(backup).not.toContain('+initial')
            app.store.restore(backup)
            expect(app.store.state.drafts).toHaveLength(1)
            expect(app.store.state.entries).toHaveLength(1)
            expect(app.store.state.repositories[0].available).toBe(false)
            expect(app.store.state.repositories[0].path).toBe('')
            expect(app.store.state.diffs).toEqual({})
        } finally {
            await app.close()
        }
    })
    it('restores legacy feature data without retaining groups or losing journal activity', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const draft = app.store.state.drafts[0]
            await app.service.handle({ type: 'draft', draft: { ...draft, body: reflection } })
            const activities = structuredClone(app.store.state.activities)
            const feature = { id: 'old-group', name: 'Old group', archived: false, members: [activities[0].id] }
            const backup = { ...JSON.parse(app.store.export()), features: [feature] }
            app.store.restore(JSON.stringify(backup))
            expect(app.store.state).not.toHaveProperty('features')
            expect(app.store.state.activities).toEqual(activities)
            expect(app.store.state.drafts[0].body).toEqual(reflection)
            expect(JSON.parse(app.store.export())).not.toHaveProperty('features')
            const reopened = new Store(`${app.directory}/tracking.sqlite`)
            try {
                expect(reopened.state).not.toHaveProperty('features')
                expect(reopened.state.activities).toEqual(activities)
                expect(reopened.state.drafts[0].body).toEqual(reflection)
            } finally {
                reopened.close()
            }
            expect(commandSchema.safeParse({ type: 'feature', ...feature }).success).toBe(false)
        } finally {
            await app.close()
        }
    })
})
