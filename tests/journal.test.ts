import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { DurabilityError } from '../src/main/durability-error'
import { deferred } from './deferred'
import { journalState, seedJournal, editDraft } from './database-fixtures'
import { Effect, Fiber } from 'effect'
import { run } from './effect-fixtures'
import { describe, expect, it } from 'vitest'
import { JournalDatabase } from '../src/main/journal-database'
import { coveredEntries, inbox, weekOf } from '../src/shared/model'
import { journal, workspace } from './fixtures'
import type { JournalNode } from '../src/shared/model'
import { toNotion } from '../src/shared/notion-format'
const reflection: JournalNode = {
    type: 'doc',
    attrs: { direction: 'rtl' },
    content: [
        {
            type: 'heading',
            attrs: { level: 2, direction: 'auto' },
            content: [{ type: 'text', text: 'What I learned' }]
        },
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
    it('keeps verification recoverable when its confirmation checkpoint fails', async () => {
        const app = await journal()
        const database = new DatabaseSync(join(app.directory, 'tracking.sqlite'))
        try {
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const draft = (await journalState(app.store)).drafts[0]
            await editDraft(app.store, 0, (draft) => {
                draft.body = reflection
            })
            app.remote.loseCreateResponse = true
            await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow(
                'Connection lost'
            )
            const save = (await journalState(app.store)).saves[0]
            database.exec(
                'CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON publication_attempts ' +
                    "WHEN NEW.status = 'confirmed' " +
                    "BEGIN SELECT RAISE(ABORT, 'confirmation checkpoint failed'); END"
            )
            await expect(run(app.service.handle({ type: 'reconcile', saveId: save.id }))).rejects.toBeInstanceOf(
                DurabilityError
            )
            expect((await app.store.publication(save.id))!.status).toBe('unknown')
            expect((await app.store.draft(draft.id))!.publishedEntryId).toBeUndefined()
            expect((await journalState(app.store)).entries).toEqual([])
            expect((await journalState(app.store)).coverage).toEqual([])
            database.exec('DROP TRIGGER reject_checkpoint')
            await run(app.service.handle({ type: 'reconcile', saveId: save.id }))
            expect((await app.store.publication(save.id))!.status).toBe('confirmed')
            expect(app.remote.pages).toHaveLength(1)
            expect((await journalState(app.store)).entries[0].body).toEqual(reflection)
        } finally {
            database.close()
            await app.close()
        }
    })
    it('persists uncertain publishing before returning a lost-response error', async () => {
        const app = await journal()
        try {
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const state = await journalState(app.store)
            app.remote.loseCreateResponse = true
            await expect(run(app.service.handle({ type: 'publish', draftId: state.drafts[0].id }))).rejects.toThrow(
                'Connection lost'
            )
            const saved = await JournalDatabase.open(join(app.directory, 'tracking.sqlite'))
            try {
                const attempt = (await journalState(saved)).saves[0]
                expect(attempt.status).toBe('unknown')
                await run(app.service.handle({ type: 'reconcile', saveId: attempt.id }))
                expect((await app.store.publication(attempt.id))?.status).toBe('confirmed')
                expect(app.remote.pages).toHaveLength(1)
            } finally {
                await saved.close()
            }
        } finally {
            await app.close()
        }
    })
    it('refuses ambiguous matching pages after a lost creation response', async () => {
        const app = await journal()
        try {
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const draft = (await journalState(app.store)).drafts[0]
            app.remote.loseCreateResponse = true
            await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow(
                'Connection lost'
            )
            app.remote.pages.push({ ...structuredClone(app.remote.pages[0]), id: 'another-page' })
            await expect(
                run(app.service.handle({ type: 'reconcile', saveId: (await journalState(app.store)).saves[0].id }))
            ).rejects.toThrow('More than one matching')
            expect((await journalState(app.store)).saves[0].status).toBe('unknown')
            expect((await journalState(app.store)).coverage).toEqual([])
        } finally {
            await app.close()
        }
    })
    it('recovers a formatted draft and captured selection after layout changes and restart', async () => {
        const app = await workspace()
        try {
            await run(app.service.handle({ type: 'refresh' }))
            const activity = (await journalState(app.store)).activities[0]
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const draft = (await journalState(app.store)).drafts[0]
            await run(app.service.handle({ type: 'draft', draft: { ...draft, body: reflection } }))
            await run(
                app.service.handle({ type: 'select', draftId: draft.id, activityId: activity.id, included: true })
            )
            await run(
                app.service.handle({
                    type: 'settings',
                    settings: {
                        ...(await journalState(app.store)).settings,
                        layout: {
                            order: ['draft', 'details', 'activity'],
                            hidden: ['activity'],
                            sizes: { draft: 60, details: 40 }
                        }
                    }
                })
            )
            expect((await run(app.service.reply())).state.coverage).toEqual([])
            await app.store.close()
            const reopened = await JournalDatabase.open(`${app.directory}/tracking.sqlite`)
            expect((await journalState(reopened)).drafts[0].body).toEqual(reflection)
            expect((await journalState(reopened)).drafts[0].selections).toEqual([{ activityId: activity.id }])
            expect((await journalState(reopened)).settings.layout.order).toEqual(['draft', 'details', 'activity'])
            await reopened.close()
        } finally {
            await app.close()
        }
    })
    it('keeps older history out of the inbox and returns deferred work only in its chosen week', async () => {
        const app = await workspace()
        try {
            expect(app.repository.trackingStart).toBe(weekOf(new Date(), (await journalState(app.store)).settings))
            await run(
                app.service.handle({
                    type: 'history',
                    repositoryId: app.repository.id,
                    branch: 'development',
                    view: 'history',
                    author: '',
                    since: ''
                })
            )
            const activity = (await journalState(app.store)).activities[0]
            activity.date = '2025-01-01T12:00:00Z'
            expect(inbox(await journalState(app.store), '2026-10-05')).toEqual([])
            await run(
                app.service.handle({
                    type: 'disposition',
                    activityId: activity.id,
                    disposition: 'deferred',
                    until: '2026-10-12'
                })
            )
            expect(inbox(await journalState(app.store), '2026-10-05')).toEqual([])
            expect(inbox(await journalState(app.store), '2026-10-12').map((item) => item.id)).toEqual([activity.id])
            await run(
                app.service.handle({
                    type: 'disposition',
                    activityId: activity.id,
                    disposition: 'dismissed',
                    reason: 'Already understood'
                })
            )
            expect(inbox(await journalState(app.store), '2026-10-12')).toEqual([])
            expect((await run(app.service.reply())).state.activities[0].reason).toBe('Already understood')
            await run(
                app.service.handle({
                    type: 'disposition',
                    activityId: activity.id,
                    disposition: 'deferred',
                    until: '2026-10-12'
                })
            )
            expect(inbox(await journalState(app.store), '2026-10-12')).toHaveLength(1)
            expect((await journalState(app.store)).coverage).toEqual([])
        } finally {
            await app.close()
        }
    })
    it('preserves pending coverage across an ambiguous save and verifies before any retry', async () => {
        const app = await workspace()
        try {
            await run(app.service.handle({ type: 'refresh' }))
            const activity = (await journalState(app.store)).activities[0]
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const draft = (await journalState(app.store)).drafts[0]
            await run(app.service.handle({ type: 'draft', draft: { ...draft, body: reflection } }))
            await run(
                app.service.handle({ type: 'select', draftId: draft.id, activityId: activity.id, included: true })
            )
            app.remote.loseCreateResponse = true
            await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow(
                'Connection lost'
            )
            expect((await run(app.service.reply())).state.coverage).toEqual([])
            expect((await journalState(app.store)).saves[0].status).toBe('unknown')
            expect((await journalState(app.store)).drafts[0].body).toEqual(reflection)
            await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow(
                'uncertain save'
            )
            await run(app.service.handle({ type: 'reconcile', saveId: (await journalState(app.store)).saves[0].id }))
            expect(app.remote.pages).toHaveLength(1)
            expect(coveredEntries(await journalState(app.store), activity)).toHaveLength(1)
            expect((await journalState(app.store)).saves[0].status).toBe('confirmed')
        } finally {
            await app.close()
        }
    })
    it('retains a failed draft and supports a deliberate retry after a confirmed rejection', async () => {
        const app = await journal()
        try {
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const draft = (await journalState(app.store)).drafts[0]
            app.remote.failCreate = true
            await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow('400')
            expect((await journalState(app.store)).saves[0].status).toBe('failed')
            expect((await journalState(app.store)).drafts).toHaveLength(1)
            expect((await journalState(app.store)).coverage).toEqual([])
            app.remote.failCreate = false
            await run(app.service.handle({ type: 'publish', draftId: draft.id }))
            expect(app.remote.pages).toHaveLength(1)
        } finally {
            await app.close()
        }
    })
    it('exports tracking and journal text with captured evidence but without credentials or local paths', async () => {
        const app = await workspace()
        try {
            await run(app.service.handle({ type: 'refresh' }))
            await run(
                app.service.handle({ type: 'details', activityId: (await journalState(app.store)).activities[0].id })
            )
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            await run(app.service.handle({ type: 'publish', draftId: (await journalState(app.store)).drafts[0].id }))
            const published = structuredClone((await journalState(app.store)).entries[0])
            const unrelated = { ...published, id: 'unrelated' }
            await app.store.refreshEntry(unrelated)
            await app.store.setCoverage({ activityId: (await app.store.activities())[0].id }, unrelated.id, true)
            const coverage = structuredClone((await journalState(app.store)).coverage)
            const expectedDiffs = (await journalState(app.store)).diffs
            const backup = await app.store.export()
            expect(backup).not.toContain('test-token')
            expect(backup).toContain('diff --git')
            expect(JSON.parse(backup).state.acquisition).toBeUndefined()
            expect(backup).not.toContain(app.directory.replaceAll('\\', '\\\\'))
            await app.store.restore(backup)
            expect((await journalState(app.store)).drafts).toHaveLength(1)
            expect((await journalState(app.store)).entries).toEqual([published, unrelated])
            expect((await journalState(app.store)).coverage).toEqual(coverage)
            expect((await journalState(app.store)).repositories[0].available).toBe(false)
            expect((await journalState(app.store)).repositories[0].path).toBe('')
            expect((await journalState(app.store)).diffs).toEqual(expectedDiffs)
            const reopened = await JournalDatabase.open(`${app.directory}/tracking.sqlite`)
            try {
                expect((await journalState(reopened)).entries).toEqual([published, unrelated])
                expect((await journalState(reopened)).coverage).toEqual(coverage)
            } finally {
                await reopened.close()
            }
        } finally {
            await app.close()
        }
    })
})
it('reuses a weekly draft and republishes edits to the same Notion page', async () => {
    const app = await journal()
    try {
        const week = '2026-10-05'
        await run(app.service.handle({ type: 'newDraft', week }))
        const draft = (await journalState(app.store)).drafts[0]
        await run(app.service.handle({ type: 'newDraft', week }))
        expect((await journalState(app.store)).drafts).toHaveLength(1)
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        const entryId = (await app.store.draft(draft.id))!.publishedEntryId
        await run(app.service.handle({ type: 'newDraft', week }))
        expect((await journalState(app.store)).drafts).toHaveLength(1)
        await run(app.service.handle({ type: 'draft', draft: { ...draft, title: 'Revised week', body: reflection } }))
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect(app.remote.pages).toHaveLength(1)
        expect((await app.store.draft(draft.id))!.publishedEntryId).toBe(entryId)
        expect((await journalState(app.store)).entries).toHaveLength(1)
        expect((await journalState(app.store)).entries[0]).toMatchObject({
            id: entryId,
            title: 'Revised week',
            body: reflection
        })
        expect(app.remote.pages[0].blocks).toHaveLength(reflection.content!.length)
        expect(JSON.stringify(app.remote.pages[0].blocks)).not.toContain('Published with Gitorian')
        expect(toNotion((await run(app.notion.refreshEntry(entryId!))).body)).toEqual(toNotion(reflection))
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-12' }))
        expect((await journalState(app.store)).drafts.filter((item) => item.week === week)).toHaveLength(1)
        const reopened = await JournalDatabase.open(`${app.directory}/tracking.sqlite`)
        try {
            expect((await journalState(reopened)).drafts.find((item) => item.week === week)).toMatchObject({
                id: draft.id,
                publishedEntryId: entryId,
                title: 'Revised week',
                body: reflection
            })
        } finally {
            await reopened.close()
        }
    } finally {
        await app.close()
    }
})
it('verifies an interrupted republish without duplicating the page or its writing', async () => {
    const app = await journal()
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        const updated: JournalNode = {
            type: 'doc',
            content: Array.from({ length: 120 }, (_, index) => ({
                type: 'paragraph',
                content: [{ type: 'text', text: `Paragraph ${index}` }]
            }))
        }
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        await run(app.service.handle({ type: 'draft', draft: { ...draft, title: 'Updated title', body: updated } }))
        app.remote.loseAppendResponse = true
        await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow('after commit')
        const save = (await journalState(app.store)).saves.at(-1)!
        expect((await app.store.publication(save.id))!.status).toBe('unknown')
        await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow('uncertain save')
        await Promise.all([
            run(app.service.handle({ type: 'reconcile', saveId: save.id })),
            run(app.service.handle({ type: 'reconcile', saveId: save.id }))
        ])
        expect((await app.store.publication(save.id))!.status).toBe('confirmed')
        expect(app.remote.pages).toHaveLength(1)
        expect(app.remote.pages[0].blocks).toHaveLength(updated.content!.length)
        expect(await run(app.notion.refreshEntry((await app.store.draft(draft.id))!.publishedEntryId!))).toMatchObject({
            title: 'Updated title',
            body: updated
        })
    } finally {
        await app.close()
    }
})
it('keeps the weekly page linked when writing changes during a publish', async () => {
    const app = await journal()
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        app.remote.beforeRequest = async (url) => {
            if (!url.endsWith('/pages')) return
            app.remote.beforeRequest = undefined
            await run(
                app.service.handle({
                    type: 'draft',
                    draft: { ...draft, title: 'Newer local writing', body: reflection }
                })
            )
        }
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect((await app.store.draft(draft.id))!.publishedEntryId).toBe(app.remote.pages[0].id)
        expect((await app.store.draft(draft.id))!.body).toEqual(reflection)
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect(app.remote.pages).toHaveLength(1)
        expect((await journalState(app.store)).entries[0]).toMatchObject({
            title: 'Newer local writing',
            body: reflection
        })
    } finally {
        await app.close()
    }
})
it('keeps a rejected intent checkpoint retryable without dispatching a remote write', async () => {
    const app = await journal()
    const database = new DatabaseSync(join(app.directory, 'tracking.sqlite'))
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        database.exec(
            'CREATE TRIGGER reject_publication_intent BEFORE INSERT ON publication_attempts ' +
                "BEGIN SELECT RAISE(ABORT, 'intent checkpoint failed'); END"
        )
        await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toBeInstanceOf(
            DurabilityError
        )
        expect(app.remote.pages).toHaveLength(0)
        expect((await journalState(app.store)).saves).toEqual([])
        database.exec('DROP TRIGGER reject_publication_intent')
        const durableIntents: number[] = []
        app.remote.beforeRequest = (url) => {
            if (url.endsWith('/pages')) {
                const rows = database.prepare("SELECT id FROM publication_attempts WHERE status = 'pending'").all()
                durableIntents.push(rows.length)
            }
            return Promise.resolve()
        }
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect(durableIntents).toEqual([1])
        expect(app.remote.pages).toHaveLength(1)
        expect((await journalState(app.store)).saves.at(-1)?.status).toBe('confirmed')
    } finally {
        database.close()
        await app.close()
    }
})
it('durably exposes an interrupted remote publish for verification without restarting', async () => {
    const app = await journal()
    const entered = deferred<undefined>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    let fiber: Fiber.RuntimeFiber<unknown, Error> | undefined
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        app.remote.beforeCreateReply = () => {
            entered.resolve(undefined)
            return gate
        }
        fiber = Effect.runFork(app.service.handle({ type: 'publish', draftId: draft.id }))
        await entered.promise
        await Effect.runPromise(Fiber.interrupt(fiber))
        const save = (await journalState(app.store)).saves[0]
        expect((await app.store.publication(save.id))!.status).toBe('unknown')
        expect(app.remote.pages).toHaveLength(1)
        await run(app.service.handle({ type: 'reconcile', saveId: save.id }))
        expect((await app.store.publication(save.id))!.status).toBe('confirmed')
        expect(app.remote.pages).toHaveLength(1)
    } finally {
        release()
        if (fiber) await Effect.runPromise(Fiber.interrupt(fiber))
        await app.close()
    }
})
it('commits replacement progress before mutating a partially published page', async () => {
    const app = await journal()
    const database = new DatabaseSync(join(app.directory, 'tracking.sqlite'))
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        const save = {
            ...structuredClone((await journalState(app.store)).saves[0]),
            id: 'interrupted-update',
            status: 'unknown' as const,
            updateExisting: true,
            title: 'Updated',
            body: reflection,
            replacedBlockIds: undefined
        }
        const seeded = await journalState(app.store)
        seeded.saves.push({ ...save, marker: 'interrupted-update-marker' })
        await seedJournal(app.store, seeded)
        database.exec(
            'CREATE TRIGGER reject_progress BEFORE UPDATE ON publication_attempts ' +
                "WHEN NEW.replacedBlockIds IS NOT NULL AND NEW.status != 'confirmed' " +
                "BEGIN SELECT RAISE(ABORT, 'replacement progress unavailable'); END"
        )
        const start = app.remote.requests.length
        const verify = () => app.service.handle({ type: 'reconcile', saveId: save.id })
        await expect(run(verify())).rejects.toBeInstanceOf(DurabilityError)
        expect((await app.store.publication(save.id))?.replacedBlockIds).toBeUndefined()
        expect(app.remote.requests.slice(start).filter((request) => request.method !== 'GET')).toEqual([])
        database.exec('DROP TRIGGER reject_progress')
        await run(verify())
        expect((await app.store.publication(save.id))?.status).toBe('confirmed')
        expect(app.remote.pages).toHaveLength(1)
        expect((await journalState(app.store)).entries[0].body).toEqual(reflection)
    } finally {
        database.close()
        await app.close()
    }
})
it('checkpoints a volatile page ID before resuming any remote append', async () => {
    const app = await journal()
    const database = new DatabaseSync(join(app.directory, 'tracking.sqlite'))
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        {
            draft.body = {
                type: 'doc',
                content: Array.from({ length: 250 }, (_, index) => ({
                    type: 'paragraph',
                    content: [{ type: 'text', text: `Writing ${index}` }]
                }))
            }
            Object.assign(draft, await app.store.saveDraft(draft, draft.version))
        }
        database.exec(
            'CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON publication_attempts ' +
                'WHEN NEW.entryId IS NOT NULL ' +
                "BEGIN SELECT RAISE(ABORT, 'page checkpoint unavailable'); END"
        )
        await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toBeInstanceOf(
            DurabilityError
        )
        const save = (await journalState(app.store)).saves[0]
        expect((await app.store.publication(save.id))!.status).toBe('unknown')
        expect(app.remote.pages[0].blocks).toHaveLength(100)
        const start = app.remote.requests.length
        await expect(run(app.service.handle({ type: 'reconcile', saveId: save.id }))).rejects.toBeInstanceOf(
            DurabilityError
        )
        expect(app.remote.requests.slice(start).filter((request) => request.method !== 'GET')).toHaveLength(0)
        database.exec('DROP TRIGGER reject_checkpoint')
        await run(app.service.handle({ type: 'reconcile', saveId: save.id }))
        expect((await app.store.publication(save.id))!.status).toBe('confirmed')
        expect(app.remote.pages).toHaveLength(1)
        expect(app.remote.pages[0].blocks).toHaveLength(250)
    } finally {
        database.close()
        await app.close()
    }
})
it('allows correcting an unsupported document after a typed preflight failure', async () => {
    const app = await journal()
    try {
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        const draft = (await journalState(app.store)).drafts[0]
        {
            draft.body = { type: 'doc', content: [{ type: 'unsupported-block' }] }
            Object.assign(draft, await app.store.saveDraft(draft, draft.version))
        }
        const result = await run(Effect.either(app.service.handle({ type: 'publish', draftId: draft.id })))
        expect(result._tag).toBe('Left')
        expect(app.remote.requests).toEqual([])
        expect((await journalState(app.store)).saves[0].status).toBe('failed')
        {
            draft.body = reflection
            Object.assign(draft, await app.store.saveDraft(draft, draft.version))
        }
        await run(app.service.handle({ type: 'publish', draftId: draft.id }))
        expect((await journalState(app.store)).saves.at(-1)?.status).toBe('confirmed')
        expect(app.remote.pages).toHaveLength(1)
    } finally {
        await app.close()
    }
})
