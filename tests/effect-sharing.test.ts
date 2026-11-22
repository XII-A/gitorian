import { deferred } from './deferred'
import { journalState } from './database-fixtures'
import { Deferred, Effect, Exit, Fiber, Scope } from 'effect'
import { expect, it } from 'vitest'
import { journal, workspace } from './fixtures'
import { run } from './effect-fixtures'
import { makeSharedRequests } from '../src/main/shared-requests'

it('returns the same completed work when one of two registered callers is interrupted', async () => {
    const scope = await run(Scope.make())
    try {
        const share = await run(
            Scope.extend(
                makeSharedRequests<string, string, Error>(() => new Error('Closed')),
                scope
            )
        )
        const firstReady = await run(Deferred.make<undefined>())
        const secondReady = await run(Deferred.make<undefined>())
        const completed = await run(Deferred.make<string>())
        const prepare = Effect.succeed(Deferred.await(completed))
        const first = Effect.runFork(share('source', prepare, Deferred.succeed(firstReady, undefined)))
        await run(Deferred.await(firstReady))
        const second = Effect.runFork(
            share(
                'source',
                Effect.fail(new Error('A second caller must reuse the first operation')),
                Deferred.succeed(secondReady, undefined)
            )
        )
        await run(Deferred.await(secondReady))
        await run(Fiber.interrupt(first))
        await run(Deferred.succeed(completed, 'result'))
        expect(await run(Fiber.join(second))).toBe('result')
    } finally {
        await run(Scope.close(scope, Exit.void))
    }
})
it.each(['refresh', 'import'] as const)(
    'keeps %s suspended until every independent scope releases ownership',
    async (kind) => {
        const app = kind === 'import' ? await workspace() : await journal()
        const a = await Effect.runPromise(Scope.make())
        const b = await Effect.runPromise(Scope.make())
        try {
            const scan = kind === 'import' ? await run(app.service.scanRepositories(app.directory)) : undefined
            // Submit discovery's canonical paths, as the UI does (TEMP may use a Windows alias).
            const paths = scan?.repositoryScan?.repositories.map((repository) => repository.path) ?? []
            if (kind === 'import') expect(paths).toHaveLength(1)
            await run(Scope.extend(app.service.suspend, a))
            await run(Scope.extend(app.service.suspend, b))
            await run(Scope.close(a, Exit.void))
            if (kind === 'refresh') {
                await run(app.service.refresh())
                expect((await journalState(app.store)).lastRefreshAttempt).toBeUndefined()
            } else {
                await expect(run(app.service.importRepositories(scan!.repositoryScan!.id, paths))).rejects.toThrow(
                    'suspended'
                )
            }
            await run(Scope.close(b, Exit.void))
            if (kind === 'refresh') {
                await run(app.service.refresh())
                expect((await journalState(app.store)).lastRefreshAttempt).toBeDefined()
            } else {
                await run(app.service.importRepositories(scan!.repositoryScan!.id, paths))
                expect((await journalState(app.store)).repositoryImport?.status).toBe('done')
            }
        } finally {
            await run(Scope.close(a, Exit.void))
            await run(Scope.close(b, Exit.void))
            await app.close()
        }
    }
)
it('acknowledges background refresh only after source admission is visible', async () => {
    const app = await workspace()
    const entered = deferred<undefined>()
    const gate = deferred<undefined>()
    try {
        app.remote.github = true
        app.remote.beforeRequest = (url) => {
            if (!url.includes('/pulls?')) return Promise.resolve()
            entered.resolve(undefined)
            return gate.promise
        }
        await run(app.service.startRefresh({ source: 'remote' }))
        const key = 'remote:' + app.repository.id
        expect((await run(app.service.reply())).state.acquisition?.[key].status).toBe('running')
        await entered.promise
    } finally {
        gate.resolve(undefined)
        await app.close()
    }
})
