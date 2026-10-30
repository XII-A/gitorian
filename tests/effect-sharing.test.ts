import { journalState } from './database-fixtures'
import { GitHubFailure } from '../src/main/github'
import { Effect, Exit, Fiber, Scope } from 'effect'
import { expect, it, vi } from 'vitest'
import { journal, patch, workspace } from './fixtures'
import { run } from './effect-fixtures'
import type { Repository } from '../src/shared/model'
it.each(['details', 'refresh', 'reconcile'] as const)(
    'keeps %s work alive when another coalesced caller is interrupted',
    async (kind) => {
        const app = await journal()
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        let entered = false
        const wait = Effect.sync(() => {
            entered = true
        }).pipe(Effect.zipRight(Effect.promise(() => gate)))
        const repository: Repository = {
            id: 'repo',
            name: 'Repo',
            path: '',
            remote: 'https://github.com/example/project',
            base: 'main',
            trackingStart: '2026-10-05',
            emails: ['me@example.com'],
            available: true,
            removed: false,
            branchBases: {},
            branches: []
        }
        for (const fixtureRepository of [repository]) await app.store.saveRepository(fixtureRepository)
        app.remote.github = true
        let operation: Effect.Effect<unknown, Error>
        if (kind === 'details') {
            await run(app.service.refresh({ source: 'remote' }))
            const activity = (await journalState(app.store)).activities.find((item) => item.kind === 'change-request')!
            vi.spyOn(app.github, 'snapshot').mockImplementation(() =>
                wait.pipe(
                    Effect.as({ diff: patch, fingerprint: 'fixture', base: 'base', head: activity.head ?? 'head' })
                )
            )
            operation = app.service.handle({ type: 'details', activityId: activity.id })
        } else if (kind === 'refresh') {
            vi.spyOn(app.github, 'activities').mockImplementation((_repository, _login, _tracked, scan) =>
                wait.pipe(Effect.zipRight(scan?.checkpoint?.(1, true) ?? Effect.void), Effect.as([])).pipe(
                    Effect.mapError(
                        (error: unknown) =>
                            new GitHubFailure(error instanceof Error ? error.message : String(error), {
                                cause: error
                            })
                    )
                )
            )
            operation = app.service.refresh({ source: 'remote' })
        } else {
            await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
            const draft = (await journalState(app.store)).drafts[0]
            app.remote.loseCreateResponse = true
            await expect(run(app.service.handle({ type: 'publish', draftId: draft.id }))).rejects.toThrow()
            const save = (await journalState(app.store)).saves[0]
            const fetcher = app.remote.fetch
            vi.spyOn(app.remote, 'fetch').mockImplementationOnce(async (...args) => {
                entered = true
                await gate
                return fetcher(...args)
            })
            operation = app.service.handle({ type: 'reconcile', saveId: save.id })
        }
        const first = Effect.runFork(operation)
        let second: Fiber.RuntimeFiber<unknown, Error> | undefined
        try {
            await vi.waitFor(() => expect(entered).toBe(true))
            second = Effect.runFork(operation)
            await new Promise((resolve) => setTimeout(resolve, 0))
            await Effect.runPromise(Fiber.interrupt(first))
            release()
            expect(Exit.isSuccess(await Effect.runPromise(Fiber.await(second)))).toBe(true)
        } finally {
            release()
            await Effect.runPromise(Fiber.interrupt(first))
            if (second) await Effect.runPromise(Fiber.interrupt(second))
            await app.close()
        }
    }
)
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
    const app = await journal()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    try {
        app.remote.github = true
        for (const fixtureRepository of [
            {
                id: 'repo',
                name: 'Repo',
                path: '',
                remote: 'https://github.com/example/project',
                base: 'main',
                trackingStart: '2026-10-05',
                emails: ['me@example.com'],
                available: true,
                removed: false,
                branchBases: {},
                branches: []
            }
        ])
            await app.store.saveRepository(fixtureRepository)
        vi.spyOn(app.github, 'activities').mockImplementation(() =>
            Effect.promise(() => gate)
                .pipe(Effect.as([]))
                .pipe(
                    Effect.mapError(
                        (error: unknown) =>
                            new GitHubFailure(error instanceof Error ? error.message : String(error), { cause: error })
                    )
                )
        )
        await run(app.service.startRefresh({ source: 'remote' }))
        expect((await run(app.service.reply())).state.acquisition?.['remote:repo'].status).toBe('running')
    } finally {
        release()
        await app.close()
    }
})
it('releases announced source admission when interrupted before execution starts', async () => {
    const app = await journal()
    const controller = new AbortController()
    try {
        app.remote.github = true
        for (const fixtureRepository of [
            {
                id: 'repo',
                name: 'Repo',
                path: '',
                remote: 'https://github.com/example/project',
                base: 'main',
                trackingStart: '2026-10-05',
                emails: ['me@example.com'],
                available: true,
                removed: false,
                branchBases: {},
                branches: []
            }
        ])
            await app.store.saveRepository(fixtureRepository)
        const provider = vi
            .spyOn(app.github, 'activities')
            .mockImplementation(() =>
                Effect.never.pipe(
                    Effect.mapError(
                        (error: unknown) =>
                            new GitHubFailure(error instanceof Error ? error.message : String(error), { cause: error })
                    )
                )
            )
        const checkpoint = app.store.saveCheckpoint.bind(app.store)
        vi.spyOn(app.store, 'saveCheckpoint').mockImplementation(async (...args) => {
            if (args[1].status === 'running') controller.abort()
            return checkpoint(...args)
        })
        const exit = await Effect.runPromiseExit(
            app.service.refresh({ source: 'remote' }).pipe(Effect.withMaxOpsBeforeYield(64)),
            { signal: controller.signal }
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(provider).not.toHaveBeenCalled()
        expect((await journalState(app.store)).acquisition?.['remote:repo']?.status).toBe('idle')
    } finally {
        await app.close()
    }
})
