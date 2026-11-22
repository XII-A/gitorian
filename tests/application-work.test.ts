import { deferred } from './deferred'
import { Effect, Fiber, FiberId, ManagedRuntime, RuntimeFlags, RuntimeFlagsPatch, Supervisor } from 'effect'
import { expect, it, vi } from 'vitest'
import { ApplicationWork, ApplicationWorkLive } from '../src/main/application-work'

async function application() {
    const runtime = ManagedRuntime.make(ApplicationWorkLive)
    const work = await runtime.runPromise(ApplicationWork)
    return {
        work,
        run: runtime.runPromise.bind(runtime),
        fork: runtime.runFork.bind(runtime),
        close: () => runtime.dispose()
    }
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

it('lets a nested restore drain prior work without waiting for either caller', async () => {
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
            app.work.accept(
                Effect.gen(function* () {
                    yield* app.work.drain
                    events.push('restore')
                })
            )
        )
    )
    await prior
    expect(events).toEqual(['prior', 'follow-up', 'restore'])
    await app.run(app.work.shutdown(Effect.void))
    await app.close()
})

it('keeps admission usable when durable shutdown fails so saving can be retried', async () => {
    const app = await application()
    await expect(app.run(app.work.shutdown(Effect.fail(new Error('disk full'))))).rejects.toThrow('disk full')
    const drained = await app.run(app.work.accept(Effect.succeed('follow-up work')))
    expect(drained).toBe('follow-up work')
    let persisted = false
    await app.run(
        app.work.shutdown(
            Effect.sync(() => {
                persisted = true
            })
        )
    )
    expect(persisted).toBe(true)
    await expect(app.run(app.work.accept(Effect.void))).rejects.toThrow('closed')
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
    release()
    await closing
    expect(events).toEqual(['tick', 'settled', 'saved'])
    await expect(app.run(app.work.repeat(1, Effect.void))).rejects.toThrow('closed')
    await app.close()
})

it('serializes a pending shutdown and commits the next attempt after a failure', async () => {
    const app = await application()
    const saving = deferred<undefined>()
    const failedWrite = deferred<undefined>()
    const events: string[] = []
    const first = app.run(
        app.work.shutdown(
            Effect.tryPromise({
                try: async () => {
                    events.push('first began')
                    saving.resolve(undefined)
                    await failedWrite.promise
                    events.push('first failed')
                    throw new Error('disk full')
                },
                catch: (error) => error
            })
        )
    )
    const rejected = expect(first).rejects.toThrow('disk full')
    try {
        await saving.promise
        const second = app.fork(
            app.work.shutdown(
                Effect.sync(() => {
                    events.push('second committed')
                })
            ),
            { immediate: true }
        )
        failedWrite.resolve(undefined)
        await Promise.all([rejected, app.run(Fiber.join(second))])
        expect(events).toEqual(['first began', 'first failed', 'second committed'])
        await expect(app.run(app.work.accept(Effect.void))).rejects.toThrow('closed')
    } finally {
        failedWrite.resolve(undefined)
        await app.close()
    }
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
    const first = app.fork(app.work.accept(app.work.drain), { immediate: true })
    try {
        await expect(app.run(app.work.accept(app.work.drain))).rejects.toThrow('already draining')
    } finally {
        release()
        await Promise.all([held, app.run(Fiber.join(first))])
    }
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

it('seals admission atomically against registration under scheduler pressure', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
        const app = await application()
        const events: string[] = []
        const admission = Effect.gen(function* () {
            for (let step = 0; step < 7; step++) yield* Effect.sync(() => undefined)
            yield* app.work.accept(
                Effect.gen(function* () {
                    events.push('begin')
                    yield* Effect.sleep(1)
                    events.push('end')
                })
            )
        }).pipe(Effect.exit)
        await app.run(
            Effect.all(
                [
                    admission,
                    app.work.shutdown(
                        Effect.sync(() => {
                            events.push('save')
                        })
                    )
                ],
                { concurrency: 'unbounded', discard: true }
            ).pipe(Effect.withMaxOpsBeforeYield(16))
        )
        expect(events).toEqual(events.includes('begin') ? ['begin', 'end', 'save'] : ['save'])
        await app.close()
    }
})
it('keeps disposed ownership permanently closed when an in-flight shutdown fails', async () => {
    const app = await application()
    let release!: () => void
    const pending = app.run(
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
    const closing = app.fork(app.work.shutdown(Effect.fail(new Error('disk full'))), { immediate: true })
    await app.close()
    release()
    await Promise.all([pending, Effect.runPromise(closing.await)])
    await expect(Effect.runPromise(app.work.accept(Effect.void))).rejects.toThrow('closed')
})

it('does not leave a periodic producer registered after shutdown wins admission', async () => {
    const app = await application()
    const supervisor = await Effect.runPromise(Supervisor.track)
    await app.run(
        Effect.all(
            [
                Effect.gen(function* () {
                    for (let step = 0; step < 23; step++) yield* Effect.sync(() => undefined)
                    yield* Effect.exit(app.work.repeat(100000, Effect.void))
                }),
                app.work.shutdown(Effect.void)
            ],
            { concurrency: 'unbounded' }
        ).pipe(Effect.supervised(supervisor), Effect.withMaxOpsBeforeYield(48))
    )
    expect((await Effect.runPromise(supervisor.value)).length).toBe(0)
    await app.close()
})

it('finishes terminal producer cleanup when interrupted immediately after saving', async () => {
    const app = await application()
    const tracked = Supervisor.unsafeTrack()
    await app.run(app.work.repeat(100000, Effect.void).pipe(Effect.supervised(tracked)))
    let saved = false
    // Interrupt at the next Effect instruction after durable saving, rather than
    // relying on timer placement to hit the terminal cleanup window.
    class InterruptAfterSave extends Supervisor.AbstractSupervisor<void> {
        value = Effect.void
        onEffect(fiber: Fiber.RuntimeFiber<unknown, unknown>) {
            if (saved) {
                saved = false
                fiber.unsafeInterruptAsFork(FiberId.none)
            }
        }
    }
    await app
        .run(
            app.work
                .shutdown(
                    Effect.sync(() => {
                        saved = true
                    })
                )
                .pipe(
                    Effect.supervised(new InterruptAfterSave()),
                    Effect.withRuntimeFlagsPatch(RuntimeFlagsPatch.enable(RuntimeFlags.OpSupervision))
                )
        )
        .catch(() => undefined)
    await expect(app.run(app.work.accept(Effect.void))).rejects.toThrow('closed')
    expect((await Effect.runPromise(tracked.value)).length).toBe(0)
    await app.close()
})
