import { DurabilityError } from './durability-error'
import { makeSharedRequests } from './shared-requests'
import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Schedule } from 'effect'

export class HttpError extends Error {
    readonly _tag = 'HttpError'
    constructor(
        readonly status: number,
        message: string,
        readonly retryAt?: number
    ) {
        super(message)
    }
}
export class TransportError extends Error {
    readonly _tag = 'TransportError'
    constructor(readonly cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause))
    }
}

interface ReadOptions {
    background?: boolean
    maxBytes?: number
}
interface PauseStore {
    pauses: () => Record<string, number>
    changed: (scope: string, until: number) => void | Promise<void>
}
interface CachedResponse {
    etag: string
    value: unknown
    bytes: number
}

export type HttpFailure = HttpError | TransportError | DurabilityError
export interface Http {
    readonly request: <T>(
        url: string,
        token: string,
        init?: RequestInit,
        format?: 'json' | 'text',
        options?: ReadOptions
    ) => Effect.Effect<T, HttpFailure>
}
export const Http = Context.GenericTag<Http>('gitorian/Http')

/** Native adapters are supplied once; caches and credential lanes belong to this scope. */
export const HttpLive = (fetcher: typeof fetch = fetch, pauseStore?: PauseStore) =>
    Layer.scoped(
        Http,
        Effect.gen(function* () {
            const sharedRequests = yield* makeSharedRequests<string | symbol, unknown, HttpFailure>(
                () => new TransportError(new Error('HTTP transport is closed'))
            )
            const lanes = new Map<string, ReturnType<typeof priorityLane>>()
            const cache = new Map<string, CachedResponse>()
            let cacheBytes = 0
            const budgets = new Map<string, { remaining: number; reset: number }>()
            const lastRequest = new Map<string, number>()
            const transientPauses: Record<string, number> = {}
            const pauses = pauseStore?.pauses ?? (() => transientPauses)
            const pause = (scope: string, until: number): Effect.Effect<void, DurabilityError> =>
                Effect.tryPromise({
                    try: async () => {
                        const current = pauses()
                        current[scope] = Math.max(current[scope] ?? 0, until)
                        await pauseStore?.changed(scope, current[scope])
                    },
                    catch: (error) => new DurabilityError(error)
                })
            const readBody = (response: Response, maxBytes: number): Effect.Effect<string, HttpFailure> => {
                return Effect.acquireUseRelease(
                    Effect.sync(() => response.body?.getReader()),
                    (reader) =>
                        Effect.gen(function* () {
                            if (Number(response.headers.get('content-length') ?? 0) > maxBytes)
                                return yield* Effect.fail(
                                    new HttpError(413, 'Changes are too large to display. Open the source externally.')
                                )
                            if (!reader) return ''
                            const decoder = new TextDecoder()
                            let bytes = 0
                            let text = ''
                            for (;;) {
                                const part = yield* Effect.tryPromise({
                                    try: () => reader.read(),
                                    catch: (error) => new TransportError(error)
                                })
                                if (part.done) return text + decoder.decode()
                                bytes += part.value.byteLength
                                if (bytes > maxBytes)
                                    return yield* Effect.fail(
                                        new HttpError(
                                            413,
                                            'Changes are too large to display. Open the source externally.'
                                        )
                                    )
                                text += decoder.decode(part.value, { stream: true })
                            }
                        }),
                    (reader) =>
                        Effect.sync(() => {
                            if (!reader) return
                            // Initiate cancellation, but a stalled provider cleanup must not
                            // retain the reader lock or this credential's admission lane.
                            void reader.cancel().catch(() => {
                                /* Keep the request error as the result. */
                            })
                            reader.releaseLock()
                        })
                )
            }
            const perform = <T>(
                scope: string,
                key: string,
                url: string,
                headers: Headers,
                init: RequestInit,
                format: 'json' | 'text',
                options: ReadOptions,
                lane: ReturnType<typeof priorityLane>
            ): Effect.Effect<T, HttpFailure> => {
                const github = new URL(url).host === 'api.github.com'
                const read = !init.method || init.method === 'GET'
                const cached = read ? cache.get(key) : undefined
                if (cached) headers.set('If-None-Match', cached.etag)
                const attempt = Effect.gen(function* () {
                    const until = yield* Effect.try({
                        try: () => pauses()[scope] ?? 0,
                        catch: (error) => new DurabilityError(error)
                    })
                    if (until > Date.now())
                        return yield* Effect.fail(
                            new HttpError(
                                429,
                                `Service rate limit; requests paused until ${new Date(until).toLocaleString()}. Cached work is available.`,
                                until
                            )
                        )
                    const budget = budgets.get(scope)
                    if (github && options.background && budget && budget.reset > Date.now() && budget.remaining <= 500)
                        return yield* Effect.fail(
                            new HttpError(
                                429,
                                'Background GitHub refresh paused to preserve quota for opening changes.',
                                budget.reset
                            )
                        )
                    if (github && options.background) {
                        const delay = Math.max(0, 150 - (Date.now() - (lastRequest.get(scope) ?? 0)))
                        if (delay) yield* Effect.sleep(delay)
                    }
                    if (init.signal?.aborted) return yield* Effect.fail(new TransportError(init.signal.reason))
                    lastRequest.set(scope, Date.now())
                    const timeout = AbortSignal.timeout(30000)
                    const response = yield* Effect.acquireRelease(
                        Effect.interruptible(
                            Effect.tryPromise({
                                try: (interruption) =>
                                    fetcher(url, {
                                        ...init,
                                        signal: AbortSignal.any([
                                            timeout,
                                            interruption,
                                            ...(init.signal ? [init.signal] : [])
                                        ]),
                                        headers
                                    }),
                                catch: (error) => new TransportError(error)
                            })
                        ),
                        (response) =>
                            Effect.sync(() => {
                                if (response.body && !response.body.locked)
                                    void response.body.cancel().catch(() => {
                                        /* Cleanup must not replace the typed request failure. */
                                    })
                            })
                    )
                    const remaining = response.headers.get('x-ratelimit-remaining')
                    const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
                    if (remaining !== null) budgets.set(scope, { remaining: Number(remaining), reset })
                    if (remaining === '0' && reset) yield* pause(scope, reset)
                    if (response.status === 304 && cached) return cached.value as T
                    const body = yield* readBody(response, options.maxBytes ?? 8_000_000)
                    const secondary =
                        response.status === 403 &&
                        (/secondary rate limit|abuse detection/i.test(body) || response.headers.has('retry-after'))
                    if (response.status === 429 || secondary || (response.status === 403 && remaining === '0')) {
                        const retry = response.headers.get('retry-after')
                        const delay = retry
                            ? /^\d+$/.test(retry)
                                ? Number(retry) * 1000
                                : Math.max(0, Date.parse(retry) - Date.now())
                            : 60000
                        const retryAt = Math.max(Date.now() + delay, remaining === '0' ? reset : 0)
                        yield* pause(scope, retryAt)
                        return yield* Effect.fail(
                            new HttpError(
                                response.status,
                                `Source returned ${response.status}: rate limit. Retry after ${new Date(retryAt).toLocaleString()}.`,
                                retryAt
                            )
                        )
                    }
                    if (!response.ok) {
                        const detail =
                            response.status === 401
                                ? 'Reconnect the account in Settings.'
                                : response.status === 403
                                  ? 'The connected account does not have permission for this source.'
                                  : response.status === 404
                                    ? 'This source is missing or inaccessible to the connected account.'
                                    : response.statusText
                        return yield* Effect.fail(
                            new HttpError(response.status, `Source returned ${response.status}. ${detail}`)
                        )
                    }
                    const value =
                        format === 'text'
                            ? body
                            : yield* Effect.try({
                                  try: () => JSON.parse(body) as unknown,
                                  catch: (error) => new TransportError(error)
                              })
                    const etag = response.headers.get('etag')
                    if (read && etag) {
                        const previous = cache.get(key)
                        if (previous) cacheBytes -= previous.bytes
                        cache.delete(key)
                        cache.set(key, { etag, value, bytes: body.length * 2 })
                        cacheBytes += body.length * 2
                        while (cacheBytes > 20_000_000 || cache.size > 200) {
                            const oldest = cache.keys().next().value!
                            cacheBytes -= cache.get(oldest)!.bytes
                            cache.delete(oldest)
                        }
                    }
                    return value as T
                }).pipe(Effect.scoped)

                return (github ? lane(attempt, options.background ? 0 : 1) : attempt).pipe(
                    Effect.retry({
                        times: 2,
                        schedule: Schedule.exponential(200).pipe(Schedule.jittered),
                        while: (error) =>
                            read &&
                            !init.signal?.aborted &&
                            (error instanceof TransportError || (error instanceof HttpError && error.status >= 500))
                    })
                )
            }
            const request: Http['request'] = <T>(
                url: string,
                token: string,
                init: RequestInit = {},
                format: 'json' | 'text' = 'json',
                options: ReadOptions = {}
            ) =>
                Effect.suspend(() => {
                    const host = new URL(url).host
                    const credential = host + ':' + createHash('sha256').update(token).digest('hex').slice(0, 24)
                    const headers = new Headers(init.headers)
                    if (!(init.body instanceof FormData) && !headers.has('Content-Type'))
                        headers.set('Content-Type', 'application/json')
                    headers.set('Authorization', 'Bearer ' + token)
                    if (host === 'api.notion.com') {
                        if (!headers.has('Notion-Version')) headers.set('Notion-Version', '2025-09-03')
                    } else {
                        if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json')
                        headers.set('X-GitHub-Api-Version', '2022-11-28')
                    }
                    const read = !init.method || init.method === 'GET'
                    const key = JSON.stringify([
                        credential,
                        url,
                        [...headers]
                            .filter(([name]) => name !== 'authorization')
                            .sort(([a], [b]) => a.localeCompare(b)),
                        format,
                        options.maxBytes ?? 8_000_000
                    ])
                    let lane = lanes.get(credential)
                    if (!lane) {
                        lane = priorityLane()
                        lanes.set(credential, lane)
                    }
                    const operation = withAbort(
                        perform<T>(credential, key, url, headers, init, format, options, lane),
                        init.signal ?? undefined
                    )
                    // Foreground reads have independent eligibility; signaled reads and
                    // writes get an unshared child with the same transport ownership.
                    const inflightKey = read && !init.signal ? JSON.stringify([key, !!options.background]) : Symbol()

                    return sharedRequests(inflightKey, Effect.succeed(operation)).pipe(
                        Effect.map((value) => value as T)
                    )
                })
            return { request }
        })
    )

