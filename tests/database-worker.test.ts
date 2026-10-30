import { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { JournalDatabase } from '../src/main/journal-database'
import sharp from 'sharp'

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

it.each(['before commit', 'after commit before acknowledgment'] as const)(
    'recovers worker death %s through a persisted version readback',
    async (stage) => {
        const root = await mkdtemp(join(tmpdir(), 'gitorian-worker-death-'))
        const database = await JournalDatabase.open(join(root, 'journal.sqlite'))
        const post = Worker.prototype.postMessage
        try {
            const draft = await database.createDraft('2026-10-26')
            const edit = { ...draft, title: 'Recoverable writing' }
            const fault = vi.spyOn(Worker.prototype, 'postMessage').mockImplementationOnce(function (
                this: Worker,
                message
            ) {
                if (stage === 'before commit') {
                    void this.terminate()
                    return
                }
                const emit = this.emit
                this.emit = function (event: string | symbol, ...args: unknown[]) {
                    if (
                        event === 'message' &&
                        args[0] &&
                        typeof args[0] === 'object' &&
                        'id' in args[0] &&
                        args[0].id === message.id
                    ) {
                        void this.terminate()
                        return true
                    }
                    return emit.call(this, event, ...args)
                }
                post.call(this, message)
            })
            await expect(database.saveDraft(edit, draft.version)).rejects.toThrow(/worker|journal/i)
            fault.mockRestore()
            const committed = await database.draft(draft.id)
            expect(committed?.title).toBe(stage === 'before commit' ? draft.title : edit.title)
            const retried = await database.saveDraft(edit, draft.version)
            expect(retried.title).toBe(edit.title)
            expect(retried.version).toBe(2)
        } finally {
            vi.restoreAllMocks()
            await database.close()
            await rm(root, { recursive: true, force: true })
        }
    }
)
