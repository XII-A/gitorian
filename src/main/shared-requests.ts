import { Deferred, Effect, Exit, Fiber, Scope } from 'effect'

/** Layer-owned shared work. Preparation acquires scoped resources before execution can be interrupted. */
export function makeSharedRequests<K, A, E>(closedError: () => E) {
    return Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const registration = yield* Effect.makeSemaphore(1)
        const requests = new Map<
            K,
            { id: symbol; fiber: Fiber.RuntimeFiber<A, E>; scope: Scope.CloseableScope; users: number }
        >()
        const owners = new Set<Scope.CloseableScope>()
        const closeOwnership = (ownership: Scope.CloseableScope) =>
            Scope.close(ownership, Exit.void).pipe(
                Effect.ensuring(
                    Effect.sync(() => {
                        owners.delete(ownership)
                    })
                )
            )
        let closed = false
        yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
                // Disposal waits for masked preparation to finish before closing its resources.
                const accepted = yield* registration.withPermits(1)(
                    Effect.sync(() => {
                        closed = true
                        return { fibers: [...requests.values()].map((current) => current.fiber), scopes: [...owners] }
                    })
                )
                yield* Fiber.interruptAll(accepted.fibers)
                yield* Effect.forEach(accepted.scopes, closeOwnership, { discard: true })
            })
        )
        return <R>(
            key: K,
            prepare: Effect.Effect<Effect.Effect<A, E, R>, never, Scope.Scope>,
            ready: Effect.Effect<void> = Effect.void
        ): Effect.Effect<A, E, R> =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    const current = yield* registration.withPermits(1)(
                        Effect.gen(function* () {
                            if (closed) return yield* Effect.fail(closedError())
                            let current = requests.get(key)
                            if (!current) {
                                const ownership = yield* Scope.make()
                                owners.add(ownership)
                                const operation = yield* Scope.extend(prepare, ownership).pipe(
                                    Effect.onExit((exit) =>
                                        Exit.isFailure(exit) ? closeOwnership(ownership) : Effect.void
                                    )
                                )
                                const id = Symbol()
                                const started = yield* Deferred.make<undefined>()
                                const fiber = yield* Effect.forkIn(
                                    Effect.interruptible(
                                        Deferred.await(started).pipe(
                                            Effect.zipRight(operation),
                                            Effect.ensuring(
                                                Effect.sync(() => {
                                                    if (requests.get(key)?.id === id) requests.delete(key)
                                                }).pipe(Effect.zipRight(closeOwnership(ownership)))
                                            )
                                        )
                                    ),
                                    scope
                                )
                                current = { id, fiber, scope: ownership, users: 0 }
                                requests.set(key, current)
                                yield* Deferred.succeed(started, undefined)
                            }
                            current.users++
                            return current
                        })
                    )
                    yield* ready
                    return yield* restore(Fiber.join(current.fiber)).pipe(
                        Effect.ensuring(
                            Effect.suspend(() => {
                                current.users--
                                if (current.users !== 0) return Effect.void
                                if (requests.get(key) === current) requests.delete(key)
                                return Fiber.interrupt(current.fiber).pipe(
                                    Effect.zipRight(closeOwnership(current.scope))
                                )
                            })
                        )
                    )
                })
            )
    })
}
