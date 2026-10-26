import { Context, Data, Deferred, Effect, Exit, Fiber, FiberRef, Layer, Scope } from 'effect'

export class WorkClosed extends Data.TaggedError('WorkClosed') {
    readonly message = 'Journal work is closed'
}
export class WorkBusy extends Data.TaggedError('WorkBusy') {
    readonly message = 'Journal work is already draining'
}

/** Admission and durable draining; execution belongs to the application runtime. */
export interface ApplicationWork {
    readonly accept: <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | WorkClosed, R>
    readonly fork: <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.Effect<void, WorkClosed, R>
    readonly drain: Effect.Effect<void, WorkBusy>
    readonly repeat: <E, R>(
        milliseconds: number,
        tick: Effect.Effect<unknown, E, R>
    ) => Effect.Effect<void, WorkClosed, R>
    readonly shutdown: <E, R>(save: Effect.Effect<void, E, R>) => Effect.Effect<void, E | WorkBusy, R>
}

export const ApplicationWork = Context.GenericTag<ApplicationWork>('gitorian/ApplicationWork')

export const ApplicationWorkLive = Layer.scoped(
    ApplicationWork,
    Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const tasks = new Map<symbol, Deferred.Deferred<void>>()
        const ancestry = yield* FiberRef.make<readonly symbol[]>([])
        const shutdownLock = yield* Effect.makeSemaphore(1)
        const producers = new Set<Fiber.RuntimeFiber<unknown, unknown>>()
        let state: 'open' | 'saving' | 'closed' = 'open'
        let scheduling = true
        let draining = false
        yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
                state = 'closed'
                scheduling = false
            })
        )

        const accept = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    if (state !== 'open') return yield* new WorkClosed()
                    const parents = yield* FiberRef.get(ancestry)
                    const done = yield* Deferred.make<void>()
                    const id = Symbol()
                    tasks.set(id, done)
                    return yield* restore(operation).pipe(
                        Effect.locally(ancestry, [...parents, id]),
                        Effect.ensuring(
                            Effect.gen(function* () {
                                tasks.delete(id)
                                yield* Deferred.succeed(done, undefined)
                            })
                        )
                    )
                })
            )

        const drain = Effect.acquireUseRelease(
            Effect.suspend(() => {
                if (draining) return Effect.fail(new WorkBusy())
                draining = true
                return Effect.void
            }),
            () =>
                Effect.gen(function* () {
                    const parents = yield* FiberRef.get(ancestry)
                    for (;;) {
                        const pending = [...tasks].filter(([id]) => !parents.includes(id)).map(([, done]) => done)
                        if (!pending.length) return
                        yield* Effect.forEach(pending, Deferred.await, { concurrency: 'unbounded', discard: true })
                    }
                }),
            () =>
                Effect.sync(() => {
                    draining = false
                })
        )

        const fork = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    if (state !== 'open') return yield* new WorkClosed()
                    const started = yield* Deferred.make<void, WorkClosed>()
                    yield* Effect.forkIn(
                        accept(Deferred.succeed(started, undefined).pipe(Effect.zipRight(restore(operation)))).pipe(
                            Effect.onExit((exit) =>
                                Exit.isFailure(exit) ? Deferred.fail(started, new WorkClosed()) : Effect.void
                            ),
                            Effect.exit
                        ),
                        scope
                    )
                    // Acknowledgement means admission succeeded; rejection must reach the producer.
                    yield* Deferred.await(started)
                })
            )

        const repeat = <E, R>(milliseconds: number, tick: Effect.Effect<unknown, E, R>) =>
            Effect.gen(function* () {
                if (state !== 'open') return yield* new WorkClosed()
                const fiber = yield* Effect.forkIn(
                    Effect.forever(
                        Effect.sleep(milliseconds).pipe(
                            Effect.zipRight(
                                Effect.suspend(() => (scheduling ? Effect.exit(accept(tick)) : Effect.void))
                            )
                        )
                    ),
                    scope
                )
                producers.add(fiber)
            })

        const shutdown = <E, R>(save: Effect.Effect<void, E, R>) =>
            shutdownLock.withPermits(1)(
                Effect.suspend(() => {
                    if (state === 'closed') return Effect.void
                    return Effect.gen(function* () {
                        scheduling = false
                        yield* drain
                        state = 'saving'
                        yield* save
                        state = 'closed'
                        yield* Fiber.interruptAll(producers)
                        producers.clear()
                    }).pipe(
                        Effect.onExit((exit) =>
                            Effect.sync(() => {
                                if (Exit.isFailure(exit) && state !== 'closed') {
                                    state = 'open'
                                    scheduling = true
                                }
                            })
                        )
                    )
                })
            )

        return { accept, fork, drain, repeat, shutdown }
    })
)