function withAbort<A, E, R>(
    operation: Effect.Effect<A, E, R>,
    signal?: AbortSignal
): Effect.Effect<A, E | TransportError, R> {
    if (!signal) return operation
    return Effect.raceFirst(
        operation,
        Effect.async<never, TransportError>((resume) => {
            const aborted = () => resume(Effect.fail(new TransportError(signal.reason)))
            if (signal.aborted) {
                aborted()
                return
            }
            signal.addEventListener('abort', aborted, { once: true })
            return Effect.sync(() => signal.removeEventListener('abort', aborted))
        })
    )
}

/** One credential lane: FIFO within a priority, cancellable while queued. */
function priorityLane() {
    let active = false
    const pending: { priority: number; start: () => void }[] = []
    const next = () => {
        if (!active) pending.shift()?.start()
    }
    return <A, E, R>(operation: Effect.Effect<A, E, R>, priority: number): Effect.Effect<A, E, R> =>
        Effect.uninterruptibleMask((restore) => {
            let admitted = false
            const waiting = Effect.async<undefined>((resume) => {
                const item = {
                    priority,
                    start: () => {
                        active = true
                        admitted = true
                        resume(Effect.succeed(undefined))
                    }
                }
                pending.push(item)
                pending.sort((a, b) => b.priority - a.priority)
                next()
                return Effect.sync(() => {
                    const index = pending.indexOf(item)
                    if (index >= 0) pending.splice(index, 1)
                })
            })
            return restore(waiting).pipe(
                Effect.zipRight(restore(operation)),
                Effect.ensuring(
                    Effect.sync(() => {
                        if (admitted) {
                            active = false
                            next()
                        }
                    })
                )
            )
        })
}
