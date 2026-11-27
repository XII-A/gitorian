import { deferred } from './deferred'
import { Effect, Fiber, ManagedRuntime } from 'effect'
import { Http, HttpLive } from '../src/main/http'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { http as route } from 'msw'
import { setupServer } from 'msw/node'
import { transportClient, run } from './effect-fixtures'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('releases admission after abort even when stream cancellation never completes', async () => {
    let releaseCancellation!: () => void
    const cancellation = new Promise<void>((resolve) => {
        releaseCancellation = resolve
    })
    const stream = new ReadableStream<Uint8Array>({ cancel: () => cancellation })
    // Fetch interception wraps the body. Keep the actual reader and cancellation promise observable here.
    const http = await transportClient((url) =>
        Promise.resolve(
            (url instanceof Request ? url.url : url.toString()).endsWith('/held')
                ? new Response(stream)
                : Response.json({ ok: true })
        )
    )
    const controller = new AbortController()
    const pending = run(http.request('https://api.github.com/held', 'fixture', { signal: controller.signal }))
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
        await vi.waitFor(() => expect(stream.locked).toBe(true))
        controller.abort(new Error('Cancelled transport'))
        const bounded = Promise.race([
            pending,
            new Promise((_, reject) => {
                deadline = setTimeout(() => reject(new Error('Cleanup deadline exceeded')), 1000)
            })
        ])
        await expect(bounded).rejects.toThrow('Cancelled transport')
        expect(stream.locked).toBe(false)
        expect(await run(http.request('https://api.github.com/next', 'fixture'))).toEqual({ ok: true })
    } finally {
        if (deadline) clearTimeout(deadline)
        releaseCancellation()
        await pending.catch(() => {
            /* Cancellation is the expected result. */
        })
    }
})
it('retries temporary read failures but never replays an uncertain write', async () => {
    const methods: string[] = []
    const reject = ({ request }: { request: Request }) => {
        methods.push(request.method)
        return Response.json({}, { status: 503 })
    }
    server.use(route.get('https://api.github.com/user', reject), route.post('https://api.notion.com/v1/pages', reject))
    const client = await transportClient()
    await expect(run(client.request('https://api.github.com/user', 'fixture'))).rejects.toThrow('503')
    await expect(run(client.request('https://api.notion.com/v1/pages', 'fixture', { method: 'POST' }))).rejects.toThrow(
        '503'
    )
    expect(methods).toEqual(['GET', 'GET', 'GET', 'POST'])
})
it('cancels retry waits without issuing another request', async () => {
    const controller = new AbortController()
    const entered = deferred<undefined>()
    let requests = 0
    server.use(
        route.get('https://api.github.com/user', () => {
            requests++
            entered.resolve(undefined)
            return Response.json({}, { status: 503 })
        })
    )
    const client = await transportClient()
    const pending = run(client.request('https://api.github.com/user', 'fixture', { signal: controller.signal }))
    try {
        await entered.promise
        controller.abort(new Error('Cancelled transport'))
        await expect(pending).rejects.toThrow('Cancelled transport')
        expect(requests).toBe(1)
    } finally {
        controller.abort()
        await pending.catch(() => undefined)
    }
})
it('releases an oversized response reader and admits the next foreground request', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(16))
        },
        cancel() {
            cancelled = true
        }
    })
    const http = await transportClient((url) =>
        Promise.resolve(
            (url instanceof Request ? url.url : url.toString()).endsWith('/large')
                ? new Response(stream)
                : Response.json({ ok: true })
        )
    )
    await expect(
        run(http.request('https://api.github.com/large', 'fixture', {}, 'json', { maxBytes: 8 }))
    ).rejects.toMatchObject({ status: 413 })
    expect(cancelled).toBe(true)
    expect(stream.locked).toBe(false)
    expect(await run(http.request('https://api.github.com/next', 'fixture'))).toEqual({ ok: true })
})
it('interrupts the shared fetch when its last reader leaves and permits scope disposal', async () => {
    let signal: AbortSignal | undefined
    let release!: () => void
    const runtime = ManagedRuntime.make(
        HttpLive((_url, init) => {
            signal = init?.signal ?? undefined
            return new Promise<Response>((resolve) => {
                release = () => resolve(new Response('{}'))
            })
        })
    )
    const http = await runtime.runPromise(Http)
    const reader = Effect.runFork(http.request('https://api.github.com/shared', 'fixture'))
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
        await vi.waitFor(() => expect(signal).toBeDefined())
        await Promise.race([
            Effect.runPromise(Fiber.interrupt(reader)),
            new Promise((_, reject) => {
                deadline = setTimeout(() => reject(new Error('Reader did not stop')), 1000)
            })
        ])
        expect(signal?.aborted).toBe(true)
        await runtime.dispose()
    } finally {
        if (deadline) clearTimeout(deadline)
        release()
        await runtime.dispose()
    }
})
it('keeps foreground reads eligible when matching background work exhausts its reserve', async () => {
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    const requests: string[] = []
    server.use(
        route.get('https://api.github.com/held', async () => {
            requests.push('held')
            entered.resolve(undefined)
            await release.promise
            return Response.json(
                {},
                {
                    headers: {
                        'x-ratelimit-remaining': '499',
                        'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 60)
                    }
                }
            )
        }),
        route.get('https://api.github.com/shared', () => {
            requests.push('shared')
            return Response.json({ foreground: true })
        })
    )
    const http = await transportClient()
    const held = run(http.request('https://api.github.com/held', 'fixture'))
    await entered.promise
    const background = run(
        http.request('https://api.github.com/shared', 'fixture', {}, 'json', { background: true })
    ).catch((error: unknown) => error)
    const foreground = run(http.request('https://api.github.com/shared', 'fixture'))
    release.resolve(undefined)
    await held
    expect(await foreground).toEqual({ foreground: true })
    expect(await background).toMatchObject({ status: 429 })
    expect(requests).toEqual(['held', 'shared'])
})
it('keeps different Notion representations separate in concurrent reads and ETag caching', async () => {
    const seen: {
        version: string | null
        etag: string | null
    }[] = []
    const http = await transportClient((_url, init) => {
        const headers = new Headers(init?.headers)
        const version = headers.get('Notion-Version')
        seen.push({ version, etag: headers.get('If-None-Match') })
        return Promise.resolve(new Response(JSON.stringify({ version }), { headers: { etag: version! } }))
    })
    const read = (version: string) =>
        run(http.request('https://api.notion.com/v1/pages/page', 'fixture', { headers: { 'Notion-Version': version } }))
    expect(await Promise.all([read('2022-06-28'), read('2025-09-03')])).toEqual([
        { version: '2022-06-28' },
        { version: '2025-09-03' }
    ])
    await read('2025-09-03')
    expect(seen).toEqual([
        { version: '2022-06-28', etag: null },
        { version: '2025-09-03', etag: null },
        { version: '2025-09-03', etag: '2025-09-03' }
    ])
})
it('coalesces simultaneous reads even when Effect yields during admission', async () => {
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    let requests = 0
    server.use(
        route.get('https://api.notion.com/v1/pages/same', async () => {
            requests++
            entered.resolve(undefined)
            await release.promise
            return Response.json({ id: 'same' })
        })
    )
    const client = await transportClient()
    const read = client
        .request('https://api.notion.com/v1/pages/same', 'fixture')
        .pipe(Effect.withMaxOpsBeforeYield(20))
    const outcome = run(Effect.all([read, read], { concurrency: 'unbounded' }))
    try {
        await entered.promise
        release.resolve(undefined)
        expect(await outcome).toEqual([{ id: 'same' }, { id: 'same' }])
        expect(requests).toBe(1)
    } finally {
        release.resolve(undefined)
        await outcome
    }
})
it.each(['shared', 'signal', 'write'] as const)(
    'owns %s requests until transport disposal and rejects reuse afterward',
    async (kind) => {
        const entered = deferred<Request>()
        const release = deferred<undefined>()
        let requests = 0
        server.use(
            route.all('https://api.github.com/owned', async ({ request }) => {
                requests++
                entered.resolve(request)
                await release.promise
                return Response.json({})
            })
        )
        const runtime = ManagedRuntime.make(HttpLive())
        const http = await runtime.runPromise(Http)
        const init =
            kind === 'signal' ? { signal: new AbortController().signal } : kind === 'write' ? { method: 'POST' } : {}
        const reader = Effect.runFork(http.request('https://api.github.com/owned', 'fixture', init))
        try {
            const request = await entered.promise
            await runtime.dispose()
            expect(request.signal.aborted).toBe(true)
            await expect(run(http.request('https://api.github.com/after', 'fixture', init))).rejects.toThrow('closed')
            expect(requests).toBe(1)
        } finally {
            release.resolve(undefined)
            await Effect.runPromise(Fiber.interrupt(reader))
            await runtime.dispose()
        }
    }
)
it('admits queued foreground work before retrying a failed background read', async () => {
    const order: string[] = []
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    server.use(
        route.get('https://api.github.com/background', async () => {
            order.push('background')
            if (order.length === 1) {
                entered.resolve(undefined)
                await release.promise
                return Response.json({}, { status: 503 })
            }
            return Response.json({})
        }),
        route.get('https://api.github.com/foreground', () => {
            order.push('foreground')
            return Response.json({})
        })
    )
    const client = await transportClient()
    const background = run(
        client.request('https://api.github.com/background', 'fixture', {}, 'json', { background: true })
    )
    try {
        await entered.promise
        const foreground = Effect.runFork(client.request('https://api.github.com/foreground', 'fixture'), {
            immediate: true
        })
        release.resolve(undefined)
        await Promise.all([background, run(Fiber.join(foreground))])
        expect(order).toEqual(['background', 'foreground', 'background'])
    } finally {
        release.resolve(undefined)
        await background
    }
})
it('keeps transport children interruptible when the caller is masked', async () => {
    let release!: () => void
    let signal: AbortSignal | undefined
    const runtime = ManagedRuntime.make(
        HttpLive((_url, init) => {
            signal = init?.signal ?? undefined
            return new Promise<Response>((resolve) => {
                release = () => resolve(new Response('{}'))
            })
        })
    )
    const http = await runtime.runPromise(Http)
    const reader = Effect.runFork(Effect.uninterruptible(http.request('https://api.github.com/masked', 'fixture')))
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
        await vi.waitFor(() => expect(signal).toBeDefined())
        await Promise.race([
            runtime.dispose(),
            new Promise((_, reject) => {
                deadline = setTimeout(() => reject(new Error('Masked transport retained its scope')), 1000)
            })
        ])
        expect(signal?.aborted).toBe(true)
    } finally {
        if (deadline) clearTimeout(deadline)
        release()
        await runtime.dispose()
        await Effect.runPromise(Fiber.await(reader))
    }
})
import { Cause } from 'effect'
import { DurabilityError } from '../src/main/durability-error'
it('reports pause persistence failure through typed recovery and closes the unread response', async () => {
    const cause = new Error('Pause checkpoint disk full')
    let cancelled = false
    const response = new Response(
        new ReadableStream({
            cancel: () => {
                cancelled = true
            }
        }),
        {
            status: 429,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 60) }
        }
    )
    const http = await transportClient(() => Promise.resolve(response), {
        pauses: () => ({}),
        changed: () => {
            throw cause
        }
    })
    const result = await Effect.runPromiseExit(http.request('https://api.github.com/limited', 'fixture'))
    if (result._tag !== 'Failure') throw new Error('Expected pause persistence failure')
    expect([...Cause.failures(result.cause)][0]).toBeInstanceOf(DurabilityError)
    expect([...Cause.defects(result.cause)]).toEqual([])
    expect(cancelled).toBe(true)
    expect(response.body?.locked).toBe(false)
})

