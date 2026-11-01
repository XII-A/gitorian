import type { State } from '../src/shared/model'
import type { WritingBridge, WritingState } from '../src/shared/writing'
import { journal } from './fixtures'

/** Renderer tests cross the same session interface and real SQLite worker. */
export async function writingFixture(state: State) {
    const app = await journal()
    let draft = await app.store.createDraft(state.drafts[0]?.week ?? '2026-10-05')
    if (state.drafts[0])
        draft = await app.store.saveDraft(
            { ...draft, title: state.drafts[0].title, body: state.drafts[0].body },
            draft.version
        )
    state.drafts = [draft]
    state.restoreId = app.store.generation
    const listeners = new Set<(state: WritingState) => void>()
    const claims = new Set<string>()
    const bridge: WritingBridge = {
        claim: (client) => {
            if (claims.has(client)) return Promise.resolve(false)
            claims.add(client)
            return Promise.resolve(true)
        },
        release: (client) => {
            claims.delete(client)
            return Promise.resolve()
        },
        open: (id, generation, field) => app.store.openWriting(id, field, generation),
        submit: async (request) => {
            const next = await app.store.submitWriting(request)
            listeners.forEach((listener) => listener(next))
            return next
        },
        onChange: (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        onPrepare: () => () => {
            /* desktop owns lifecycle delivery */
        },
        onResume: () => () => {
            /* desktop owns lifecycle delivery */
        }
    }
    Object.assign(window, { journal: { writing: bridge } })
    return { ...app, bridge }
}
