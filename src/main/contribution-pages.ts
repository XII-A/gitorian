import { Effect } from 'effect'
import { HttpError } from './http'
import type { ActivityScan } from './contribution-reader'

export class ContributionIncomplete extends Error {
    readonly _tag = 'ContributionIncomplete'
}

export class ContributionYield extends HttpError {
    constructor(message: string) {
        super(429, message, Date.now() + 1000)
    }
}

/** Owns resumable read interest for one version of one contribution, never credential data. */
export function contributionPages(scan: ActivityScan) {
    let attempts = 0
    let pending = scan.pending
    let identity = ''
    const save = () => scan.savePending?.(pending) ?? Effect.void
    const select = (key: string) =>
        Effect.gen(function* () {
            identity = key
            if (scan.incomplete?.[key]) return false
            if (Object.keys(scan.incomplete ?? {}).some((prior) => prior.startsWith(key.split(':')[0] + ':')))
                yield* scan.recordIncomplete?.(key, '') ?? Effect.void
            if (pending?.key !== key) {
                pending = { key, pages: {} }
                yield* save()
            }
            return true
        })
    const read = <A>(url: string, request: () => Effect.Effect<A, Error>, staged = false): Effect.Effect<A, Error> =>
        Effect.gen(function* () {
            if (staged && pending?.key === identity && Object.hasOwn(pending.pages, url)) return pending.pages[url] as A
            if (attempts >= 25)
                return yield* Effect.fail(new ContributionYield('Background acquisition yielded after 25 reads.'))
            attempts++
            const value = yield* request()
            if (staged && pending?.key === identity) {
                const next = { ...pending, pages: { ...pending.pages, [url]: value } }
                if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 4_000_000)
                    return yield* Effect.fail(
                        new ContributionIncomplete(
                            'Contribution exceeds the 4 MB pending evidence limit; complete evidence remains unavailable.'
                        )
                    )
                pending = next
                yield* save()
            }
            return value
        })
    const complete = Effect.suspend(() => {
        pending = undefined
        return save()
    })
    const guard = <A>(work: Effect.Effect<A, Error>): Effect.Effect<A | undefined, Error> =>
        work.pipe(
            Effect.catchAll((error) => {
                if (
                    !(
                        error instanceof ContributionIncomplete ||
                        (error instanceof HttpError && !error.retryAt && [403, 404, 413].includes(error.status))
                    ) ||
                    !scan.recordIncomplete
                )
                    return Effect.fail(error)
                return scan
                    .recordIncomplete(identity, error.message)
                    .pipe(Effect.zipRight(complete), Effect.as(undefined))
            })
        )
    return { select, read, complete, guard }
}