it('retains the account-wide background allowance across rotation and transport restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1800000000000)
    const pauses: Record<string, number> = {}
    const store = {
        pauses: () => pauses,
        changed: (key: string, until: number) => {
            pauses[key] = until
        }
    }
    let requests = 0
    server.use(
        route.get('https://api.github.com/*', () => {
            requests++
            return Response.json({})
        })
    )
    try {
        const first = await transportClient(undefined, store)
        const results = await Promise.allSettled(
            Array.from({ length: 30 }, (_, i) =>
                run(
                    first.request(`https://api.github.com/burst/${i}`, 'old-token', {}, 'json', {
                        background: true,
                        accountId: 'account'
                    })
                )
            )
        )
        expect(requests).toBe(25)
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(5)
        const reopened = await transportClient(undefined, store)
        await expect(
            run(
                reopened.request('https://api.github.com/rotated', 'new-token', {}, 'json', {
                    background: true,
                    accountId: 'account'
                })
            )
        ).rejects.toMatchObject({ status: 429 })
        expect(requests).toBe(25)
        await run(
            reopened.request('https://api.github.com/foreground', 'new-token', {}, 'json', { accountId: 'account' })
        )
        expect(requests).toBe(26)
        vi.setSystemTime(1800000001000)
        await run(
            reopened.request('https://api.github.com/refilled', 'new-token', {}, 'json', {
                background: true,
                accountId: 'account'
            })
        )
        expect(requests).toBe(27)
    } finally {
        vi.useRealTimers()
    }
})

