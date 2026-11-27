import { Deferred, Effect, Exit, Fiber, Scope } from 'effect'
import { expect, it } from 'vitest'
import { makeSharedRequests } from '../src/main/shared-requests'
import { run } from './effect-fixtures'

it('retains preparation ownership until scope disposal can release the completed acquisition', async () => {
    const scope = await run(Scope.make())
    const shared = await run(
        Scope.extend(
            makeSharedRequests<string, undefined, Error>(() => new Error('Closed')),
            scope
        )
    )
    const entered = await run(Deferred.make<undefined>())
    const proceed = await run(Deferred.make<undefined>())
    let active = false
    const prepare = Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
            active = false
        })
    ).pipe(
        Effect.zipRight(Deferred.succeed(entered, undefined)),
        Effect.zipRight(Deferred.await(proceed)),
        Effect.map(() => {
            active = true
            return Effect.never
        })
    )
    const caller = Effect.runFork(shared('source', prepare))
    await run(Deferred.await(entered))
    const closing = Effect.runFork(Scope.close(scope, Exit.void), { immediate: true })
    try {
        await run(Deferred.succeed(proceed, undefined))
        await run(Fiber.join(closing))
        expect(Exit.isFailure(await run(Fiber.await(caller)))).toBe(true)
        expect(active).toBe(false)
    } finally {
        await run(Deferred.succeed(proceed, undefined))
        await run(Fiber.interrupt(caller))
        await run(Fiber.join(closing))
    }
})
