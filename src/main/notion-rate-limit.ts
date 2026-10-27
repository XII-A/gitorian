import { Effect } from 'effect'
import { HttpError } from './http'

export class NotionReadCancelled extends Error {
    readonly _tag = 'NotionReadCancelled'
    readonly name = 'AbortError'
    constructor(cause: unknown) {
        super('The operation was aborted', { cause })
    }
}

/** A 429 rejected this request; retry only that request, without replaying completed work. */
export function retryNotionRateLimit<T, E>(
    request: Effect.Effect<T, E>,
    signal?: AbortSignal,
    waiting?: (retryAt: number) => void
): Effect.Effect<T, E | NotionReadCancelled> {
    const operation = Effect.gen(function* () {
        for (let attempt = 0; ; attempt++) {
            const result = yield* Effect.either(request)
            if (result._tag === 'Right') return result.right
            const error = result.left
            if (!(error instanceof HttpError) || error.status !== 429 || !error.retryAt || attempt >= 3)
                return yield* Effect.fail(error)
            waiting?.(error.retryAt)
            yield* Effect.sleep(Math.max(0, error.retryAt - Date.now()))
        }
    })
    if (!signal) return operation
    return Effect.suspend(() => {
        if (signal.aborted) return Effect.fail(new NotionReadCancelled(signal.reason))
        return Effect.raceFirst(
            operation,
            Effect.async<never, NotionReadCancelled>((resume) => {
                const aborted = () => resume(Effect.fail(new NotionReadCancelled(signal.reason)))
                signal.addEventListener('abort', aborted, { once: true })
                if (signal.aborted) aborted()
                return Effect.sync(() => signal.removeEventListener('abort', aborted))
            })
        )
    })
}
