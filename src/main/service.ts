import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { randomUUID } from 'node:crypto'
import { basename, relative } from 'node:path'
import { Context, Effect, Layer, type Scope } from 'effect'
import { commits, inspectRepository, git } from './git'
import { JournalPublishing } from './journal-publishing'
import { ActivityAcquisition } from './activity-acquisition'
import { ActivityRecords } from './activity-records'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
import { discoverRepositories, repositoryPathKey } from './repository-discovery'
import { weekOf } from '../shared/model'
import type { Command, Reply, RepositoryImportProgress, Repository, Selection } from '../shared/model'
import type { JournalView } from './database/types'
import { ProviderAccounts } from './provider-accounts'
export interface JournalService {
    readonly reply: (extra?: Partial<Reply>, view?: JournalView) => Effect.Effect<Reply, JournalFailure>
    readonly suspend: Effect.Effect<void, never, Scope.Scope>
    readonly stopWork: (source: 'git' | 'remote' | 'repositories', repositoryId?: string) => Effect.Effect<void>
    readonly addRepository: (path: string) => Effect.Effect<void, JournalFailure>
    readonly scanRepositories: (
        folder: string,
        onProgress?: (progress: RepositoryImportProgress) => void
    ) => Effect.Effect<Reply, JournalFailure>
    readonly importRepositories: (
        scanId: string,
        paths: string[],
        onProgress?: (progress: RepositoryImportProgress) => void
    ) => Effect.Effect<Reply, JournalFailure>
    readonly startRefresh: ActivityAcquisition['startRefresh']
    readonly refresh: ActivityAcquisition['refresh']
    readonly backfill: ActivityAcquisition['backfill']
    readonly handle: (command: Command) => Effect.Effect<Reply, JournalFailure>
}
export const JournalService = Context.GenericTag<JournalService>('gitorian/Journal')
export const JournalLive = Layer.effect(JournalService, makeJournal())
function makeJournal() {
    return Effect.gen(function* () {
        const store = yield* JournalStore
        const accounts = yield* ProviderAccounts
        const acquisition = yield* ActivityAcquisition
        const publishing = yield* JournalPublishing
        const records = yield* ActivityRecords
        const connections = (yield* ConnectionState).snapshot
        const local = <A>(operation: () => Promise<A>) =>
            Effect.tryPromise({ try: operation, catch: (error) => toJournalFailure(error) })
        let importing = false
        let repositoryScan:
            | {
                  id: string
                  paths: string[]
                  unreadable: string[]
              }
            | undefined
        let importStopped = false
        const suspensions = new Set<symbol>()
        const importsSuspended = () => suspensions.size > 0
        const findRepository = (id: string) =>
            Effect.suspend(() => {
                const repository = store.config.repositories.find((item) => item.id === id)
                return repository
                    ? Effect.succeed(repository)
                    : Effect.fail(new JournalError('Repository is no longer available'))
            })
        const findActivity = (id: string) =>
            local(async () => {
                const activity = await store.activity(id)
                if (!activity) throw new JournalError('Work is no longer available')
                return activity
            })
        const suspend = acquisition.suspend.pipe(
            Effect.zipRight(
                Effect.acquireRelease(
                    Effect.sync(() => {
                        const owner = Symbol()
                        suspensions.add(owner)
                        return owner
                    }),
                    (owner) =>
                        Effect.sync(() => {
                            suspensions.delete(owner)
                        })
                )
            ),
            Effect.asVoid
        )
        const stopWork = (source: 'git' | 'remote' | 'repositories', repositoryId?: string) =>
            Effect.gen(function* () {
                if (source === 'repositories') importStopped = true
                else yield* acquisition.stop(source, repositoryId)
            })
        const reply = (extra: Partial<Reply> = {}, view?: JournalView) =>
            local(async (): Promise<Reply> => ({
                state: { ...(await store.readWorkspace(view)), accounts: accounts.accounts() },
                connections: connections(),
                ...extra
            }))
        const addRepository = (path: string): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const inspected = yield* Effect.tryPromise({
                    try: () => inspectRepository(path),
                    catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                })
                if (
                    store.config.repositories.some(
                        (repository) => repositoryPathKey(repository.path) === repositoryPathKey(inspected.path)
                    )
                )
                    return yield* Effect.fail(new JournalError('This repository is already tracked'))
                const repository: Repository = {
                    id: randomUUID(),
                    name: inspected.name,
                    path: inspected.path,
                    remote: inspected.selectedRemote,
                    base: inspected.base,
                    emails: inspected.email ? [inspected.email] : [],
                    trackingStart: weekOf(new Date(), store.config.settings),
                    available: true,
                    removed: false,
                    branchBases: {},
                    branches: inspected.branches,
                    remotes: inspected.remotes
                }
                yield* local(() => store.saveRepository(repository))
            })
        const scanRepositories = (
            folder: string,
            onProgress?: (progress: RepositoryImportProgress) => void
        ): Effect.Effect<Reply, Error> =>
            Effect.gen(function* () {
                onProgress?.({ stage: 'discovering', scanned: 0, found: 0 })
                const discovered = yield* Effect.tryPromise({
                    try: () =>
                        discoverRepositories(folder, (counts) => onProgress?.({ stage: 'discovering', ...counts })),
                    catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                })
                const id = randomUUID()
                repositoryScan = { id, ...discovered }
                return yield* reply({
                    repositoryScan: {
                        id,
                        folder,
                        unreadable: discovered.unreadable,
                        repositories: discovered.paths.map((path) => {
                            const tracked = store.config.repositories.find(
                                (item) => repositoryPathKey(item.path) === repositoryPathKey(path)
                            )
                            return {
                                path,
                                name: basename(path),
                                relativePath: relative(folder, path) || '.',
                                status: tracked
                                    ? tracked.removed || !tracked.available
                                        ? 'stopped'
                                        : 'tracked'
                                    : 'new'
                            }
                        })
                    }
                })
            })
        const importRepositories = (
            scanId: string,
            paths: string[],
            onProgress?: (progress: RepositoryImportProgress) => void
        ): Effect.Effect<Reply, Error> =>
            Effect.gen(function* () {
                if (importsSuspended())
                    return yield* Effect.fail(
                        new JournalError('Repository import is suspended while the journal is maintained.')
                    )
                if (importing) return yield* reply({ message: 'A repository import is already running.' })
                const scan = repositoryScan
                if (!scan || scan.id !== scanId)
                    return yield* Effect.fail(
                        new JournalError('This folder scan has expired. Choose the folder again.')
                    )
                const requested = new Set(paths.map(repositoryPathKey))
                if (
                    !requested.size ||
                    [...requested].some((path) => !scan.paths.some((item) => repositoryPathKey(item) === path))
                )
                    return yield* Effect.fail(new JournalError('Select repositories from the scanned folder.'))
                const discovered = {
                    paths: scan.paths.filter((path) => requested.has(repositoryPathKey(path))),
                    unreadable: scan.unreadable
                }
                repositoryScan = undefined
                importing = true
                importStopped = false
                const importId = randomUUID()
                yield* local(() =>
                    store.saveProgress({
                        repositoryImport: { id: importId, status: 'running', completed: 0, total: 0 }
                    })
                )
                return yield* Effect.gen(function* () {
                    let added = 0
                    let existing = 0
                    let restored = 0
                    const skippedItems = discovered.unreadable.map((path) => ({
                        path,
                        reason: 'Folder could not be read. Check its permissions.'
                    }))
                    let skipped = discovered.unreadable.length
                    let completed = 0
                    onProgress?.({ stage: 'processing', completed, total: discovered.paths.length })
                    yield* local(() =>
                        store.saveProgress({
                            repositoryImport: {
                                id: importId,
                                status: 'running',
                                completed,
                                total: discovered.paths.length
                            }
                        })
                    )
                    yield* Effect.forEach(
                        discovered.paths,
                        (path) =>
                            Effect.gen(function* () {
                                if (importStopped || importsSuspended()) return
                                const tracked = store.config.repositories.find(
                                    (item) => repositoryPathKey(item.path) === repositoryPathKey(path)
                                )
                                yield* Effect.gen(function* () {
                                    if (tracked) {
                                        if (tracked.removed || !tracked.available) {
                                            const inspected = yield* Effect.tryPromise({
                                                try: () => inspectRepository(path),
                                                catch: (error) =>
                                                    error instanceof Error ? error : new JournalError(String(error))
                                            })
                                            Object.assign(tracked, {
                                                path: inspected.path,
                                                available: true,
                                                removed: false,
                                                branches: inspected.branches,
                                                remotes: inspected.remotes
                                            })
                                            yield* local(() => store.updateRepositoryLocation(tracked))
                                            restored++
                                        } else existing++
                                    } else {
                                        yield* addRepository(path)
                                        added++
                                    }
                                }).pipe(
                                    Effect.catchAll((error) =>
                                        Effect.sync(() => {
                                            skippedItems.push({
                                                path,
                                                reason: error instanceof Error ? error.message : String(error)
                                            })
                                            skipped++
                                        })
                                    )
                                )
                                const finished = ++completed
                                // Publish before yielding so concurrent completions cannot skip a count.
                                onProgress?.({
                                    stage: 'processing',
                                    completed: finished,
                                    total: discovered.paths.length
                                })
                                yield* local(() =>
                                    store.saveProgress({
                                        repositoryImport: {
                                            id: importId,
                                            status: 'running',
                                            completed: finished,
                                            total: discovered.paths.length
                                        }
                                    })
                                )
                            }),
                        { concurrency: 2, discard: true }
                    )
                    const messages = [`Added ${added} ${added === 1 ? 'repository' : 'repositories'}.`]
                    if (!discovered.paths.length) messages[0] = 'No Git repositories found in this folder.'
                    if (restored) messages.push(`Resumed tracking ${restored}.`)
                    if (existing) messages.push(`${existing} already tracked.`)
                    if (skipped) messages.push(`${skipped} unreadable or invalid folders skipped.`)
                    if (importStopped || importsSuspended())
                        messages.push('Import stopped. Add the folder again to continue.')
                    yield* local(() =>
                        store.saveProgress({
                            repositoryImport: {
                                id: importId,
                                skipped,
                                skippedItems,
                                status: importStopped || importsSuspended() ? 'cancelled' : 'done',
                                completed,
                                total: discovered.paths.length,
                                message: messages.join(' ')
                            }
                        })
                    )
                    return yield* reply({ message: messages.join(' ') })
                }).pipe(
                    Effect.ensuring(
                        Effect.sync(() => {
                            importing = false
                        })
                    )
                )
            })
        const refresh = (options: Parameters<ActivityAcquisition['refresh']>[0] = {}): Effect.Effect<void, Error> => {
            return acquisition.refresh(options)
        }
        const backfill = (repositoryId: string, since: string): Effect.Effect<void, Error> => {
            return acquisition.backfill(repositoryId, since)
        }
        const handle = (command: Command): Effect.Effect<Reply, Error> =>
            Effect.gen(function* () {
                const generation = store.generation
                switch (command.type) {
                    case 'state':
                        return yield* reply()
                    case 'view':
                        return yield* reply({}, command.view)
                    case 'repository':
                        yield* local(() => store.updateRepositorySettings(command.repository, generation))
                        break
                    case 'loadWeek':
                        yield* refresh({ since: command.since, missingOnly: true })
                        break
                    case 'refresh':
                        yield* refresh({ ...command, resume: true })
                        break
                    case 'backfill':
                        yield* backfill(command.repositoryId, command.since)
                        break
                    case 'stopWork':
                        yield* stopWork(command.source, command.repositoryId)
                        break
                    case 'history': {
                        const repository = yield* findRepository(command.repositoryId)
                        const remoteNames = (yield* local(() => git(repository.path, ['remote'])))
                            .trim()
                            .split('\n')
                            .filter(Boolean)
                        const remotePrefix = remoteNames.find((name) => command.branch.startsWith(`${name}/`))
                        const branchName = remotePrefix ? command.branch.slice(remotePrefix.length + 1) : command.branch
                        const linked = (yield* local(() => store.activities(repository.id, 'change-request'))).find(
                            (a) => a.branches.includes(branchName)
                        )
                        const target = linked?.base
                        const remoteTarget = target
                            ? repository.branches.find((name) =>
                                  remoteNames.some((remote) => name === `${remote}/${target}`)
                              )
                            : undefined
                        const base = target
                            ? repository.branches.includes(target)
                                ? target
                                : (remoteTarget ?? target)
                            : (repository.branchBases[command.branch] ??
                              repository.branchBases[branchName] ??
                              repository.base)
                        const items = yield* local(() =>
                            commits(repository, command.branch, command.view, base, command.since)
                        )
                        yield* local(() => store.applyAcquisitionBatch({ activities: items }, generation))
                        const authors = (Array.isArray(command.author) ? command.author : [command.author])
                            .map((a) => a.trim().toLowerCase())
                            .filter(Boolean)
                        return yield* reply({
                            activityIds: items
                                .filter(
                                    (item) =>
                                        (!authors.length ||
                                            authors.some((a) => item.author.toLowerCase().includes(a))) &&
                                        (!command.since || item.date.slice(0, 10) >= command.since)
                                )
                                .map((item) => item.id),
                            message: `Comparison: ${base}`
                        })
                    }
                    case 'details':
                        return yield* reply(yield* records.details(command.activityId, command.content !== 'files'))
                    case 'newDraft':
                        yield* local(() => store.createDraft(command.week, generation))
                        break
                    case 'entryHistory':
                        return yield* reply({
                            entryPage: yield* local(() => store.entryHistory(command.query, command.cursor))
                        })
                    case 'draft': {
                        const saved = yield* local(() =>
                            store.saveDraft(command.draft, command.draft.version, generation)
                        )
                        return yield* reply({ draftSaved: { id: saved.id, version: saved.version } })
                    }
                    case 'select': {
                        const activity = yield* findActivity(command.activityId)
                        const selection: Selection = { activityId: activity.id }
                        if (command.included && activity.kind === 'change-request')
                            selection.revision = yield* records.capture(activity.id)
                        yield* local(() => store.setSelection(command.draftId, selection, command.included, generation))
                        break
                    }
                    case 'disposition':
                        yield* findActivity(command.activityId)
                        yield* local(() =>
                            store.setDisposition(
                                command.activityId,
                                command.disposition,
                                command.until,
                                command.reason,
                                generation
                            )
                        )
                        break
                    case 'settings':
                        yield* local(() =>
                            store.saveSettings(
                                { ...command.settings, destination: store.config.settings.destination },
                                generation
                            )
                        )
                        break
                    case 'publish':
                        yield* publishing.publish(command.draftId)
                        break
                    case 'reconcile':
                        yield* publishing.reconcile(command.saveId)
                        break
                    case 'coverage': {
                        const activity = yield* findActivity(command.activityId)
                        const revision =
                            command.linked && activity.kind === 'change-request'
                                ? yield* records.capture(activity.id)
                                : undefined
                        yield* local(() =>
                            store.setCoverage(
                                { activityId: activity.id, revision },
                                command.entryId,
                                command.linked,
                                generation
                            )
                        )
                        break
                    }
                    default:
                        return yield* Effect.fail(new JournalError('This command requires the desktop host'))
                }
                return yield* reply()
            })
        return {
            reply,
            suspend,
            stopWork: Effect.fn('Journal.stopWork')(stopWork),
            startRefresh: Effect.fn('Journal.startRefresh')(
                acquisition.startRefresh,
                Effect.mapError(toJournalFailure)
            ),
            addRepository: Effect.fn('Journal.addRepository')(addRepository, Effect.mapError(toJournalFailure)),
            scanRepositories: Effect.fn('Journal.scanRepositories')(
                scanRepositories,
                Effect.mapError(toJournalFailure)
            ),
            importRepositories: Effect.fn('Journal.importRepositories')(
                importRepositories,
                Effect.mapError(toJournalFailure)
            ),
            refresh: Effect.fn('Journal.refresh')(refresh, Effect.mapError(toJournalFailure)),
            backfill: Effect.fn('Journal.backfill')(backfill, Effect.mapError(toJournalFailure)),
            handle: Effect.fn('Journal.handle')(handle, Effect.mapError(toJournalFailure))
        }
    })
}
