import { expect, it } from 'vitest'
import { EditorState } from '@tiptap/pm/state'
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab'
import { history, undo } from '@tiptap/pm/history'
import { Step } from '@tiptap/pm/transform'
import { randomUUID } from 'node:crypto'
import { journal } from './fixtures'
import { bodySchema, titleSchema } from '../src/shared/writing-schema'
import type { WritingState } from '../src/shared/writing'
import { mkdtemp, readdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { JournalEngine } from '../src/main/database/engine'

it('migrates existing ordered writing history without losing pending recovery bases', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-writing-upgrade-'))
    const migrations = resolve('resources/migrations')
    const oldMigrations = join(directory, 'migrations')
    const path = join(directory, 'journal.sqlite')
    let engine: JournalEngine | undefined
    try {
        for (const name of await readdir(migrations))
            if (name !== '20261101115346_writing-step-history')
                await cp(join(migrations, name), join(oldMigrations, name), { recursive: true })
        engine = new JournalEngine(path, oldMigrations)
        const draft = engine.createDraft('2026-10-26', engine.config().generation)
        engine.close()
        engine = undefined
        const edit = EditorState.create({ schema: bodySchema, doc: bodySchema.nodeFromJSON(draft.body) }).tr.insertText(
            'Retained migration text ',
            1
        )
        const author = randomUUID()
        const db = new DatabaseSync(path)
        try {
            db.prepare('INSERT INTO writing_documents (draftId,field,document,steps,clients) VALUES (?,?,?,?,?)').run(
                draft.id,
                'body',
                JSON.stringify(edit.doc.toJSON()),
                JSON.stringify(edit.steps.map((s) => s.toJSON())),
                JSON.stringify(edit.steps.map(() => author))
            )
            db.prepare('UPDATE drafts SET body=? WHERE id=?').run(JSON.stringify(edit.doc.toJSON()), draft.id)
        } finally {
            db.close()
        }
        engine = new JournalEngine(path, migrations)
        const opened = engine.openWriting(draft.id, 'body', engine.config().generation)
        expect(opened.version).toBe(edit.steps.length)
        expect(bodySchema.nodeFromJSON(opened.document).textContent).toContain('Retained migration text')
        const missing = engine.submitWriting({
            draftId: draft.id,
            generation: opened.generation,
            field: 'body',
            client: randomUUID(),
            version: 0,
            steps: []
        })
        expect(missing.steps).toEqual(edit.steps.map((s) => s.toJSON()))
        expect(missing.clients).toEqual(edit.steps.map(() => author))
    } finally {
        engine?.close()
        await rm(directory, { recursive: true, force: true })
    }
})

it.each(['body', 'title'] as const)(
    'rebases simultaneous %s edits, acknowledges retries, scopes undo and fences pre-restore sessions',
    async (field) => {
        const app = await journal()
        try {
            const draft = await app.store.createDraft('2026-10-26')
            const generation = app.store.generation
            const opened = await app.store.openWriting(draft.id, field, generation)
            const schema = field === 'body' ? bodySchema : titleSchema
            const a = randomUUID(),
                b = randomUUID()
            let first = EditorState.create({
                schema,
                doc: schema.nodeFromJSON(opened.document),
                plugins: [collab({ clientID: a }), history()]
            })
            let second = EditorState.create({
                schema,
                doc: schema.nodeFromJSON(opened.document),
                plugins: [collab({ clientID: b }), history()]
            })
            const position = field === 'body' ? 1 : 0
            first = first.apply(first.tr.insertText('Window A ', position))
            second = second.apply(second.tr.insertText('Window B ', position))
            const sync = (state: EditorState, next: WritingState) =>
                state.apply(
                    receiveTransaction(
                        state,
                        next.steps.slice(getVersion(state) - next.fromVersion).map((s) => Step.fromJSON(schema, s)),
                        next.clients.slice(getVersion(state) - next.fromVersion)
                    )
                )
            const submit = (state: EditorState, client: string) =>
                app.store.submitWriting({
                    draftId: draft.id,
                    generation,
                    field,
                    client,
                    version: getVersion(state),
                    steps: sendableSteps(state)?.steps.map((s) => s.toJSON()) ?? []
                })
            const committedA = await submit(first, a)
            const retry = await submit(first, a)
            expect(retry.version).toBe(committedA.version)
            first = sync(first, retry)
            second = sync(second, await submit(second, b))
            const committedB = await submit(second, b)
            first = sync(first, committedB)
            second = sync(second, committedB)
            expect(first.doc.eq(second.doc)).toBe(true)
            expect(first.doc.textContent).toContain('Window A ')
            expect(first.doc.textContent).toContain('Window B ')
            undo(first, (tr) => {
                first = first.apply(tr)
            })
            expect(first.doc.textContent).not.toContain('Window A ')
            expect(first.doc.textContent).toContain('Window B ')
            const undone = await submit(first, a)
            const persisted = await app.store.draft(draft.id)
            expect(field === 'body' ? bodySchema.nodeFromJSON(persisted!.body).textContent : persisted!.title).toBe(
                schema.nodeFromJSON(undone.document).textContent
            )
            // Reject invalid candidate without changing canonical state or history.
            await expect(
                app.store.submitWriting({
                    draftId: draft.id,
                    generation,
                    field,
                    client: a,
                    version: undone.version,
                    steps: [{ stepType: 'replace', from: 900000, to: 900001 }]
                })
            ).rejects.toThrow()
            expect((await app.store.openWriting(draft.id, field, generation)).document).toEqual(undone.document)
            const backup = await app.store.export()
            await app.store.restore(backup)
            await expect(submit(first, a)).rejects.toThrow()
            const restored = await app.store.openWriting(draft.id, field, app.store.generation)
            expect(restored.version).toBe(0)
            expect(restored.document).toEqual(undone.document)
        } finally {
            await app.close()
        }
    }
)
