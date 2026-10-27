import { Context } from 'effect'
import type { Reply } from '../shared/model'
import type { Store } from './store'

/** Native SQLite adapter identity; restore replaces state inside this adapter. */
export const JournalStore = Context.GenericTag<Store>('gitorian/JournalStore')
export const ConnectionState = Context.GenericTag<{ snapshot: () => Reply['connections'] }>('gitorian/ConnectionState')

export class JournalError extends Error {
    readonly _tag = 'JournalError'
}
