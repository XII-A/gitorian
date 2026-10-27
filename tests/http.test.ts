import { Effect, Fiber, ManagedRuntime } from 'effect'
import { Http, HttpLive } from '../src/main/http'
import { expect, it, vi } from 'vitest'
import { transportClient, run } from './transport-fixtures'
it('releases admission after abort even when stream cancellation never completes', async () => {
    let releaseCancellation!: () => void
    const cancellation = new Promise<void>((resolve) => {
        releaseCancellation = resolve
    })
    const stream = new ReadableStream<Uint8Array>({ cancel: () => cancellation })
    const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(stream))
        .mockResolvedValueOnce(new Response('{"ok":true}'))
    const http = await transportClient(fetcher)
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
    const read = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status: 503 })))
    await expect(run((await transportClient(read)).request('https://api.github.com/user', 'fixture'))).rejects.toThrow(
        '503'
    )
    expect(read).toHaveBeenCalledTimes(3)
    const write = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status: 503 })))
    await expect(
        run((await transportClient(write)).request('https://api.notion.com/v1/pages', 'fixture', { method: 'POST' }))
    ).rejects.toThrow('503')
    expect(write).toHaveBeenCalledTimes(1)
})
it('cancels retry waits without issuing another request', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status: 503 })))
    const pending = run(
        (await transportClient(fetcher)).request('https://api.github.com/user', 'fixture', {
            signal: controller.signal
        })
    )
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controller.abort(new Error('Cancelled transport'))
    await expect(pending).rejects.toThrow('Cancelled transport')
    expect(fetcher).toHaveBeenCalledTimes(1)
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
    const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(stream))
        .mockResolvedValueOnce(new Response('{"ok":true}'))
    const http = await transportClient(fetcher)
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
    let release!: () => void
    const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
            () =>
                new Promise<Response>((resolve) => {
                    release = () =>
                        resolve(
                            new Response('{}', {
                                headers: {
                                    'x-ratelimit-remaining': '499',
                                    'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 60)
                                }
                            })
                        )
                })
        )
        .mockResolvedValue(new Response('{"foreground":true}'))
    const http = await transportClient(fetcher)
    const held = run(http.request('https://api.github.com/held', 'fixture'))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const background = run(
        http.request('https://api.github.com/shared', 'fixture', {}, 'json', { background: true })
    ).catch((error: unknown) => error)
    const foreground = run(http.request('https://api.github.com/shared', 'fixture'))
    release()
    await held
    expect(await foreground).toEqual({ foreground: true })
    expect(await background).toMatchObject({ status: 429 })
    expect(fetcher).toHaveBeenCalledTimes(2)
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
    const fetcher = vi.fn<typeof fetch>(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return new Response('{}')
    })
    const http = await transportClient(fetcher)
    await Promise.all(
        Array.from({ length: 2 }, () =>
            run(http.request('https://api.notion.com/v1/pages/same', 'fixture').pipe(Effect.withMaxOpsBeforeYield(20)))
        )
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['shared', 'signal', 'write'] as const)(
    'owns %s requests until transport disposal and rejects reuse afterward',
    async (kind) => {
        let signal: AbortSignal | undefined
        const fetcher = vi.fn<typeof fetch>((_url, init) => {
            signal = init?.signal ?? undefined
            return new Promise<Response>(() => undefined)
        })
        const runtime = ManagedRuntime.make(HttpLive(fetcher))
        const http = await runtime.runPromise(Http)
        const init =
            kind === 'signal' ? { signal: new AbortController().signal } : kind === 'write' ? { method: 'POST' } : {}
        const reader = Effect.runFork(http.request('https://api.github.com/owned', 'fixture', init))
        try {
            await vi.waitFor(() => expect(signal).toBeDefined())
            await runtime.dispose()
            expect(signal?.aborted).toBe(true)
            await expect(run(http.request('https://api.github.com/after', 'fixture', init))).rejects.toThrow('closed')
            expect(fetcher).toHaveBeenCalledTimes(1)
        } finally {
            await Effect.runPromise(Fiber.interrupt(reader))
            await runtime.dispose()
        }
    }
)
it('admits queued foreground work before retrying a failed background read', async () => {
    const order: string[] = []
    let release!: () => void
    let backgroundAttempts = 0
    const http = await transportClient((url) => {
        const name = (url instanceof Request ? url.url : url.toString()).split('/').at(-1)!
        order.push(name)
        if (name === 'background' && ++backgroundAttempts === 1)
            return new Promise<Response>((resolve) => {
                release = () => resolve(new Response('{}', { status: 503 }))
            })
        return Promise.resolve(new Response('{}'))
    })
    const background = run(
        http.request('https://api.github.com/background', 'fixture', {}, 'json', { background: true })
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const foreground = run(http.request('https://api.github.com/foreground', 'fixture'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([background, foreground])
    expect(order).toEqual(['background', 'foreground', 'background'])
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
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    const http = await transportClient(fetcher, {
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
    expect(fetcher).toHaveBeenCalledTimes(1)
})
