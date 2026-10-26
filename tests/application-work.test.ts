import { Effect, ManagedRuntime } from 'effect'
import { expect, it, vi } from 'vitest'
import { ApplicationWork, ApplicationWorkLive } from '../src/main/application-work'

async function application() {
    const runtime = ManagedRuntime.make(ApplicationWorkLive)
    const work = await runtime.runPromise(ApplicationWork)
    return { work, run: runtime.runPromise.bind(runtime), close: () => runtime.dispose() }
}

it('constructs lazy operations and isolates admission between application lifetimes', async () => {
    const first = await application()
    const second = await application()
    let calls = 0
    const operation = first.work.accept(Effect.sync(() => ++calls))
    expect(calls).toBe(0)
    await first.run(first.work.shutdown(Effect.void))
    await expect(first.run(operation)).rejects.toThrow('closed')
    expect(await second.run(second.work.accept(Effect.sync(() => ++calls)))).toBe(1)
    await Promise.all([first.close(), second.close()])
})

it('observes detached failures while preserving rejection for awaiting callers', async () => {
    const app = await application()
    await app.run(app.work.fork(Effect.fail(new Error('detached failure'))))
    await expect(app.run(app.work.accept(Effect.fail(new Error('awaited failure'))))).rejects.toThrow('awaited failure')
    await app.run(app.work.shutdown(Effect.void))
    await app.close()
})

it('drains accepted work and its follow-up work even when another task fails', async () => {
    const app = await application()
    const events: string[] = []
    let release!: () => void
    const pending = app.run(
        app.work.accept(
            Effect.gen(function* () {
                yield* Effect.promise(
                    () =>
                        new Promise<void>((resolve) => {
                            release = resolve
                        })
                )
                yield* app.work.fork(
                    Effect.sync(() => {
                        events.push('follow-up')
                    })
                )
                events.push('first')
            })
        )
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const failed = app.run(app.work.accept(Effect.fail(new Error('source failed')))).catch(() => events.push('failed'))
    const closing = app.run(
        app.work.shutdown(
            Effect.sync(() => {
                events.push('saved')
            })
        )
    )
    release()
    await Promise.all([pending, failed, closing])
    expect(events).toContain('follow-up')
    expect(events.at(-1)).toBe('saved')
    await expect(app.run(app.work.accept(Effect.void))).rejects.toThrow('closed')
    await app.close()
})

it('lets a restore command drain prior work without waiting for itself', async () => {
    const app = await application()
    const events: string[] = []
    const prior = app.run(
        app.work.accept(
            Effect.gen(function* () {
                yield* Effect.yieldNow()
                yield* app.work.fork(
                    Effect.gen(function* () {
                        yield* Effect.yieldNow()
                        events.push('follow-up')
                    })
                )
                events.push('prior')
            })
        )
    )
    await app.run(
        app.work.accept(
            Effect.gen(function* () {
                yield* app.work.drain
                events.push('restore')
            })
        )
    )
    await prior
    expect(events).toEqual(['prior', 'follow-up', 'restore'])
    await app.run(app.work.shutdown(Effect.void))
    await app.close()
})

it('stops periodic producers after successful shutdown', async () => {
    const app = await application()
    let ticks = 0
    await app.run(
        app.work.repeat(
            5,
            Effect.sync(() => {
                ticks++
            })
        )
    )
    await vi.waitFor(() => expect(ticks).toBeGreaterThan(0))
    await app.run(app.work.shutdown(Effect.void))
    const settled = ticks
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(ticks).toBe(settled)
    await app.close()
})

it('keeps admission usable when durable shutdown fails so saving can be retried', async () => {
    const app = await application()
    await expect(app.run(app.work.shutdown(Effect.fail(new Error('disk full'))))).rejects.toThrow('disk full')
    expect(await app.run(app.work.accept(Effect.succeed('retry')))).toBe('retry')
    await app.run(app.work.shutdown(Effect.void))
    await app.close()
})

it('never reports a detached operation accepted when shutdown rejected its admission', async () => {
    const app = await application()
    let ran = 0
    const results = await Promise.allSettled([
        app.run(
            app.work.fork(
                Effect.sync(() => {
                    ran++
                })
            )
        ),
        app.run(app.work.shutdown(Effect.void))
    ])
    if (results[0].status === 'fulfilled') expect(ran).toBe(1)
    else expect(ran).toBe(0)
    await app.close()
})

it('settles active periodic work before saving and rejects new producers after shutdown', async () => {
    const app = await application()
    const events: string[] = []
    let release!: () => void
    await app.run(
        app.work.repeat(
            1,
            Effect.promise(
                () =>
                    new Promise<void>((resolve) => {
                        events.push('tick')
                        release = () => {
                            events.push('settled')
                            resolve()
                        }
                    })
            )
        )
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const closing = app.run(
        app.work.shutdown(
            Effect.sync(() => {
                events.push('saved')
            })
        )
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toEqual(['tick'])
    release()
    await closing
    expect(events).toEqual(['tick', 'settled', 'saved'])
    await expect(app.run(app.work.repeat(1, Effect.void))).rejects.toThrow('closed')
    await app.close()
})

it('serializes shutdown attempts and cannot reopen after a successful close', async () => {
    const app = await application()
    let rejectSave!: (error: Error) => void
    const first = app
        .run(
            app.work.shutdown(
                Effect.tryPromise({
                    try: () =>
                        new Promise<void>((_resolve, reject) => {
                            rejectSave = reject
                        }),
                    catch: (error) => error
                })
            )
        )
        .catch(() => undefined)
    await vi.waitFor(() => expect(rejectSave).toBeTypeOf('function'))
    let saved = false
    const second = app.run(
        app.work.shutdown(
            Effect.sync(() => {
                saved = true
            })
        )
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(saved).toBe(false)
    rejectSave(new Error('disk full'))
    await Promise.all([first, second])
    await expect(app.run(app.work.accept(Effect.void))).rejects.toThrow('closed')
    await app.close()
})

it('excludes the complete admission ancestry when nested work drains', async () => {
    const app = await application()
    await app.run(app.work.accept(app.work.accept(app.work.drain)))
    await app.close()
})

it('rejects a competing maintenance drain instead of waiting on the other drainer', async () => {
    const app = await application()
    let release!: () => void
    const held = app.run(
        app.work.accept(
            Effect.promise(
                () =>
                    new Promise<void>((resolve) => {
                        release = resolve
                    })
            )
        )
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const first = app.run(app.work.accept(app.work.drain))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(app.run(app.work.accept(app.work.drain))).rejects.toThrow('already draining')
    release()
    await Promise.all([held, first])
    await app.close()
})

it('restores admission and scheduling after interruption during saving', async () => {
    const app = await application()
    let ticks = 0
    await app.run(
        app.work.repeat(
            1,
            Effect.sync(() => {
                ticks++
            })
        )
    )
    await vi.waitFor(() => expect(ticks).toBeGreaterThan(0))
    const controller = new AbortController()
    let saving = false
    const closing = app
        .run(
            app.work.shutdown(
                Effect.sync(() => {
                    saving = true
                }).pipe(Effect.zipRight(Effect.never))
            ),
            { signal: controller.signal }
        )
        .catch(() => undefined)
    await vi.waitFor(() => expect(saving).toBe(true))
    const before = ticks
    controller.abort()
    await closing
    expect(await app.run(app.work.accept(Effect.succeed('open')))).toBe('open')
    await vi.waitFor(() => expect(ticks).toBeGreaterThan(before))
    await app.close()
})
