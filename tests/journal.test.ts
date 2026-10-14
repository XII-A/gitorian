import { describe, expect, it } from 'vitest'

import { Store } from '../src/main/store'
import type { JournalNode } from '../src/shared/model'
import { coveredEntries, featureActivities, inbox, weekOf } from '../src/shared/model'
import { workspace } from './fixtures'

const reflection: JournalNode = {
    content: [
        { attrs: { level: 2 }, content: [{ text: 'What I learned', type: 'text' }], type: 'heading' },
        {
            content: [
                {
                    attrs: { checked: true },
                    content: [
                        { content: [{ marks: [{ type: 'bold' }], text: 'Reflect', type: 'text' }], type: 'paragraph' }
                    ],
                    type: 'taskItem'
                }
            ],
            type: 'taskList'
        }
    ],
    type: 'doc'
}
describe('local journal workflow through application commands', () => {
    it('recovers a formatted draft and captured selection after layout changes and restart', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            const [activity] = app.store.state.activities
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const [draft] = app.store.state.drafts
            await app.service.handle({ draft: { ...draft, body: reflection }, type: 'draft' })
            await app.service.handle({ activityId: activity.id, draftId: draft.id, included: true, type: 'select' })
            await app.service.handle({
                settings: {
                    ...app.store.state.settings,
                    layout: {
                        hidden: ['activity'],
                        order: ['draft', 'details', 'activity'],
                        sizes: { details: 40, draft: 60 }
                    }
                },
                type: 'settings'
            })
            expect(app.service.reply().state.coverage).toStrictEqual([])
            app.store.close()
            const reopened = new Store(`${app.directory}/tracking.sqlite`)
            expect([
                reopened.state.drafts[0].body,
                reopened.state.drafts[0].selections,
                reopened.state.settings.layout.order
            ]).toStrictEqual([reflection, [{ activityId: activity.id }], ['draft', 'details', 'activity']])
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
                author: '',
                branch: 'development',
                repositoryId: app.repository.id,
                since: '',
                type: 'history',
                view: 'history'
            })
            const [activity] = app.store.state.activities
            activity.date = '2025-01-01T12:00:00Z'
            expect(inbox(app.store.state, '2026-10-05')).toStrictEqual([])
            await app.service.handle({
                activityId: activity.id,
                disposition: 'deferred',
                type: 'disposition',
                until: '2026-10-12'
            })
            expect([
                inbox(app.store.state, '2026-10-05'),
                inbox(app.store.state, '2026-10-12').map((item) => item.id)
            ]).toStrictEqual([[], [activity.id]])
            await app.service.handle({
                activityId: activity.id,
                disposition: 'dismissed',
                reason: 'Already understood',
                type: 'disposition'
            })
            expect([
                inbox(app.store.state, '2026-10-12'),
                Object.is(app.service.reply().state.activities[0].reason, 'Already understood')
            ]).toStrictEqual([[], true])
            await app.service.handle({
                activityId: activity.id,
                disposition: 'deferred',
                type: 'disposition',
                until: '2026-10-12'
            })
            expect([inbox(app.store.state, '2026-10-12')?.length, app.store.state.coverage]).toStrictEqual([1, []])
        } finally {
            await app.close()
        }
    })

    it('preserves pending coverage across an ambiguous save and verifies before any retry', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            const [activity] = app.store.state.activities
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const [draft] = app.store.state.drafts
            await app.service.handle({ draft: { ...draft, body: reflection }, type: 'draft' })
            await app.service.handle({ activityId: activity.id, draftId: draft.id, included: true, type: 'select' })
            app.remote.loseCreateResponse = true
            await expect(app.service.handle({ draftId: draft.id, type: 'publish' })).rejects.toThrow('Connection lost')
            expect([
                app.service.reply().state.coverage,
                Object.is(app.store.state.saves[0].status, 'unknown'),
                app.store.state.drafts[0].body
            ]).toStrictEqual([[], true, reflection])
            await expect(app.service.handle({ draftId: draft.id, type: 'publish' })).rejects.toThrow('uncertain save')
            await app.service.handle({ saveId: app.store.state.saves[0].id, type: 'reconcile' })
            expect([
                app.remote.pages?.length,
                coveredEntries(app.store.state, activity)?.length,
                Object.is(app.store.state.saves[0].status, 'confirmed')
            ]).toStrictEqual([1, 1, true])
        } finally {
            await app.close()
        }
    })

    it('retains a failed draft and supports a deliberate retry after a confirmed rejection', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            const [draft] = app.store.state.drafts
            app.remote.failCreate = true
            await expect(app.service.handle({ draftId: draft.id, type: 'publish' })).rejects.toThrow('400')
            expect([
                Object.is(app.store.state.saves[0].status, 'failed'),
                app.store.state.drafts?.length,
                app.store.state.coverage
            ]).toStrictEqual([true, 1, []])
            app.remote.failCreate = false
            await app.service.handle({ draftId: draft.id, type: 'publish' })
            expect(app.remote.pages).toHaveLength(1)
        } finally {
            await app.close()
        }
    })

    it('exports tracking and journal text without credentials, source patches, or repository contents', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            await app.service.handle({ activityId: app.store.state.activities[0].id, type: 'details' })
            await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
            await app.service.handle({ draftId: app.store.state.drafts[0].id, type: 'publish' })
            const backup = app.store.export()
            expect([backup?.includes('test-token'), backup?.includes('+initial')]).toStrictEqual([false, false])
            app.store.restore(backup)
            expect([
                app.store.state.drafts?.length,
                app.store.state.entries?.length,
                Boolean(app.store.state.repositories[0].available),
                Object.is(app.store.state.repositories[0].path, ''),
                app.store.state.diffs
            ]).toStrictEqual([1, 1, false, true, {}])
        } finally {
            await app.close()
        }
    })

    it('automatically groups future branch work into multiple features without granting coverage', async () => {
        const app = await workspace()
        try {
            await app.service.handle({ type: 'refresh' })
            const member = `branch:${app.repository.id}:development`
            await app.service.handle({ archived: false, id: 'one', members: [member], name: 'One', type: 'feature' })
            await app.service.handle({ archived: false, id: 'two', members: [member], name: 'Two', type: 'feature' })
            await app.git('commit', '--allow-empty', '-m', 'Next work')
            await app.service.handle({ type: 'refresh' })
            expect([
                featureActivities(app.store.state, 'one')?.length,
                featureActivities(app.store.state, 'two')?.length,
                app.store.state.coverage
            ]).toStrictEqual([2, 2, []])
            await app.service.handle({ archived: true, id: 'one', members: [member], name: 'Renamed', type: 'feature' })
            expect(featureActivities(app.store.state, 'one')).toHaveLength(2)
        } finally {
            await app.close()
        }
    })
})
