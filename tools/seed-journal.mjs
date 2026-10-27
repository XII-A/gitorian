import { join } from 'node:path'
import { tsImport } from 'tsx/esm/api'

/** Seed disposable verification profiles through the production transaction boundary. */
export async function seedJournal(profile, state, images = []) {
    const { JournalDatabase } = await tsImport('../src/main/journal-database.ts', import.meta.url)
    const database = await JournalDatabase.open(join(profile, 'journal.sqlite'))
    try {
        await database.restore(JSON.stringify({ backupVersion: 3, state, images }))
        for (const repository of state.repositories) await database.saveRepository(repository)
    } finally {
        await database.close()
    }
}
