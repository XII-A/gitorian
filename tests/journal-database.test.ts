import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { JournalDatabase } from '../src/main/journal-database'
import { emptyDocument, initialState } from '../src/shared/model'

const roots: string[] = []
afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function open() {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-database-'))
    roots.push(root)
    return { root, database: await JournalDatabase.open(join(root, 'journal.sqlite')) }
}

it('commits a draft, rejects a stale window, and reopens the acknowledged version', async () => {
    const { database, root } = await open()
    try {
        const draft = await database.createDraft('2026-10-26')
        const saved = await database.saveDraft({ ...draft, title: 'Durable writing' }, draft.version)
        await expect(database.saveDraft({ ...draft, title: 'Stale window' }, draft.version)).rejects.toThrow(
            /changed|conflict/i
        )
        expect(saved.version).toBe(draft.version + 1)
    } finally {
        await database.close()
    }
    const reopened = await JournalDatabase.open(join(root, 'journal.sqlite'))
    try {
        expect((await reopened.draftForWeek('2026-10-26'))?.title).toBe('Durable writing')
    } finally {
        await reopened.close()
    }
})

it('rejects an invalid restore atomically and fences commands from the previous journal generation', async () => {
    const { database } = await open()
    try {
        const draft = await database.createDraft('2026-10-26')
        const generation = database.generation
        const invalid = initialState()
        invalid.drafts = [
            { ...draft, body: { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'a'.repeat(64) } }] } }
        ]
        await expect(
            database.restore(JSON.stringify({ backupVersion: 3, state: invalid, images: [] }))
        ).rejects.toThrow(/image/i)
        expect((await database.draftForWeek(draft.week))?.id).toBe(draft.id)
        expect(database.generation).toBe(generation)
        const badTimezone = initialState(),
            badLayout = initialState(),
            badDate = initialState()
        badTimezone.settings.timezone = 'Not/A/Timezone'
        badLayout.settings.layout.order = ['draft', 'draft', 'activity']
        badDate.drafts = [{ ...draft, week: '2026-02-31' }]
        for (const state of [badTimezone, badLayout, badDate]) {
            await expect(database.restore(JSON.stringify({ backupVersion: 3, state, images: [] }))).rejects.toThrow()
            expect(database.generation).toBe(generation)
            expect((await database.draft(draft.id))?.id).toBe(draft.id)
        }
        await database.restore(JSON.stringify({ backupVersion: 3, state: initialState(), images: [] }))
        expect(database.generation).not.toBe(generation)
        await expect(database.saveDraft({ ...draft, body: emptyDocument }, draft.version, generation)).rejects.toThrow(
            /journal|restor/i
        )
    } finally {
        await database.close()
    }
})

it('keeps account identity and destination authoritative when a stale preferences form saves', async () => {
    const { database } = await open()
    try {
        const stale = database.config.settings
        await database.setDestination({ kind: 'page', id: 'new', titleProperty: 'Name', dateProperty: '' })
        await database.saveSettings({ ...stale, refreshMinutes: 0 })
        expect(database.config.settings.destination?.id).toBe('new')
    } finally {
        await database.close()
    }
})
it('finds old unlinked entries in bounded history without sending document bodies in summaries', async () => {
    const { database } = await open()
    try {
        for (let index = 0; index < 55; index++)
            await database.refreshEntry({
                id: `entry-${String(index).padStart(2, '0')}`,
                title: `Entry ${index}`,
                date: '2020-01-01',
                url: 'https://example.com',
                refreshedAt: '2020-01-01T12:00:00Z',
                body: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                { type: 'text', text: index === 54 ? 'Unique recovered lesson' : 'Archived writing' }
                            ]
                        }
                    ]
                }
            })
        expect((await database.readWorkspace()).entries).toEqual([])
        const first = await database.entryHistory('')
        expect(first.items).toHaveLength(50)
        expect(first.items[0]).not.toHaveProperty('body')
        expect((await database.entryHistory('', first.next)).items).toHaveLength(5)
        const found = await database.entryHistory('recovered lesson')
        expect(found.items.map((item) => item.id)).toEqual(['entry-54'])
        expect((await database.entry('entry-54'))?.body).toBeDefined()
    } finally {
        await database.close()
    }
})
