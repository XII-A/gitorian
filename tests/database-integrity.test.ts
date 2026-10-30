import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import sharp from 'sharp'
import { JournalDatabase } from '../src/main/journal-database'
import type { Activity, Repository } from '../src/shared/model'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close()
})
const repository: Repository = {
    id: 'repository',
    name: 'Fixture',
    path: '',
    remote: '',
    base: 'main',
    trackingStart: '2026-10-01',
    emails: [],
    available: false,
    removed: false,
    branchBases: {},
    branches: []
}
const activity = (id: string): Activity => ({
    id,
    repositoryId: repository.id,
    kind: 'change-request',
    title: id,
    date: '2026-10-26T12:00:00Z',
    author: 'fixture',
    branches: ['main'],
    description: '',
    files: [],
    disposition: 'inbox',
    explicit: false,
    deletedBranches: []
})
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-integrity-')),
        path = join(root, 'journal.sqlite')
    const database = await JournalDatabase.open(path)
    cleanup.push(async () => {
        await database.close()
        await rm(root, { recursive: true, force: true })
    })
    await database.saveRepository(repository)
    return { database, path }
}

it('rolls back an entire acquisition batch and checkpoint on a dangling repository reference, then permits a valid retry', async () => {
    const { database } = await fixture()
    const batch = {
        activities: [activity('valid'), { ...activity('invalid'), repositoryId: 'missing' }],
        checkpoint: { key: 'remote:repository', value: { status: 'idle' as const, page: 2 } }
    }
    await expect(database.applyAcquisitionBatch(batch)).rejects.toThrow()
    expect(await database.activity('valid')).toBeUndefined()
    expect(database.config.acquisition['remote:repository']).toBeUndefined()
    await database.applyAcquisitionBatch({ ...batch, activities: [activity('valid')] })
    expect((await database.activity('valid'))?.title).toBe('valid')
    expect(database.config.acquisition['remote:repository'].page).toBe(2)
})

it('rejects a revision from another activity, deduplicates coverage, and permits only one unresolved publication', async () => {
    const { database, path } = await fixture()
    await database.applyAcquisitionBatch({ activities: [activity('a'), activity('b')] })
    await database.recordActivityDetails(activity('a'), 'patch', {
        id: 'revision-a',
        activityId: 'a',
        base: 'base',
        head: 'head',
        diff: 'patch'
    })
    const draft = await database.createDraft('2026-10-26')
    await expect(database.setSelection(draft.id, { activityId: 'b', revision: 'revision-a' }, true)).rejects.toThrow()
    expect((await database.draft(draft.id))?.selections).toEqual([])
    await database.refreshEntry({
        id: 'entry',
        title: 'Entry',
        date: '2026-10-26',
        url: 'https://example.invalid',
        body: draft.body,
        refreshedAt: '2026-10-26T12:00:00Z'
    })
    await database.setCoverage({ activityId: 'a' }, 'entry', true)
    await database.setCoverage({ activityId: 'a' }, 'entry', true)
    await database.setDestination({ kind: 'page', id: 'destination', titleProperty: 'Name', dateProperty: '' })
    await database.beginPublication(draft.id)
    await expect(database.beginPublication(draft.id)).rejects.toThrow('uncertain save')
    const db = new DatabaseSync(path, { readOnly: true })
    try {
        expect(db.prepare('SELECT count(*) AS total FROM entry_coverage').get()?.total).toBe(1)
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(db.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok')
        expect(
            db
                .prepare('PRAGMA table_list')
                .all()
                .filter(
                    (row) =>
                        row.type === 'table' &&
                        !String(row.name).startsWith('sqlite_') &&
                        row.name !== '__drizzle_migrations'
                )
                .every((row) => row.strict === 1)
        ).toBe(true)
    } finally {
        db.close()
    }
})

it('refuses a newer migration history before changing the journal', async () => {
    const { database, path } = await fixture()
    const generation = database.generation
    await database.close()
    const db = new DatabaseSync(path)
    db.prepare('INSERT INTO __drizzle_migrations(hash,created_at,name,applied_at) VALUES(?,?,?,?)').run(
        'future',
        Date.UTC(2099, 0, 1),
        '20990101000000_future',
        '2099-01-01'
    )
    db.close()
    let unexpected: JournalDatabase | undefined
    try {
        await expect(
            JournalDatabase.open(path).then((value) => {
                unexpected = value
                return value
            })
        ).rejects.toThrow(/newer|unsupported/i)
    } finally {
        await unexpected?.close()
    }
    const verify = new DatabaseSync(path, { readOnly: true })
    try {
        expect(verify.prepare('SELECT generation FROM journal').get()?.generation).toBe(generation)
    } finally {
        verify.close()
    }
})

it('collects expired unreferenced caches while preserving document images and selected revision evidence', async () => {
    const { database, path } = await fixture()
    const picture = (background: string) =>
        sharp({ create: { width: 4, height: 4, channels: 3, background } })
            .png()
            .toBuffer()
    const retained = await database.importImage(await picture('#fff')),
        unused = await database.importImage(await picture('#000'))
    const draft = await database.createDraft('2026-10-26')
    await database.saveDraft(
        { ...draft, body: { type: 'doc', content: [{ type: 'image', attrs: { assetId: retained } }] } },
        draft.version
    )
    await database.applyAcquisitionBatch({ activities: [activity('a'), activity('b')] })
    for (const id of ['a', 'b'])
        await database.recordActivityDetails(activity(id), `patch-${id}`, {
            id: `revision-${id}`,
            activityId: id,
            base: 'base',
            head: 'head',
            diff: `patch-${id}`
        })
    await database.setSelection(draft.id, { activityId: 'a', revision: 'revision-a' }, true)
    const db = new DatabaseSync(path)
    try {
        db.exec('UPDATE patches SET accessedAt=0')
    } finally {
        db.close()
    }
    await database.collectCaches()
    expect(await database.hasImage(retained)).toBe(true)
    expect(await database.hasImage(unused)).toBe(true)
    expect(await database.patch('a')).toBe('patch-a')
    expect(await database.patch('b')).toBeUndefined()
    expect(await database.revisions('b')).toHaveLength(1)
})
