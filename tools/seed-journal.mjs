import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { tsImport } from 'tsx/esm/api'

/** Serialize synthetic journal data at the shared restore boundary. */
export const journalFixtureBackup = (state, images = []) => JSON.stringify({ backupVersion: 3, state, images })

/** Seed disposable verification profiles through the production transaction boundary. */
export async function seedJournal(profile, state, images = []) {
    const { JournalDatabase } = await tsImport('../src/main/journal-database.ts', import.meta.url)
    await mkdir(profile, { recursive: true })
    const database = await JournalDatabase.open(join(profile, 'journal.sqlite'))
    try {
        await database.restore(journalFixtureBackup(state, images))
        for (const repository of state.repositories) await database.saveRepository(repository)
    } finally {
        await database.close()
    }
}
