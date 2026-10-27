import type { NotionError } from './notion'

/** Connection and durability failures remain distinct when composed with provider reads. */
export type ConnectionFailure = NotionError
export class ConnectionError extends Error {
    readonly _tag = 'ConnectionError'
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause), { cause })
    }
}
