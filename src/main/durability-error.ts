export class DurabilityError extends Error {
    readonly _tag = 'DurabilityError'
    constructor(cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause), { cause })
    }
}