it('counts background retry attempts inside one scoped acquisition turn', async () => {
    let requests = 0
    server.use(
        route.get('https://api.github.com/*', ({ request }) => {
            requests++
            return Response.json({}, { status: request.url.endsWith('/retry') ? 503 : 200 })
        })
    )
    const http = await transportClient()
    const outcomes = await run(
        http.withBackgroundTurn(
            Effect.gen(function* () {
                yield* Effect.either(
                    http.request('https://api.github.com/retry', 'fixture', {}, 'json', {
                        background: true,
                        accountId: 'retry'
                    })
                )
                return yield* Effect.forEach(
                    Array.from({ length: 30 }, (_, i) => i),
                    (i) =>
                        Effect.either(
                            http.request(`https://api.github.com/item/${i}`, 'fixture', {}, 'json', {
                                background: i % 2 === 0,
                                accountId: `account-${i}`
                            })
                        ),
                    { concurrency: 4 }
                )
            })
        )
    )
    expect(requests).toBe(25)
    expect(outcomes.filter((result) => result._tag === 'Right')).toHaveLength(22)
    expect(outcomes.filter((result) => result._tag === 'Left')).toHaveLength(8)
    await run(
        http.request('https://api.github.com/outside-turn', 'fixture', {}, 'json', {
            background: true,
            accountId: 'outside'
        })
    )
    expect(requests).toBe(26)
})
