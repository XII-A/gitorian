import type { JournalDatabase } from '../src/main/journal-database'
import { stateSchema, type Draft, type State } from '../src/shared/model'

/** Read the real journal through its export interface; use only in small domain fixtures. */
export async function journalState(database: JournalDatabase): Promise<State> {
    const state = stateSchema.parse(JSON.parse(await database.export()).state)
    state.repositories = structuredClone(database.config.repositories)
    return state
}

/** Explicit fixture replacement, followed by reattaching its owned disposable repositories. */
export async function seedJournal(database: JournalDatabase, state: State) {
    const backup = JSON.parse(await database.export())
    await database.restore(JSON.stringify({ ...backup, state }))
    for (const repository of state.repositories) await database.saveRepository(repository)
}

export async function editDraft(database: JournalDatabase, index: number, update: (draft: Draft) => void) {
    const draft = (await journalState(database)).drafts[index]
    update(draft)
    return database.saveDraft(draft, draft.version)
}

export async function editPublication(database: JournalDatabase, update: (save: State['saves'][number]) => void) {
    const state = await journalState(database)
    update(state.saves.at(-1)!)
    await seedJournal(database, state)
}
