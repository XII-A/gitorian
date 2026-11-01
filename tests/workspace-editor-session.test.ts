// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { EditorState } from '@tiptap/pm/state'
import { WritingClient } from '../src/renderer/writing-client'
import { bodySchema } from '../src/shared/writing-schema'
import { sampleState } from './workspace-fixture'
import { writingFixture } from './writing-fixture'

it('claims the latest recovery checkpoint rather than the copy read while its owner was still editing', async () => {
    localStorage.clear()
    const state = sampleState('2026-10-05')
    const app = await writingFixture(state)
    let owner: WritingClient | undefined
    let recovered: WritingClient | undefined
    try {
        owner = await WritingClient.open(app.bridge, bodySchema, state.drafts[0].id, state.restoreId!, 'body', () => {
            /* fixture */
        })
        let editor = EditorState.create({ schema: bodySchema, doc: owner.initial, plugins: [owner.plugin] })
        owner.attach({
            state: () => editor,
            dispatch: (tr) => {
                editor = editor.apply(tr)
            }
        })
        await owner.flush()
        editor = editor.apply(editor.tr.insertText('X', 1))
        owner.cache()
        const claim = app.bridge.claim
        app.bridge.claim = async (client) => {
            if (client === owner!.client) {
                editor = editor.apply(editor.tr.insertText('Y', 2))
                owner!.cache()
                owner!.dispose()
            }
            return claim(client)
        }
        recovered = await WritingClient.open(
            app.bridge,
            bodySchema,
            state.drafts[0].id,
            state.restoreId!,
            'body',
            () => {
                /* fixture */
            }
        )
        expect(recovered.initial.textContent.startsWith('XY')).toBe(true)
        expect(localStorage.length).toBe(0)
        expect(
            bodySchema.nodeFromJSON((await app.store.draft(state.drafts[0].id))!.body).textContent.startsWith('XY')
        ).toBe(true)
    } finally {
        owner?.dispose()
        recovered?.dispose()
        await app.close()
    }
})

it('rejects an unrepresentable paste before admitting it and can save the unrelated writing that follows', async () => {
    localStorage.clear()
    const state = sampleState('2026-10-05')
    const app = await writingFixture(state)
    const statuses: string[] = []
    const client = await WritingClient.open(
        app.bridge,
        bodySchema,
        state.drafts[0].id,
        state.restoreId!,
        'body',
        (value) => statuses.push(value)
    )
    try {
        let editor = EditorState.create({
            schema: bodySchema,
            doc: client.initial,
            plugins: [client.plugin, client.admission]
        })
        client.attach({
            state: () => editor,
            dispatch: (tr) => {
                editor = editor.apply(tr)
            }
        })
        await client.flush()
        editor = editor.apply(editor.tr.insertText('before ', 1))
        const retainedLength = editor.doc.textContent.length
        editor = editor.apply(editor.tr.insertText('x'.repeat(2_000_010), 8))
        expect(editor.doc.textContent.length).toBe(retainedLength)
        expect(statuses.at(-1)).toContain('Could not add')
        expect(bodySchema.nodeFromJSON(client.rejectedWriting!).textContent.length).toBeGreaterThan(2_000_000)
        editor = editor.apply(editor.tr.insertText('after ', 8))
        client.changed()
        await client.flush()
        const saved = bodySchema.nodeFromJSON((await app.store.draft(state.drafts[0].id))!.body)
        expect(saved.textContent.startsWith('before after ')).toBe(true)
        expect(saved.textContent.length).toBeLessThan(10000)
    } finally {
        client.dispose()
        await app.close()
    }
})

it('splits a pending prefix by serialized bytes so individually valid edits remain saveable', async () => {
    localStorage.clear()
    const state = sampleState('2026-10-05')
    const app = await writingFixture(state)
    const client = await WritingClient.open(
        app.bridge,
        bodySchema,
        state.drafts[0].id,
        state.restoreId!,
        'body',
        () => {
            /* fixture */
        }
    )
    try {
        let editor = EditorState.create({
            schema: bodySchema,
            doc: client.initial,
            plugins: [client.plugin, client.admission]
        })
        client.attach({
            state: () => editor,
            dispatch: (tr) => {
                editor = editor.apply(tr)
            }
        })
        await client.flush()
        const initialLength = editor.doc.textContent.length
        editor = editor.apply(editor.tr.insertText('a'.repeat(1_100_000), 1))
        editor = editor.apply(editor.tr.insertText('b'.repeat(1_100_000), 1))
        client.changed()
        await client.flush()
        expect(bodySchema.nodeFromJSON((await app.store.draft(state.drafts[0].id))!.body).textContent.length).toBe(
            initialLength + 2_200_000
        )
    } finally {
        client.dispose()
        await app.close()
    }
})

it('retains dependent pending edits on failed saves and recovers them in a fresh session', async () => {
    localStorage.clear()
    const state = sampleState('2026-10-05')
    const app = await writingFixture(state)
    const statuses: string[] = []
    const original = app.bridge.submit
    let fail = false
    app.bridge.submit = async (request) => {
        if (fail) throw new Error('disk unavailable')
        return original(request)
    }
    let client: WritingClient | undefined
    try {
        client = await WritingClient.open(
            app.bridge,
            bodySchema,
            state.drafts[0].id,
            state.restoreId!,
            'body',
            (value) => statuses.push(value)
        )
        let editor = EditorState.create({ schema: bodySchema, doc: client.initial, plugins: [client.plugin] })
        client.attach({
            state: () => editor,
            dispatch: (tr) => {
                editor = editor.apply(tr)
            }
        })
        await client.flush()
        fail = true
        editor = editor.apply(editor.tr.insertText('dependent ', 1))
        editor = editor.apply(editor.tr.insertText('recovery ', 11))
        client.changed()
        await expect(client.flush()).rejects.toThrow('disk unavailable')
        expect(statuses.at(-1)).toContain('Could not save')
        expect(localStorage.length).toBe(1)
        client.dispose()
        client = undefined
        fail = false
        client = await WritingClient.open(
            app.bridge,
            bodySchema,
            state.drafts[0].id,
            state.restoreId!,
            'body',
            (value) => statuses.push(value)
        )
        expect(client.initial.textContent).toContain('dependent recovery ')
        expect(localStorage.length).toBe(0)
        expect((await app.store.draft(state.drafts[0].id))!.body.content![0].content![0].text).toContain(
            'dependent recovery '
        )
    } finally {
        client?.dispose()
        await app.close()
    }
})
