import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { ApplicationWork } from './application-work'
import { makeSharedRequests } from './shared-requests'
import { Context, Deferred, Effect, Exit, Layer, Queue, type Scope } from 'effect'
import { indexCommits, inspectRepository, githubRemote } from './git'
import { HttpError } from './http'
import { localDate } from '../shared/model'
import { gitConfiguration, githubConfiguration } from '../shared/activity-history'
import type { Activity, Repository, State } from '../shared/model'
import { GitHub } from './github'
import { Notion } from './notion'
import { ActivityRecords, mergeActivities } from './activity-records'
import { JournalPublishing } from './journal-publishing'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
interface SourceAdmission {
    pending: number
    generation: number
}
interface SourceAttempt {
    owner: SourceAdmission
    generation: number
}
function batchSlots() {
    return Effect.gen(function* () {
        const slots = yield* Queue.bounded<undefined>(2)
        yield* Queue.offerAll(slots, [undefined, undefined])
        return slots
    })
}
export interface RefreshOptions {
    repositoryId?: string
    source?: 'git' | 'github' | 'notion'
    resume?: boolean
    since?: string
    missingOnly?: boolean
}
export interface ActivityAcquisition {
    readonly suspend: Effect.Effect<void, never, Scope.Scope>
    readonly stop: (source: 'git' | 'github', repositoryId?: string) => Effect.Effect<void>
    readonly refresh: (options?: RefreshOptions) => Effect.Effect<void, JournalFailure>
    readonly startRefresh: (options?: RefreshOptions) => Effect.Effect<void, JournalFailure>
    readonly backfill: (repositoryId: string, since: string) => Effect.Effect<void, JournalFailure>
}
export const ActivityAcquisition = Context.GenericTag<ActivityAcquisition>('gitorian/ActivityAcquisition')
export const ActivityAcquisitionLive = Layer.scoped(ActivityAcquisition, makeAcquisition())
function makeAcquisition() {
    return Effect.gen(function* () {
        const work = yield* ApplicationWork
        const store = yield* JournalStore
        const github = yield* GitHub
        const notion = yield* Notion
        const records = yield* ActivityRecords
        const publishing = yield* JournalPublishing
        const connections = (yield* ConnectionState).snapshot
        const sharedRefresh = yield* makeSharedRequests<string, undefined, Error>(
            () => new JournalError('Acquisition is closed')
        )
        const sources = new Map<
            string,
            {
                semaphore: Effect.Semaphore
                users: number
            }
        >()
        const acquisitionLanes = { git: yield* batchSlots(), github: yield* batchSlots() }
        const admissions = new Map<string, SourceAdmission>()
        const active = new WeakMap<NonNullable<State['acquisition']>[string], SourceAttempt>()
        const suspensions = new Set<symbol>()
        const isSuspended = () => suspensions.size > 0
        const checkStopped = (status: NonNullable<State['acquisition']>[string]): void => {
            if (isStopped(status)) throw new JournalError('Paused by you. Completed work is kept.')
        }
        const isStopped = (status: NonNullable<State['acquisition']>[string]): boolean => {
            const attempt = active.get(status)
            return status.status === 'cancelled' || (!!attempt && attempt.generation !== attempt.owner.generation)
        }
        const findRepository = (id: string): Repository => {
            const repository = store.state.repositories.find((item) => item.id === id)
            if (!repository) throw new JournalError('Repository is no longer available')
            return repository
        }
        const findActivity = (id: string): Activity => {
            const activity = store.state.activities.find((item) => item.id === id)
            if (!activity) throw new JournalError('Work is no longer available')
            return activity
        }
        const sourceStatus = (key: string): NonNullable<State['acquisition']>[string] => {
            const state = store.state
            state.acquisition ??= {}
            return (state.acquisition[key] ??= { status: 'idle' })
        }
        const serializeSource = (key: string, work: Effect.Effect<void, Error>): Effect.Effect<void, Error> => {
            return Effect.suspend(() => {
                let lane = sources.get(key)
                if (!lane) {
                    lane = { semaphore: Effect.unsafeMakeSemaphore(1), users: 0 }
                    sources.set(key, lane)
                }
                lane.users++
                const current = lane
                return current.semaphore
                    .withPermits(1)(work)
                    .pipe(
                        Effect.ensuring(
                            Effect.sync(() => {
                                if (--current.users === 0) sources.delete(key)
                            })
                        )
                    )
            })
        }
        const runSource = (
            key: string,
            work: Effect.Effect<void, Error>,
            resume = false,
            attempt?: SourceAttempt
        ): Effect.Effect<void> => {
            return Effect.gen(function* () {
                const status = sourceStatus(key)
                if (attempt && attempt.generation !== attempt.owner.generation) return
                if (isStopped(status) && !resume) return
                if (status.retryAt && Date.parse(status.retryAt) > Date.now()) return
                if (attempt) active.set(status, attempt)
                status.status = 'running'
                status.error = undefined
                status.retryAt = undefined
                store.persist()
                yield* work.pipe(
                    Effect.tap(() =>
                        Effect.sync(() => {
                            if (isStopped(status)) return
                            status.status = 'idle'
                            if (!status.windowEnd) status.lastSuccess = new Date().toISOString()
                        })
                    ),
                    Effect.catchAll((error) =>
                        Effect.sync(() => {
                            if (isStopped(status)) return
                            status.status = error instanceof HttpError && error.retryAt ? 'paused' : 'error'
                            status.error = error instanceof Error ? error.message : String(error)
                            status.retryAt =
                                error instanceof HttpError && error.retryAt
                                    ? new Date(error.retryAt).toISOString()
                                    : undefined
                        })
                    ),
                    Effect.ensuring(
                        Effect.sync(() => {
                            active.delete(status)
                            store.persist()
                        })
                    )
                )
            })
        }
        const refreshSources = (
            options: {
                repositoryId?: string
                source?: 'git' | 'github' | 'notion'
                resume?: boolean
                since?: string
                missingOnly?: boolean
            },
            acceptedState: State,
            generations: Map<string, number>,
            cleanups: (() => void)[]
        ): Effect.Effect<void, Error> => {
            const state = acceptedState
            if (state !== store.state) return Effect.void
            const repositories = state.repositories.filter(
                (item) => !item.removed && (!options.repositoryId || item.id === options.repositoryId)
            )
            if (options.since && options.source !== 'notion') {
                for (const repository of repositories) {
                    if (options.since >= repository.trackingStart) continue
                    repository.trackingStart = options.since
                }
                store.persist()
            }
            if (options.missingOnly && options.since) {
                for (const repository of repositories) {
                    const history = store.gitHistory(repository.id)
                    if (!history || history.configuration !== gitConfiguration(repository, state)) continue
                    mergeActivities(
                        store.state,
                        history.items.filter(
                            (activity) => localDate(new Date(activity.date), state.settings.timezone) >= options.since!
                        )
                    )
                    if (!history.nextOffset) {
                        const status = sourceStatus(`git:${repository.id}`)
                        status.historySince = repository.trackingStart
                        status.historyTimezone = state.settings.timezone
                        status.configuration = history.configuration
                    }
                }
                store.persist()
            }
            if (!options.missingOnly && !options.repositoryId && !options.source) {
                state.lastRefreshAttempt = new Date().toISOString()
                store.persist()
            }
            let acquired = false
            const acquire = (key: string, work: Effect.Effect<void, Error>): Effect.Effect<void, Error> => {
                const pending = sourceStatus(key)
                let admission = admissions.get(key)
                if (!admission) {
                    admission = { pending: 0, generation: 0 }
                    admissions.set(key, admission)
                }
                admission.pending++
                let released = false
                const release = () => {
                    if (released) return
                    released = true
                    if (--admission.pending !== 0) return
                    if (state === store.state && pending.status === 'running') {
                        pending.status = 'idle'
                        store.persist()
                    }
                }
                cleanups.push(release)
                const attempt: SourceAttempt = {
                    owner: admission,
                    generation: generations.get(key) ?? admission.generation
                }
                const [provider, repositoryId] = key.split(':')
                const repository = findRepository(repositoryId)
                const configuration =
                    provider === 'git' ? gitConfiguration(repository, state) : githubConfiguration(repository, state)
                if (
                    attempt.generation === attempt.owner.generation &&
                    (!isStopped(pending) || options.resume) &&
                    (!pending.retryAt || Date.parse(pending.retryAt) <= Date.now()) &&
                    !covered(pending, options, configuration)
                ) {
                    pending.status = 'running'
                    store.persist()
                }
                const perform = Effect.gen(function* () {
                    if (isSuspended() || state !== store.state || attempt.generation !== attempt.owner.generation)
                        return
                    const status = sourceStatus(key)
                    const [source, id] = key.split(':')
                    const repository = findRepository(id)
                    if (repository.removed) return
                    const configuration =
                        source === 'git' ? gitConfiguration(repository, state) : githubConfiguration(repository, state)
                    if (covered(status, options, configuration)) return
                    do {
                        acquired = true
                        // Admit one batch at a time so large histories rejoin the queue
                        // behind repositories that have not received their first batch.
                        const lane = key.startsWith('git:') ? acquisitionLanes.git : acquisitionLanes.github
                        yield* Effect.acquireUseRelease(
                            Queue.take(lane),
                            () =>
                                Effect.suspend(() => {
                                    if (
                                        isSuspended() ||
                                        repository.removed ||
                                        state !== store.state ||
                                        attempt.generation !== attempt.owner.generation
                                    )
                                        return Effect.void
                                    return runSource(key, work, options.resume, attempt)
                                }),
                            () => Queue.offer(lane, undefined)
                        )
                    } while (
                        options.since &&
                        status.windowEnd &&
                        status.status === 'idle' &&
                        !isSuspended() &&
                        attempt.generation === attempt.owner.generation &&
                        !repository.removed &&
                        state === store.state
                    )
                })
                // Serialize only the same repository/provider. A slow remote source must
                // never hold local history or another provider behind a global refresh.
                return serializeSource(key, perform).pipe(Effect.ensuring(Effect.sync(release)))
            }
            // Local Git, GitHub and Notion have independent worker admission.
            const notionRefresh =
                !options.missingOnly &&
                !options.repositoryId &&
                (!options.source || options.source === 'notion') &&
                connections().notion
                    ? serializeSource(
                          'notion',
                          runSource(
                              'notion',
                              Effect.gen(function* () {
                                  if (isSuspended() || state !== store.state) return
                                  const ids = new Set([
                                      ...state.saves
                                          .filter((save) => save.status === 'confirmed')
                                          .map((save) => save.entryId),
                                      ...state.drafts.map((draft) => draft.publishedEntryId)
                                  ])
                                  for (const id of ids) {
                                      if (!id) continue
                                      const entry = yield* notion.refreshEntry(id)
                                      const index = state.entries.findIndex((item) => item.id === entry.id)
                                      if (index < 0) state.entries.push(entry)
                                      else state.entries[index] = entry
                                  }
                                  for (const save of state.saves.filter((item) => item.status === 'unknown'))
                                      yield* publishing.reconcile(save.id)
                              })
                          )
                      )
                    : Effect.void
            const acquisition = Effect.all(
                [
                    notionRefresh,
                    Effect.all(
                        repositories.map((repository) => {
                            if (state !== store.state) return Effect.void
                            if (!options.source || options.source === 'git')
                                return acquire(
                                    `git:${repository.id}`,
                                    Effect.gen(function* () {
                                        const status = sourceStatus(`git:${repository.id}`)
                                        const trackingStart = repository.trackingStart
                                        const timezone = state.settings.timezone
                                        const configuration = gitConfiguration(repository, state)
                                        const stored = store.gitHistory(repository.id)
                                        const history = stored?.configuration === configuration ? stored : undefined
                                        if (!history || status.historyTimezone !== timezone)
                                            status.historySince = undefined
                                        status.historyTimezone = timezone
                                        yield* Effect.gen(function* () {
                                            if (!repository.remotes)
                                                repository.remotes = (yield* Effect.tryPromise({
                                                    try: () => inspectRepository(repository.path),
                                                    catch: (error) =>
                                                        error instanceof Error ? error : new JournalError(String(error))
                                                })).remotes
                                            const indexed = yield* Effect.tryPromise({
                                                try: () =>
                                                    indexCommits(
                                                        repository,
                                                        history?.refs ?? {},
                                                        trackingStart,
                                                        history?.nextOffset,
                                                        history?.excludedTips,
                                                        history?.items ?? [],
                                                        timezone
                                                    ),
                                                catch: (error) =>
                                                    error instanceof Error ? error : new JournalError(String(error))
                                            })
                                            yield* Effect.try({
                                                try: () => checkStopped(status),
                                                catch: (error) =>
                                                    error instanceof Error ? error : new JournalError(String(error))
                                            })
                                            if (state !== store.state)
                                                return yield* Effect.fail(
                                                    new JournalError('Local data was restored while refreshing.')
                                                )
                                            const names = Object.keys(indexed.refs)
                                            store.cacheGitHistory(repository.id, {
                                                configuration,
                                                refs: indexed.refs,
                                                nextOffset: indexed.nextOffset,
                                                excludedTips: indexed.excludedTips,
                                                items: (indexed.history ?? indexed.items).filter((activity) =>
                                                    repository.emails.some(
                                                        (email) => email.toLowerCase() === activity.author.toLowerCase()
                                                    )
                                                )
                                            })
                                            repository.branches = names
                                            repository.available = true
                                            for (const activity of state.activities.filter(
                                                (item) => item.repositoryId === repository.id
                                            ))
                                                activity.deletedBranches = activity.branches.filter(
                                                    (branch) => !names.includes(branch)
                                                )
                                            mergeActivities(
                                                store.state,
                                                indexed.items.filter((activity) =>
                                                    repository.emails.some(
                                                        (email) => email.toLowerCase() === activity.author.toLowerCase()
                                                    )
                                                )
                                            )
                                            status.refs = indexed.refs
                                            status.offset = indexed.nextOffset
                                            status.excludedTips = indexed.excludedTips
                                            status.windowEnd = indexed.nextOffset
                                                ? (status.windowEnd ?? new Date().toISOString())
                                                : undefined
                                            status.configuration = configuration
                                            status.since = trackingStart
                                            if (!indexed.nextOffset) status.historySince = trackingStart
                                        }).pipe(
                                            Effect.tapError(() =>
                                                Effect.sync(() => {
                                                    if (!isStopped(status)) repository.available = false
                                                })
                                            )
                                        )
                                    })
                                )
                            return Effect.void
                        }),
                        { concurrency: 'unbounded', discard: true }
                    ),
                    Effect.all(
                        repositories.map((repository) => {
                            if (state !== store.state) return Effect.void
                            if (
                                (!options.source || options.source === 'github') &&
                                connections().github &&
                                githubRemote(repository.remote)
                            )
                                return acquire(
                                    `github:${repository.id}`,
                                    Effect.gen(function* () {
                                        const status = sourceStatus(`github:${repository.id}`)
                                        const trackingStart = repository.trackingStart
                                        const timezone = state.settings.timezone
                                        const configuration = githubConfiguration(repository, state)
                                        if (
                                            status.configuration !== configuration ||
                                            status.historyTimezone !== timezone
                                        ) {
                                            status.since = trackingStart
                                            status.page = 1
                                            if (status.configuration !== configuration) status.versions = {}
                                            status.windowEnd = undefined
                                            status.lastSuccess = undefined
                                            status.historySince = undefined
                                        }
                                        if (
                                            (!status.historySince || trackingStart < status.historySince) &&
                                            status.since &&
                                            status.since > trackingStart
                                        ) {
                                            status.since = trackingStart
                                            status.page = 1
                                            status.windowEnd = undefined
                                        }
                                        status.configuration = configuration
                                        status.historyTimezone = timezone
                                        status.versions ??= {}
                                        if (!status.windowEnd) status.page = 1
                                        status.windowEnd ??= new Date().toISOString()
                                        if (!status.since)
                                            status.since = status.lastSuccess
                                                ? new Date(
                                                      Math.max(
                                                          Date.parse(trackingStart),
                                                          Date.parse(status.lastSuccess) - 2 * 86400000
                                                      )
                                                  )
                                                      .toISOString()
                                                      .slice(0, 10)
                                                : trackingStart
                                        const tracked = state.activities
                                            .filter((item) => item.repositoryId === repository.id && item.kind === 'pr')
                                            .map((item) => item.id)
                                        yield* github.activities(repository, state.settings.githubLogin, tracked, {
                                            timezone,
                                            since: status.since,
                                            page: status.page,
                                            versions: status.versions,
                                            background: true,
                                            checkpoint: (page, complete) =>
                                                Effect.try({
                                                    try: () => {
                                                        checkStopped(status)
                                                        status.page = page
                                                        if (complete) {
                                                            status.historySince = trackingStart
                                                            status.since = new Date(
                                                                Math.max(
                                                                    Date.parse(trackingStart),
                                                                    Date.parse(status.windowEnd!) - 2 * 86400000
                                                                )
                                                            )
                                                                .toISOString()
                                                                .slice(0, 10)
                                                            status.windowEnd = undefined
                                                        }
                                                        store.persist()
                                                    },
                                                    catch: (error) =>
                                                        error instanceof Error ? error : new JournalError(String(error))
                                                }),
                                            batch: (activities) =>
                                                Effect.gen(function* () {
                                                    if (state !== store.state)
                                                        return yield* Effect.fail(
                                                            new JournalError(
                                                                'Local data was restored while refreshing.'
                                                            )
                                                        )
                                                    yield* Effect.try({
                                                        try: () => checkStopped(status),
                                                        catch: (error) =>
                                                            error instanceof Error
                                                                ? error
                                                                : new JournalError(String(error))
                                                    })
                                                    for (const incoming of activities) {
                                                        const previous = state.activities.find(
                                                            (item) => item.id === incoming.id
                                                        )
                                                        const previousDate = previous?.date
                                                        const previousFingerprint = previous?.fingerprint
                                                        const previousRevision = state.revisions.find(
                                                            (item) => item.id === previous?.revision
                                                        )
                                                        mergeActivities(store.state, [incoming])
                                                        if (incoming.kind !== 'pr') continue
                                                        const current = findActivity(incoming.id)
                                                        const needsComparison =
                                                            !!previousRevision ||
                                                            current.date.slice(0, 10) < repository.trackingStart
                                                        current.fingerprint = undefined
                                                        current.revision = undefined
                                                        if (needsComparison) {
                                                            yield* Effect.gen(function* () {
                                                                yield* records.capture(current.id, {
                                                                    retainDiff: state.diffs[current.id] !== undefined,
                                                                    persist: false
                                                                })
                                                                const revision = state.revisions.find(
                                                                    (item) => item.id === current.revision
                                                                )
                                                                const changed = previousFingerprint
                                                                    ? previousFingerprint !== current.fingerprint
                                                                    : previousRevision &&
                                                                      revision &&
                                                                      (previousRevision.head !== revision.head ||
                                                                          previousRevision.base !== revision.base)
                                                                if (changed) current.date = new Date().toISOString()
                                                                else if (previousDate && previousDate > current.date)
                                                                    current.date = previousDate
                                                            }).pipe(
                                                                Effect.tapError(() =>
                                                                    Effect.sync(() => {
                                                                        if (
                                                                            previousRevision &&
                                                                            previousRevision.head !== current.head
                                                                        )
                                                                            current.date = new Date().toISOString()
                                                                        store.persist()
                                                                    })
                                                                )
                                                            )
                                                        } else if (previousDate && previousDate > current.date)
                                                            current.date = previousDate
                                                    }
                                                })
                                        })
                                    })
                                )
                            return Effect.void
                        }),
                        { concurrency: 'unbounded', discard: true }
                    )
                ],
                { concurrency: 'unbounded', discard: true }
            )
            return acquisition.pipe(
                Effect.tap(() =>
                    Effect.sync(() => {
                        const errors = Object.entries(state.acquisition ?? {})
                            .filter(([, status]) => status.status !== 'cancelled' && status.error)
                            .map(([key, status]) => `${key}: ${status.error}`)
                        state.refreshError = errors.length ? errors.join('\n') : undefined
                        if (
                            acquired &&
                            !errors.length &&
                            !Object.values(state.acquisition ?? {}).some((status) => status.windowEnd)
                        )
                            state.lastRefreshed = new Date().toISOString()
                        store.persist()
                    })
                )
            )
        }
        const covered = (
            status: NonNullable<State['acquisition']>[string],
            options: {
                missingOnly?: boolean
                since?: string
            },
            configuration: string
        ): boolean => {
            return !!(
                options.missingOnly &&
                options.since &&
                status.historySince &&
                status.historySince <= options.since &&
                status.historyTimezone === store.state.settings.timezone &&
                status.configuration === configuration
            )
        }
        const suspend = Effect.acquireRelease(
            Effect.sync(() => {
                const owner = Symbol()
                suspensions.add(owner)
                for (const admission of admissions.values()) admission.generation++
                for (const status of Object.values(store.state.acquisition ?? {}))
                    if (status.status === 'running') status.status = 'cancelled'
                return owner
            }),
            (owner) =>
                Effect.sync(() => {
                    suspensions.delete(owner)
                })
        ).pipe(Effect.asVoid)
        const stop = (source: 'git' | 'github', repositoryId?: string) =>
            Effect.sync(() => {
                for (const [key, admission] of admissions)
                    if (key.startsWith(source + ':') && (!repositoryId || key === source + ':' + repositoryId))
                        admission.generation++
                for (const [key, status] of Object.entries(store.state.acquisition ?? {}))
                    if (key.startsWith(source + ':') && (!repositoryId || key === source + ':' + repositoryId)) {
                        status.status = 'cancelled'
                        status.error = undefined
                    }
            })
        const refresh = (
            options: {
                repositoryId?: string
                source?: 'git' | 'github' | 'notion'
                resume?: boolean
                since?: string
                missingOnly?: boolean
            } = {},
            ready: Effect.Effect<void> = Effect.void
        ): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                if (isSuspended()) return
                const state = store.state
                // Completed sources still contribute cancellation identity while a shared
                // refresh is cached. Retain their generations until the repository is gone.
                const repositories = new Set(state.repositories.map((repository) => repository.id))
                for (const [key, admission] of admissions)
                    if (admission.pending === 0 && !repositories.has(key.slice(key.indexOf(':') + 1)))
                        admissions.delete(key)
                // Import and settings changes can arrive while an earlier scan is running.
                // Only coalesce callers whose requested source set and configuration match.
                const generations = new Map<string, number>()
                for (const repository of state.repositories)
                    for (const provider of ['git', 'github']) {
                        const key = provider + ':' + repository.id
                        let admission = admissions.get(key)
                        if (!admission) {
                            admission = { pending: 0, generation: 0 }
                            admissions.set(key, admission)
                        }
                        generations.set(key, admission.generation)
                    }
                const sources = state.repositories
                    .filter(
                        (repository) =>
                            !repository.removed && (!options.repositoryId || repository.id === options.repositoryId)
                    )
                    .map((repository) => [
                        repository.id,
                        gitConfiguration(repository, state),
                        githubConfiguration(repository, state),
                        admissions.get(`git:${repository.id}`)?.generation ?? 0,
                        admissions.get(`github:${repository.id}`)?.generation ?? 0
                    ])
                const key = JSON.stringify([
                    options.repositoryId,
                    options.source,
                    !!options.resume,
                    options.since,
                    !!options.missingOnly,
                    state.settings.timezone,
                    state.restoreId,
                    sources
                ])
                const cleanups: (() => void)[] = []
                const prepared = Effect.acquireRelease(Effect.succeed(cleanups), (owners) =>
                    Effect.sync(() => {
                        for (const release of owners) release()
                    })
                ).pipe(
                    Effect.map(() => refreshSources(options, state, generations, cleanups).pipe(Effect.as(undefined)))
                )
                yield* sharedRefresh(key, prepared, ready)
            })
        const backfill = (repositoryId: string, since: string): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const repository = store.state.repositories.find((item) => item.id === repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                if (since > repository.trackingStart)
                    return yield* Effect.fail(new JournalError('Choose a date before the current history start.'))
                yield* refresh({ repositoryId, since, resume: true })
            })
        const startRefresh = (options: RefreshOptions = {}): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const admitted = yield* Deferred.make<undefined, Error>()
                yield* work.fork(
                    refresh(options, Deferred.succeed(admitted, undefined).pipe(Effect.asVoid)).pipe(
                        Effect.onExit((exit) =>
                            Exit.isFailure(exit)
                                ? Deferred.failCause(admitted, exit.cause)
                                : Deferred.succeed(admitted, undefined)
                        )
                    )
                )
                yield* Deferred.await(admitted)
            })
        return {
            suspend,
            stop: Effect.fn('ActivityAcquisition.stop')(stop),
            refresh: Effect.fn('ActivityAcquisition.refresh')(refresh, Effect.mapError(toJournalFailure)),
            startRefresh: Effect.fn('ActivityAcquisition.startRefresh')(
                startRefresh,
                Effect.mapError(toJournalFailure)
            ),
            backfill: Effect.fn('ActivityAcquisition.backfill')(backfill, Effect.mapError(toJournalFailure))
        }
    })
}
