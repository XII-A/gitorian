import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { randomUUID } from 'node:crypto'
import { basename, relative } from 'node:path'
import { Context, Effect, Layer, type Scope } from 'effect'
import { commits, inspectRepository, git } from './git'
import { JournalPublishing } from './journal-publishing'
import { ActivityAcquisition } from './activity-acquisition'
import { ActivityRecords, mergeActivities } from './activity-records'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
import { discoverRepositories, repositoryPathKey } from './repository-discovery'
import { weekOf } from '../shared/model'
import type { Command, Reply, RepositoryImportProgress, Selection } from '../shared/model'
import { imageIds } from '../shared/images'
export interface JournalService {
    readonly reply: (extra?: Partial<Reply>, state?: Reply['state']) => Reply
    readonly suspend: Effect.Effect<void, never, Scope.Scope>
    readonly stopWork: (source: 'git' | 'github' | 'repositories', repositoryId?: string) => Effect.Effect<void>
    readonly addRepository: (path: string, persist?: boolean) => Effect.Effect<void, JournalFailure>
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
        const acquisition = yield* ActivityAcquisition
        const publishing = yield* JournalPublishing
        const records = yield* ActivityRecords
        const connections = (yield* ConnectionState).snapshot
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
                const repository = store.state.repositories.find((item) => item.id === id)
                return repository
                    ? Effect.succeed(repository)
                    : Effect.fail(new JournalError('Repository is no longer available'))
            })
        const findActivity = (id: string) =>
            Effect.suspend(() => {
                const activity = store.state.activities.find((item) => item.id === id)
                return activity
                    ? Effect.succeed(activity)
                    : Effect.fail(new JournalError('Work is no longer available'))
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
        const stopWork = (source: 'git' | 'github' | 'repositories', repositoryId?: string) =>
            Effect.gen(function* () {
                if (source === 'repositories') importStopped = true
                else yield* acquisition.stop(source, repositoryId)
                store.persist()
            })
        const reply = (extra: Partial<Reply> = {}, state = store.snapshot()): Reply => {
            return { state, connections: connections(), ...extra }
        }
        const addRepository = (path: string, persist = true): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const inspected = yield* Effect.tryPromise({
                    try: () => inspectRepository(path),
                    catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                })
                if (
                    store.state.repositories.some(
                        (repository) => repositoryPathKey(repository.path) === repositoryPathKey(inspected.path)
                    )
                )
                    return yield* Effect.fail(new JournalError('This repository is already tracked'))
                store.state.repositories.push({
                    id: randomUUID(),
                    name: inspected.name,
                    path: inspected.path,
                    remote: inspected.githubRemote,
                    base: inspected.base,
                    emails: inspected.email ? [inspected.email] : [],
                    trackingStart: weekOf(new Date(), store.state.settings),
                    available: true,
                    removed: false,
                    branchBases: {},
                    branches: inspected.branches,
                    remotes: inspected.remotes
                })
                if (persist) store.persist()
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
                return reply({
                    repositoryScan: {
                        id,
                        folder,
                        unreadable: discovered.unreadable,
                        repositories: discovered.paths.map((path) => {
                            const tracked = store.state.repositories.find(
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
                if (importing) return reply({ message: 'A repository import is already running.' })
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
                store.state.repositoryImport = { id: importId, status: 'running', completed: 0, total: 0 }
                store.persist()
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
                    store.state.repositoryImport = {
                        id: importId,
                        status: 'running',
                        completed,
                        total: discovered.paths.length
                    }
                    store.persist()
                    yield* Effect.forEach(
                        discovered.paths,
                        (path) =>
                            Effect.gen(function* () {
                                if (importStopped || importsSuspended()) return
                                const tracked = store.state.repositories.find(
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
                                            restored++
                                        } else existing++
                                    } else {
                                        yield* addRepository(path, false)
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
                                completed++
                                store.state.repositoryImport = {
                                    id: importId,
                                    status: 'running',
                                    completed,
                                    total: discovered.paths.length
                                }
                                if (completed % 4 === 0) store.persist()
                                onProgress?.({ stage: 'processing', completed, total: discovered.paths.length })
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
                    store.state.repositoryImport = {
                        id: importId,
                        skipped,
                        skippedItems,
                        status: importStopped || importsSuspended() ? 'cancelled' : 'done',
                        completed,
                        total: discovered.paths.length,
                        message: messages.join(' ')
                    }
                    store.persist()
                    return reply({ message: messages.join(' ') })
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
                const state = store.state
                switch (command.type) {
                    case 'state':
                        return reply()
                    case 'repository': {
                        const repository = yield* findRepository(command.repository.id)
                        const incoming = command.repository
                        // Renderer configuration cannot assign arbitrary filesystem paths.
                        Object.assign(repository, incoming, { path: repository.path, available: repository.available })
                        break
                    }
                    case 'loadWeek':
                        yield* refresh({ since: command.since, missingOnly: true })
                        return reply()
                    case 'refresh':
                        yield* refresh({ ...command, resume: true })
                        return reply()
                    case 'backfill':
                        yield* backfill(command.repositoryId, command.since)
                        return reply()
                    case 'stopWork':
                        yield* stopWork(command.source, command.repositoryId)
                        return reply()
                    case 'history': {
                        const repository = yield* findRepository(command.repositoryId)
                        const remoteNames = (yield* Effect.tryPromise({
                            try: () => git(repository.path, ['remote']),
                            catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                        }))
                            .trim()
                            .split('\n')
                            .filter(Boolean)
                        const remotePrefix = remoteNames.find((name) => command.branch.startsWith(`${name}/`))
                        const branchName = remotePrefix ? command.branch.slice(remotePrefix.length + 1) : command.branch
                        const linked = state.activities.find(
                            (activity) =>
                                activity.kind === 'pr' &&
                                activity.repositoryId === repository.id &&
                                activity.branches.includes(branchName)
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
                        const items = yield* Effect.tryPromise({
                            try: () => commits(repository, command.branch, command.view, base, command.since),
                            catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                        })
                        for (const item of items) mergeActivities(store.state, [item])
                        store.persist()
                        const authors = (Array.isArray(command.author) ? command.author : [command.author])
                            .map((author) => author.trim().toLowerCase())
                            .filter(Boolean)
                        return reply({
                            activityIds: items
                                .filter(
                                    (item) =>
                                        (!authors.length ||
                                            authors.some((author) => item.author.toLowerCase().includes(author))) &&
                                        (!command.since || item.date.slice(0, 10) >= command.since)
                                )
                                .map((item) => item.id),
                            message: `Comparison: ${base}`
                        })
                    }
                    case 'details':
                        return reply(yield* records.details(command.activityId, command.content !== 'files'))
                    case 'newDraft':
                        if (state.drafts.some((draft) => draft.week === command.week)) break
                        state.drafts.push({
                            id: randomUUID(),
                            week: command.week,
                            title: `${command.week} – ${new Date(new Date(`${command.week}T12:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10)}`,
                            body: structuredClone(state.settings.template),
                            selections: [],
                            updatedAt: new Date().toISOString()
                        })
                        break
                    case 'draft': {
                        for (const id of imageIds(command.draft.body))
                            if (!store.hasImage(id))
                                return yield* Effect.fail(
                                    new JournalError('A draft image is missing. Restore it from a backup.')
                                )
                        const draft = state.drafts.find((item) => item.id === command.draft.id)
                        if (!draft) return yield* Effect.fail(new JournalError('Draft is unavailable'))
                        draft.body = command.draft.body
                        draft.title = command.draft.title
                        draft.updatedAt = new Date().toISOString()
                        break
                    }
                    case 'select': {
                        const draft = state.drafts.find((item) => item.id === command.draftId)
                        if (!draft) return yield* Effect.fail(new JournalError('Choose an editable draft'))
                        const activity = yield* findActivity(command.activityId)
                        if (command.included) {
                            if (draft.selections.some((item) => item.activityId === activity.id)) break
                            const selected: Selection = { activityId: activity.id }
                            if (activity.kind === 'pr') {
                                selected.revision =
                                    activity.revision && state.diffs[activity.id] !== undefined
                                        ? activity.revision
                                        : yield* records.capture(activity.id)
                            }
                            draft.selections.push(selected)
                            activity.explicit = true
                        } else draft.selections = draft.selections.filter((item) => item.activityId !== activity.id)
                        break
                    }
                    case 'disposition':
                        Object.assign(yield* findActivity(command.activityId), {
                            disposition: command.disposition,
                            deferUntil: command.until,
                            reason: command.reason
                        })
                        if (command.disposition === 'inbox') (yield* findActivity(command.activityId)).explicit = true
                        break
                    case 'settings': {
                        for (const id of imageIds(command.settings.template))
                            if (!store.hasImage(id))
                                return yield* Effect.fail(
                                    new JournalError('A template image is missing. Restore it from a backup.')
                                )
                        yield* Effect.try({
                            try: () => new Intl.DateTimeFormat('en-US', { timeZone: command.settings.timezone }),
                            catch: (error) => new JournalError(error instanceof Error ? error.message : String(error))
                        })
                        const order = command.settings.layout.order
                        if (order.length !== 3 || new Set(order).size !== 3)
                            return yield* Effect.fail(new JournalError('Layout must contain each pane once'))
                        state.settings = { ...command.settings, destination: state.settings.destination }
                        break
                    }
                    case 'publish':
                        yield* publishing.publish(command.draftId)
                        return reply()
                    case 'reconcile':
                        yield* publishing.reconcile(command.saveId)
                        return reply()
                    case 'coverage': {
                        const activity = yield* findActivity(command.activityId)
                        if (!state.entries.some((entry) => entry.id === command.entryId))
                            return yield* Effect.fail(new JournalError('Choose a cached saved entry'))
                        if (command.linked) {
                            const revision =
                                activity.kind === 'pr'
                                    ? activity.revision && state.diffs[activity.id] !== undefined
                                        ? activity.revision
                                        : yield* records.capture(activity.id)
                                    : undefined
                            state.coverage.push({ activityId: activity.id, revision, entryId: command.entryId })
                        } else
                            state.coverage = state.coverage.filter(
                                (link) => !(link.activityId === activity.id && link.entryId === command.entryId)
                            )
                        break
                    }
                    default:
                        return yield* Effect.fail(new JournalError('This command requires the desktop host'))
                }
                return reply({}, store.persist())
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
