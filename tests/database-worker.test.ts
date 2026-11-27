import { DatabaseSync } from 'node:sqlite'
import type { Worker } from 'node:worker_threads'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { JournalDatabase } from '../src/main/journal-database'
import sharp from 'sharp'

it('surfaces a stalled save without replaying it and permits an explicit retry after worker exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-worker-stall-'))
    const path = join(root, 'journal.sqlite')
    let stalls = 0
    let database = await JournalDatabase.open(path, () => {
        stalls++
    })
    const lock = new DatabaseSync(path)
    try {
        const draft = await database.createDraft('2026-10-26')
        const edit = { ...draft, title: 'Explicitly retried writing' }
        lock.exec(
            'CREATE TRIGGER prevent_stalled_write BEFORE UPDATE ON drafts ' +
                "BEGIN SELECT RAISE(ABORT, 'write interrupted'); END; BEGIN IMMEDIATE"
        )
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const outcome = database.saveDraft(edit, draft.version).then(
            () => undefined,
            (error: unknown) => error
        )
        await vi.advanceTimersByTimeAsync(30001)
        vi.useRealTimers()
        expect(await outcome).toBeInstanceOf(Error)
        expect(stalls).toBe(1)
        await expect(database.draft(draft.id)).rejects.toThrow('Reopen')
        lock.exec('ROLLBACK')
        await database.close()
        lock.exec('DROP TRIGGER prevent_stalled_write')
        database = await JournalDatabase.open(path)
        expect((await database.draft(draft.id))?.title).toBe(draft.title)
        expect((await database.saveDraft(edit, draft.version)).title).toBe(edit.title)
    } finally {
        vi.useRealTimers()
        if (lock.isTransaction) lock.exec('ROLLBACK')
        lock.close()
        await database.close()
        await rm(root, { recursive: true, force: true })
    }
})

it('retries a failed image import without another draft edit and retains the bytes after reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-worker-image-'))
    const path = join(root, 'journal.sqlite')
    let database = await JournalDatabase.open(path)
    const db = new DatabaseSync(path)
    try {
        db.exec(
            "CREATE TRIGGER reject_image BEFORE INSERT ON images BEGIN SELECT RAISE(ABORT,'image disk failure'); END"
        )
        const bytes = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#aaa' } })
            .png()
            .toBuffer()
        await expect(database.importImage(bytes)).rejects.toThrow('could not be saved')
        db.exec('DROP TRIGGER reject_image')
        const id = await database.importImage(bytes)
        expect(await database.hasImage(id)).toBe(true)
        await database.close()
        database = await JournalDatabase.open(path)
        expect(Buffer.from((await database.image(id))!.bytes)).toEqual(bytes)
    } finally {
        await database.close()
        db.close()
        await rm(root, { recursive: true, force: true })
    }
})

it('keeps foreground timers responsive during a locked commit and drains the accepted save on close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gitorian-worker-'))
    const path = join(root, 'journal.sqlite')
    const database = await JournalDatabase.open(path)
    const lock = new DatabaseSync(path)
    try {
        const draft = await database.createDraft('2026-10-26')
        lock.exec('BEGIN IMMEDIATE')
        let saved = false
        const pending = database.saveDraft({ ...draft, title: 'Acknowledged writing' }, draft.version).then(() => {
            saved = true
        })
        await new Promise((resolve) => setTimeout(resolve, 80))
        expect(saved).toBe(false)
        const closing = database.close()
        await expect(database.createDraft('2026-11-02')).rejects.toThrow('closing')
        lock.exec('COMMIT')
        await pending
        await closing
        const reopened = await JournalDatabase.open(path)
        try {
            expect((await reopened.draft(draft.id))?.title).toBe('Acknowledged writing')
        } finally {
            await reopened.close()
        }
    } finally {
        if (lock.isTransaction) lock.exec('ROLLBACK')
        lock.close()
        await database.close()
        await rm(root, { recursive: true, force: true })
    }
})

it.each(['before commit', 'after commit'] as const)(
    'recovers actual worker exit %s and permits safe save retry',
    async (stage) => {
        const root = await mkdtemp(join(tmpdir(), 'gitorian-worker-death-'))
        const path = join(root, 'journal.sqlite')
        const created = new Promise<Worker>((resolve) => process.once('worker', resolve))
        const database = await JournalDatabase.open(path)
        const worker = await created
        try {
            const draft = await database.createDraft('2026-10-26')
            const edit = { ...draft, title: 'Recoverable writing' }
            if (stage === 'after commit') {
                await database.saveDraft(edit, draft.version)
                await worker.terminate()
            } else {
                const lock = new DatabaseSync(path)
                try {
                    lock.exec(
                        'CREATE TRIGGER prevent_interrupted_write BEFORE UPDATE ON drafts ' +
                            "BEGIN SELECT RAISE(ABORT, 'write interrupted'); END; BEGIN IMMEDIATE"
                    )
                    const save = expect(database.saveDraft(edit, draft.version)).rejects.toThrow(/worker|journal/i)
                    const exited = worker.terminate()
                    lock.exec('ROLLBACK')
                    await exited
                    await save
                    lock.exec('DROP TRIGGER prevent_interrupted_write')
                } finally {
                    lock.close()
                }
            }
            const committed = await database.draft(draft.id)
            expect(committed?.title).toBe(stage === 'before commit' ? draft.title : edit.title)
            const retried = await database.saveDraft(edit, draft.version)
            expect(retried.title).toBe(edit.title)
            expect(retried.version).toBe(2)
        } finally {
            await database.close()
            await rm(root, { recursive: true, force: true })
        }
    }
)
