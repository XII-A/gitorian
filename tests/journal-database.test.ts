import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { JournalDatabase } from '../src/main/journal-database'
import { emptyDocument, initialState } from '../src/shared/model'
import { fromNotion, toNotion } from '../src/shared/notion-format'

const roots: string[] = []
afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function open() {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-database-'))
    roots.push(root)
    return { root, database: await JournalDatabase.open(join(root, 'journal.sqlite')) }
}

it('retains local writing policy on unchanged refresh, accepts remote edits, and rejects stale refresh', async () => {
    const { database } = await open()
    const body = {
        type: 'doc',
        attrs: { direction: 'rtl' },
        content: [
            { type: 'paragraph', attrs: { direction: 'ltr' }, content: [{ type: 'text', text: 'Türkçe والعربية' }] }
        ]
    }
    const entry = {
        id: 'direction-entry',
        title: 'كتابة',
        body,
        date: '2026-10-26',
        url: 'https://notion.so/test',
        refreshedAt: '2026-10-26T00:00:00Z'
    }
    try {
        await database.refreshEntry(entry)
        const remote = fromNotion(toNotion(body))
        await database.refreshEntry({ ...entry, body: remote }, database.generation, entry)
        expect((await database.entry('notion:direction-entry'))?.body).toEqual(body)
        const changed = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Remote edit' }] }]
        }
        await database.refreshEntry({ ...entry, body: changed }, database.generation, entry)
        expect((await database.entry('notion:direction-entry'))?.body).toEqual(changed)
        await expect(database.refreshEntry(entry, database.generation, entry)).rejects.toThrow(/changed/i)
        expect((await database.entry('notion:direction-entry'))?.body).toEqual(changed)
    } finally {
        await database.close()
    }
})

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

it('clones template direction and restores draft and template policies from a backup', async () => {
    const { database } = await open()
    try {
        const template = {
            type: 'doc',
            attrs: { direction: 'rtl' },
            content: [
                { type: 'paragraph', attrs: { direction: 'auto' }, content: [{ type: 'text', text: 'Template' }] }
            ]
        }
        await database.saveSettings({ ...initialState().settings, template })
        const draft = await database.createDraft('2026-10-26')
        expect(draft.body).toEqual(template)
        const body = { ...draft.body, content: [{ ...draft.body.content![0], attrs: { direction: 'ltr' } }] }
        await database.saveDraft({ ...draft, body }, draft.version)
        const backup = await database.export()
        await database.restore(backup)
        expect((await database.draftForWeek(draft.week))?.body).toEqual(body)
        expect((await database.createDraft('2026-10-19')).body).toEqual(template)
    } finally {
        await database.close()
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
        expect(found.items.map((item) => item.id)).toEqual(['notion:entry-54'])
        expect((await database.entry('notion:entry-54'))?.body).toBeDefined()
        for (let index = 0; index < 60; index++) {
            const week = new Date(Date.UTC(2021, 0, 4 + index * 7)).toISOString().slice(0, 10)
            const draft = await database.createDraft(week)
            await database.saveDraft({ ...draft, title: `Local ${index}` }, draft.version)
        }
        const started = performance.now()
        const identities: string[] = []
        let page = await database.entryHistory('')
        while (true) {
            identities.push(...page.items.map((item) => item.id))
            if (!page.next) break
            page = await database.entryHistory('', page.next)
        }
        expect(identities).toHaveLength(115)
        expect(new Set(identities).size).toBe(115)
        expect(performance.now() - started).toBeLessThan(2000)
    } finally {
        await database.close()
    }
})

it('searches durable local writing and prefers it over linked publication snapshots', async () => {
    const { database, root } = await open()
    let localId = ''
    try {
        const empty = await database.createDraft('2026-10-19')
        expect((await database.entryHistory('')).items).toEqual([])
        const draft = await database.createDraft('2026-10-26')
        const body = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A café lesson from local writing.' }] }]
        }
        await database.saveDraft({ ...draft, title: 'Local journal', body }, draft.version)
        await database.saveDraft({ ...empty, title: 'Title alone' }, empty.version)
        const backup = JSON.parse(await database.export()) as { state: ReturnType<typeof initialState> }
        const state = backup.state
        state.entries.push({
            id: 'remote-copy',
            title: 'Obsolete title',
            date: draft.week,
            body: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Obsolete remote content' }] }]
            },
            url: 'https://notion.so/example',
            refreshedAt: draft.updatedAt
        })
        state.drafts.find((item) => item.id === draft.id)!.publishedEntryId = 'remote-copy'
        await database.restore(JSON.stringify({ backupVersion: 3, state, images: [] }))
        const history = await database.entryHistory('CAFÉ')
        expect(history.items).toHaveLength(1)
        localId = history.items[0].id
        expect(history.items[0]).not.toHaveProperty('body')
        expect((await database.entry(localId))?.week).toBe(draft.week)
        expect((await database.entry(localId))?.url).toBe('https://notion.so/example')
        expect((await database.entryHistory('obsolete')).items).toEqual([])
        expect((await database.entryHistory('')).items).toHaveLength(2)
        const linked = await database.draft(draft.id)
        await database.saveDraft({ ...linked!, title: '', body: emptyDocument }, linked!.version)
        expect((await database.entryHistory('')).items).toHaveLength(2)
        expect((await database.entryHistory('obsolete')).items).toEqual([])
        await database.saveDraft(
            { ...(await database.draft(draft.id))!, title: 'Local journal', body },
            linked!.version + 1
        )
    } finally {
        await database.close()
    }
    const reopened = await JournalDatabase.open(join(root, 'journal.sqlite'))
    try {
        expect((await reopened.entryHistory('café')).items[0].id).toBe(localId)
        expect((await reopened.entry(localId))?.title).toBe('Local journal')
    } finally {
        await reopened.close()
    }
})
