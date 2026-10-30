import { Context } from 'effect'
import type { Reply } from '../shared/model'
import type { JournalDatabase } from './journal-database'

/** Native SQLite adapter identity; restore replaces state inside this adapter. */
export const JournalStore = Context.GenericTag<JournalDatabase>('gitorian/JournalStore')
export const ConnectionState = Context.GenericTag<{ snapshot: () => Reply['connections'] }>('gitorian/ConnectionState')

export class JournalError extends Error {
    readonly _tag = 'JournalError'
}
