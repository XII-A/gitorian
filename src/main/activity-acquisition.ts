import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { ApplicationWork } from './application-work'
import { makeSharedRequests } from './shared-requests'
import { Context, Deferred, Effect, Exit, Layer, Queue, type Scope } from 'effect'
import { indexCommits, inspectRepository } from './git'
import { Http, HttpError } from './http'
import { gitConfiguration, contributionConfiguration } from '../shared/activity-history'
import { localDate } from '../shared/model'
import type { Activity, Repository, State } from '../shared/model'
import type { AcquisitionBatch } from './database/types'
import { RemoteContributions } from './remote-contributions'
import { ProviderAccounts } from './provider-accounts'
import { providerRemote } from '../shared/provider-accounts'
import { Notion } from './notion'
import { ActivityRecords } from './activity-records'
import { GitLabFailure } from './gitlab'
import { JournalPublishing } from './journal-publishing'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
function batchSlots() {
    return Effect.gen(function* () {
        const slots = yield* Queue.bounded<undefined>(2)
        yield* Queue.offerAll(slots, [undefined, undefined])
        return slots
    })
}
export interface RefreshOptions {
    repositoryId?: string
    source?: 'git' | 'remote' | 'notion'
    resume?: boolean
    since?: string
    missingOnly?: boolean
}
export interface ActivityAcquisition {
    readonly suspend: Effect.Effect<void, never, Scope.Scope>
    readonly stop: (source: 'git' | 'remote', repositoryId?: string) => Effect.Effect<void>
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
        const github = yield* RemoteContributions
        const accounts = yield* ProviderAccounts
        const http = yield* Http
        const notion = yield* Notion
        const records = yield* ActivityRecords
        const publishing = yield* JournalPublishing
        const connections = (yield* ConnectionState).snapshot
        const local = <A>(operation: () => Promise<A>) =>
            Effect.tryPromise({
                try: operation,
                catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
            })
        const shared = yield* makeSharedRequests<string, undefined, Error>(
            () => new JournalError('Acquisition is closed')
        )
        const lanes = { git: yield* batchSlots(), remote: yield* batchSlots() }
        const sources = new Map<
            string,
            { generation: number; pending: number; lane: Effect.Semaphore; controller: AbortController }
        >()
        const statuses = new Map<string, NonNullable<State['acquisition']>[string]>()
        const suspensions = new Set<symbol>()
        let stateGeneration = store.generation
        const source = (key: string) => {
            let value = sources.get(key)
            if (!value) {
                value = {
                    generation: 0,
                    pending: 0,
                    lane: Effect.unsafeMakeSemaphore(1),
                    controller: new AbortController()
                }
                sources.set(key, value)
            }
            return value
        }
        const untilStopped = (key: string, operation: Effect.Effect<void, Error>) =>
            Effect.suspend(() => {
                const signal = source(key).controller.signal
                if (signal.aborted) return Effect.void
                const cancelled = Effect.async<undefined>((resume) => {
                    const cancel = () => resume(Effect.succeed(undefined))
                    signal.addEventListener('abort', cancel, { once: true })
                    if (signal.aborted) cancel()
                    return Effect.sync(() => signal.removeEventListener('abort', cancel))
                })
                return Effect.raceFirst(operation, cancelled)
            })
        const statusFor = (key: string) => {
            let value = statuses.get(key)
            if (!value) {
                value = structuredClone(store.config.acquisition[key] ?? { status: 'idle' })
                statuses.set(key, value)
            }
            return value
        }
        const stopped = (key: string, token: number, generation: string) =>
            suspensions.size > 0 ||
            store.generation !== generation ||
            source(key).generation !== token ||
            (key !== 'notion' && !!store.config.repositories.find((r) => key.endsWith(':' + r.id))?.removed)
        const checkpoint = (key: string, value: NonNullable<State['acquisition']>[string], generation: string) =>
            local(() => store.saveCheckpoint(key, value, generation))
        const stop = (provider: 'git' | 'remote', repositoryId?: string) =>
            Effect.gen(function* () {
                const keys = new Set([...sources.keys(), ...Object.keys(store.config.acquisition)])
                for (const key of keys)
                    if (key.startsWith(provider + ':') && (!repositoryId || key === provider + ':' + repositoryId)) {
                        source(key).generation++
                        source(key).controller.abort(new Error('Acquisition stopped.'))
                        const status = statusFor(key)
                        Object.assign(status, { status: 'cancelled', error: undefined, pending: undefined })
                        yield* checkpoint(key, status, store.generation)
                    }
            }).pipe(Effect.orDie)
        const suspend = Effect.acquireRelease(
            Effect.sync(() => {
                const owner = Symbol()
                suspensions.add(owner)
                for (const value of sources.values()) {
                    value.generation++
                    value.controller.abort(new Error('Acquisition suspended.'))
                }
                return owner
            }),
            (owner) =>
                Effect.sync(() => {
                    suspensions.delete(owner)
                })
        ).pipe(Effect.asVoid)

        const refresh = (
            options: RefreshOptions = {},
            ready: Effect.Effect<void> = Effect.void
        ): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                if (suspensions.size) return
                const generation = store.generation
                if (stateGeneration !== generation) {
                    statuses.clear()
                    sources.clear()
                    stateGeneration = generation
                }
                for (const value of sources.values())
                    if (value.controller.signal.aborted) value.controller = new AbortController()
                const config = store.config
                const repositories = config.repositories.filter(
                    (r) => !r.removed && (!options.repositoryId || r.id === options.repositoryId)
                )
                const identity = { settings: config.settings, restoreId: generation }
                const keys = repositories.flatMap((r) => [
                    ...(!options.source || options.source === 'git' ? [`git:${r.id}`] : []),
                    ...((!options.source || options.source === 'remote') &&
                    connections().remote &&
                    providerRemote(r.remote)
                        ? [`remote:${r.id}`]
                        : [])
                ])
                const tokens = new Map(keys.map((key) => [key, source(key).generation]))
                const signature = JSON.stringify([
                    options,
                    generation,
                    config.settings.timezone,
                    '',
                    repositories.map((r) => [
                        r.id,
                        gitConfiguration(r, identity),
                        contributionConfiguration(r, identity)
                    ]),
                    [...tokens]
                ])
                const perform = Effect.gen(function* () {
                    if (!options.missingOnly && !options.repositoryId && !options.source)
                        yield* local(() =>
                            store.saveProgress({ lastRefreshAttempt: new Date().toISOString() }, generation)
                        )
                    let acquired = false
                    const acquire = (key: string, repository: Repository) =>
                        source(key).lane.withPermits(1)(
                            Effect.gen(function* () {
                                const token = tokens.get(key)!
                                if (stopped(key, token, generation)) return
                                const provider = key.startsWith('git:') ? 'git' : 'remote'
                                if (provider === 'remote' && !repository.accountId) {
                                    yield* accounts
                                        .resolve(repository.id, undefined, true)
                                        .pipe(Effect.catchAll(() => Effect.void))
                                    repository =
                                        store.config.repositories.find((current) => current.id === repository.id) ??
                                        repository
                                }
                                const status = statusFor(key)
                                if (options.resume) status.incomplete = undefined
                                if (status.status === 'cancelled' && !options.resume) return
                                if (status.retryAt && Date.parse(status.retryAt) > Date.now()) return
                                if (provider === 'remote' && !status.pending && repository.accountId) {
                                    const owners = store.config.repositories.filter(
                                        (item) => !item.removed && item.accountId === repository.accountId
                                    )
                                    const staged = owners.filter(
                                        (item) => store.config.acquisition[`remote:${item.id}`]?.pending
                                    ).length
                                    if (staged >= 2) {
                                        Object.assign(status, {
                                            status: 'paused',
                                            retryAt: new Date(Date.now() + 1000).toISOString(),
                                            error: 'Waiting for pending contribution pages on this account to finish.'
                                        })
                                        yield* checkpoint(key, status, generation)
                                        return
                                    }
                                }
                                if (options.since && options.since < repository.trackingStart) {
                                    repository = { ...repository, trackingStart: options.since }
                                    yield* local(() =>
                                        store.extendTrackingStart(repository.id, options.since!, generation)
                                    )
                                }
                                const configuration =
                                    provider === 'git'
                                        ? gitConfiguration(repository, identity)
                                        : contributionConfiguration(repository, identity)
                                const sourceIdentity: NonNullable<AcquisitionBatch['source']> = {
                                    repositoryId: repository.id,
                                    provider: provider,
                                    configuration
                                }
                                if (
                                    options.missingOnly &&
                                    options.since &&
                                    status.historySince &&
                                    status.historySince <= options.since &&
                                    status.historyTimezone === config.settings.timezone &&
                                    status.configuration === configuration
                                )
                                    return
                                const check = Effect.try({
                                    try: () => {
                                        if (stopped(key, token, generation))
                                            throw new JournalError('Paused by you. Completed work is kept.')
                                    },
                                    catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                                })
                                {
                                    if (stopped(key, token, generation)) return
                                    yield* Effect.acquireUseRelease(
                                        Queue.take(lanes[provider]),
                                        () =>
                                            Effect.gen(function* () {
                                                if (stopped(key, token, generation)) return
                                                acquired = true
                                                Object.assign(status, {
                                                    status: 'running',
                                                    error: undefined,
                                                    retryAt: undefined
                                                })
                                                yield* checkpoint(key, status, generation)
                                                let checkpointSafe = true
                                                const batch =
                                                    provider === 'git'
                                                        ? Effect.gen(function* () {
                                                              const saved = yield* local(() =>
                                                                  store.history(repository.id, false)
                                                              )
                                                              const history =
                                                                  saved?.configuration === configuration
                                                                      ? saved
                                                                      : undefined
                                                              if (
                                                                  !history ||
                                                                  status.historyTimezone !== config.settings.timezone
                                                              )
                                                                  status.historySince = undefined
                                                              const cachedHistory =
                                                                  options.missingOnly &&
                                                                  history &&
                                                                  !history.nextOffset &&
                                                                  !status.gitCursor
                                                              if (!cachedHistory && !repository.remotes)
                                                                  repository.remotes = (yield* local(() =>
                                                                      inspectRepository(
                                                                          repository.path,
                                                                          source(key).controller.signal
                                                                      )
                                                                  )).remotes
                                                              const indexed: Awaited<ReturnType<typeof indexCommits>> =
                                                                  cachedHistory
                                                                      ? { refs: history.refs, items: [] }
                                                                      : yield* local(() =>
                                                                            indexCommits(
                                                                                repository,
                                                                                history?.refs ?? {},
                                                                                repository.trackingStart,
                                                                                history?.nextOffset,
                                                                                history?.excludedTips,
                                                                                config.settings.timezone,
                                                                                source(key).controller.signal,
                                                                                history ? status.gitCursor : undefined
                                                                            )
                                                                        )
                                                              yield* check
                                                              const names = Object.keys(indexed.refs)
                                                              const belongs = (a: Activity) =>
                                                                  repository.emails.some(
                                                                      (email) =>
                                                                          email.toLowerCase() === a.author.toLowerCase()
                                                                  )
                                                              repository = {
                                                                  ...repository,
                                                                  branches: names,
                                                                  available: true
                                                              }
                                                              const requestedProjection =
                                                                  history &&
                                                                  (status.historyProjection ||
                                                                      status.since !== repository.trackingStart ||
                                                                      status.historyTimezone !==
                                                                          config.settings.timezone ||
                                                                      !status.historySince)
                                                                      ? {
                                                                            since: repository.trackingStart,
                                                                            timezone: config.settings.timezone,
                                                                            after:
                                                                                status.historyProjection?.since ===
                                                                                    repository.trackingStart &&
                                                                                status.historyProjection.timezone ===
                                                                                    config.settings.timezone
                                                                                    ? status.historyProjection.after
                                                                                    : undefined
                                                                        }
                                                                      : undefined
                                                              const projectionRows = requestedProjection
                                                                  ? yield* local(() =>
                                                                        store.historyProjectionPage(
                                                                            repository.id,
                                                                            requestedProjection.after
                                                                        )
                                                                    )
                                                                  : []
                                                              const historyProjection =
                                                                  requestedProjection && projectionRows.length === 2000
                                                                      ? {
                                                                            ...requestedProjection,
                                                                            after: projectionRows.at(-1)!.id
                                                                        }
                                                                      : undefined
                                                              const projectHistoryIds = projectionRows
                                                                  .filter(
                                                                      (row) =>
                                                                          !row.journaled &&
                                                                          localDate(
                                                                              new Date(row.instant),
                                                                              config.settings.timezone
                                                                          ) >= repository.trackingStart
                                                                  )
                                                                  .map((row) => row.id)
                                                              const pending =
                                                                  indexed.nextOffset !== undefined ||
                                                                  !!historyProjection
                                                              const nextStatus = {
                                                                  ...status,
                                                                  gitCursor: indexed.cursor,
                                                                  historyProjection,
                                                                  refs: indexed.refs,
                                                                  offset: indexed.nextOffset,
                                                                  excludedTips: indexed.excludedTips,
                                                                  windowEnd: pending
                                                                      ? (status.windowEnd ?? new Date().toISOString())
                                                                      : undefined,
                                                                  configuration,
                                                                  since: repository.trackingStart,
                                                                  historyTimezone: config.settings.timezone,
                                                                  ...(!pending
                                                                      ? { historySince: repository.trackingStart }
                                                                      : {})
                                                              }
                                                              const activities = indexed.items
                                                                  .filter(belongs)
                                                                  .map((a) => ({
                                                                      ...a,
                                                                      deletedBranches: a.branches.filter(
                                                                          (b) => !names.includes(b)
                                                                      )
                                                                  }))
                                                              yield* local(() =>
                                                                  store.applyAcquisitionBatch(
                                                                      {
                                                                          source: sourceIdentity,
                                                                          repository,
                                                                          activities,
                                                                          projectHistoryIds,
                                                                          checkpoint: { key, value: nextStatus },
                                                                          historyDelta: {
                                                                              configuration,
                                                                              refs: indexed.refs,
                                                                              nextOffset: indexed.nextOffset,
                                                                              excludedTips: indexed.excludedTips,
                                                                              memberships: indexed.memberships,
                                                                              items: (
                                                                                  indexed.history ?? indexed.items
                                                                              ).filter(belongs)
                                                                          }
                                                                      },
                                                                      generation
                                                                  )
                                                              )
                                                              Object.assign(status, nextStatus)
                                                          })
                                                        : Effect.gen(function* () {
                                                              if (
                                                                  status.configuration !== configuration ||
                                                                  status.historyTimezone !== config.settings.timezone
                                                              ) {
                                                                  Object.assign(status, {
                                                                      since: repository.trackingStart,
                                                                      pending: undefined,
                                                                      incomplete: undefined,
                                                                      page: 1,
                                                                      offset: 0,
                                                                      windowEnd: undefined,
                                                                      lastSuccess: undefined,
                                                                      historySince: undefined,
                                                                      versions:
                                                                          status.configuration === configuration
                                                                              ? status.versions
                                                                              : {}
                                                                  })
                                                              }
                                                              if (
                                                                  (!status.historySince ||
                                                                      repository.trackingStart < status.historySince) &&
                                                                  status.since &&
                                                                  status.since > repository.trackingStart
                                                              )
                                                                  Object.assign(status, {
                                                                      since: repository.trackingStart,
                                                                      pending: undefined,
                                                                      incomplete: undefined,
                                                                      page: 1,
                                                                      offset: 0,
                                                                      windowEnd: undefined
                                                                  })
                                                              Object.assign(status, {
                                                                  configuration,
                                                                  historyTimezone: config.settings.timezone
                                                              })
                                                              status.versions ??= {}
                                                              if (!status.windowEnd) status.page = 1
                                                              status.windowEnd ??= new Date().toISOString()
                                                              status.since ??= status.lastSuccess
                                                                  ? new Date(
                                                                        Math.max(
                                                                            Date.parse(repository.trackingStart),
                                                                            Date.parse(status.lastSuccess) -
                                                                                2 * 86400000
                                                                        )
                                                                    )
                                                                        .toISOString()
                                                                        .slice(0, 10)
                                                                  : repository.trackingStart
                                                              const tracked = (yield* local(() =>
                                                                  store.activities(repository.id, 'change-request')
                                                              )).map((a) => a.id)
                                                              yield* github.activities(
                                                                  repository,
                                                                  config.accounts.find(
                                                                      (a) => a.id === repository.accountId
                                                                  )?.username ?? '',
                                                                  tracked,
                                                                  {
                                                                      timezone: config.settings.timezone,
                                                                      since: status.since,
                                                                      page: status.page,
                                                                      offset: status.offset,
                                                                      versions: status.versions,
                                                                      pending: status.pending,
                                                                      incomplete: status.incomplete,
                                                                      recordIncomplete: (identity, reason) =>
                                                                          Effect.gen(function* () {
                                                                              yield* check
                                                                              const prior = status.incomplete ?? {}
                                                                              const number = identity.split(':')[0]
                                                                              const entries = Object.entries(
                                                                                  prior
                                                                              ).filter(
                                                                                  ([key]) =>
                                                                                      !key.startsWith(number + ':')
                                                                              )
                                                                              if (entries.length >= 128)
                                                                                  return yield* Effect.fail(
                                                                                      new JournalError(
                                                                                          'Too many incomplete contributions; narrow the tracked range or inspect the source.'
                                                                                      )
                                                                                  )
                                                                              status.incomplete = Object.fromEntries(
                                                                                  reason
                                                                                      ? [...entries, [identity, reason]]
                                                                                      : entries
                                                                              )
                                                                              yield* checkpoint(key, status, generation)
                                                                          }),
                                                                      savePending: (pending) =>
                                                                          Effect.gen(function* () {
                                                                              yield* check
                                                                              status.pending = pending
                                                                              if (
                                                                                  pending &&
                                                                                  Object.keys(pending.pages).length
                                                                              )
                                                                                  status.lastProgressAt = Date.now()
                                                                              yield* checkpoint(key, status, generation)
                                                                          }),
                                                                      background: true,
                                                                      batch: (activities) =>
                                                                          Effect.gen(function* () {
                                                                              yield* check
                                                                              const prior = new Map<string, Activity>()
                                                                              for (const incoming of activities) {
                                                                                  const previous = yield* local(() =>
                                                                                      store.activity(incoming.id)
                                                                                  )
                                                                                  if (previous)
                                                                                      prior.set(incoming.id, previous)
                                                                              }
                                                                              yield* local(() =>
                                                                                  store.applyAcquisitionBatch(
                                                                                      {
                                                                                          source: sourceIdentity,
                                                                                          activities
                                                                                      },
                                                                                      generation
                                                                                  )
                                                                              )
                                                                              for (const incoming of activities) {
                                                                                  if (
                                                                                      incoming.kind !== 'change-request'
                                                                                  )
                                                                                      continue
                                                                                  const previous = prior.get(
                                                                                      incoming.id
                                                                                  )
                                                                                  const revisions = yield* local(() =>
                                                                                      store.revisions(incoming.id)
                                                                                  )
                                                                                  const previousRevision =
                                                                                      revisions.find(
                                                                                          (r) =>
                                                                                              r.id ===
                                                                                              previous?.revision
                                                                                      )
                                                                                  if (
                                                                                      previousRevision ||
                                                                                      incoming.date.slice(0, 10) <
                                                                                          repository.trackingStart
                                                                                  ) {
                                                                                      const retainDiff =
                                                                                          (yield* local(() =>
                                                                                              store.patch(incoming.id)
                                                                                          )) !== undefined
                                                                                      const id = yield* records
                                                                                          .capture(incoming.id, {
                                                                                              retainDiff,
                                                                                              background: true
                                                                                          })
                                                                                          .pipe(
                                                                                              Effect.catchAll(
                                                                                                  (error) =>
                                                                                                      error instanceof
                                                                                                      GitLabFailure
                                                                                                          ? Effect.logWarning(
                                                                                                                error.message
                                                                                                            ).pipe(
                                                                                                                Effect.as(
                                                                                                                    undefined
                                                                                                                )
                                                                                                            )
                                                                                                          : Effect.fail(
                                                                                                                error
                                                                                                            )
                                                                                              )
                                                                                          )
                                                                                      if (!id) continue

                                                                                      const current = (yield* local(
                                                                                          () =>
                                                                                              store.activity(
                                                                                                  incoming.id
                                                                                              )
                                                                                      ))!
                                                                                      const revision = (yield* local(
                                                                                          () =>
                                                                                              store.revisions(
                                                                                                  incoming.id
                                                                                              )
                                                                                      )).find((r) => r.id === id)
                                                                                      const changed =
                                                                                          previous?.fingerprint
                                                                                              ? previous.fingerprint !==
                                                                                                current.fingerprint
                                                                                              : previousRevision &&
                                                                                                revision &&
                                                                                                (previousRevision.head !==
                                                                                                    revision.head ||
                                                                                                    previousRevision.base !==
                                                                                                        revision.base)
                                                                                      if (changed)
                                                                                          current.date =
                                                                                              new Date().toISOString()
                                                                                      else if (
                                                                                          previous &&
                                                                                          previous.date > current.date
                                                                                      )
                                                                                          current.date = previous.date
                                                                                      yield* local(() =>
                                                                                          store.updateActivityDate(
                                                                                              current.id,
                                                                                              current.date,
                                                                                              current.sourceVersion,
                                                                                              generation
                                                                                          )
                                                                                      )
                                                                                  }
                                                                              }
                                                                          }),
                                                                      checkpoint: (page, complete, offset) =>
                                                                          Effect.gen(function* () {
                                                                              yield* check
                                                                              status.page = page
                                                                              status.offset = offset
                                                                              if (
                                                                                  complete &&
                                                                                  !Object.keys(status.incomplete ?? {})
                                                                                      .length
                                                                              ) {
                                                                                  status.historySince =
                                                                                      repository.trackingStart
                                                                                  status.since = new Date(
                                                                                      Math.max(
                                                                                          Date.parse(
                                                                                              repository.trackingStart
                                                                                          ),
                                                                                          Date.parse(
                                                                                              status.windowEnd!
                                                                                          ) -
                                                                                              2 * 86400000
                                                                                      )
                                                                                  )
                                                                                      .toISOString()
                                                                                      .slice(0, 10)
                                                                                  status.windowEnd = undefined
                                                                              }
                                                                              yield* checkpoint(key, status, generation)
                                                                          })
                                                                  }
                                                              )
                                                          })
                                                yield* batch.pipe(
                                                    Effect.matchEffect({
                                                        onSuccess: () =>
                                                            Effect.sync(() => {
                                                                if (stopped(key, token, generation)) return
                                                                status.status = Object.keys(status.incomplete ?? {})
                                                                    .length
                                                                    ? 'error'
                                                                    : 'idle'
                                                                if (status.status === 'error')
                                                                    status.error =
                                                                        'Some contribution evidence exceeds acquisition limits. Open the provider for complete details.'
                                                                if (!status.windowEnd)
                                                                    status.lastSuccess = new Date().toISOString()
                                                            }),
                                                        onFailure: (error) =>
                                                            Effect.gen(function* () {
                                                                if (stopped(key, token, generation)) return
                                                                if (provider === 'git') {
                                                                    const persisted = yield* local(() =>
                                                                        store.acquisitionCheckpoint(key)
                                                                    ).pipe(
                                                                        Effect.catchAll(() => {
                                                                            checkpointSafe = false
                                                                            return Effect.succeed(undefined)
                                                                        })
                                                                    )
                                                                    if (persisted) {
                                                                        for (const field of Object.keys(status))
                                                                            Reflect.deleteProperty(status, field)
                                                                        Object.assign(status, persisted)
                                                                    }
                                                                }
                                                                status.status =
                                                                    error instanceof HttpError && error.retryAt
                                                                        ? 'paused'
                                                                        : 'error'
                                                                status.error = error.message
                                                                status.retryAt =
                                                                    error instanceof HttpError && error.retryAt
                                                                        ? new Date(error.retryAt).toISOString()
                                                                        : undefined
                                                                if (
                                                                    provider === 'git' &&
                                                                    /bad object|bad revision|unknown revision|not a valid object/i.test(
                                                                        error.message
                                                                    )
                                                                )
                                                                    status.gitCursor = undefined
                                                                if (
                                                                    provider === 'git' &&
                                                                    /not a git repository|ENOENT|cannot change to/i.test(
                                                                        error.message
                                                                    )
                                                                )
                                                                    yield* local(() =>
                                                                        store.repositoryUnavailable(
                                                                            repository.id,
                                                                            configuration,
                                                                            generation
                                                                        )
                                                                    )
                                                            })
                                                    }),
                                                    Effect.ensuring(
                                                        Effect.gen(function* () {
                                                            if (checkpointSafe && store.generation === generation)
                                                                yield* checkpoint(key, status, generation).pipe(
                                                                    Effect.orDie
                                                                )
                                                        })
                                                    )
                                                )
                                            }),
                                        () => Queue.offer(lanes[provider], undefined)
                                    )
                                }
                            }).pipe(http.withBackgroundTurn, (operation) => untilStopped(key, operation))
                        )
                    const rounds = (provider: 'git' | 'remote') =>
                        Effect.gen(function* () {
                            let first = true
                            for (;;) {
                                if (store.config.settings.timezone !== config.settings.timezone) return
                                const entries = repositories.flatMap((repository) =>
                                    keys
                                        .filter(
                                            (key) =>
                                                key === `${provider}:${repository.id}` &&
                                                (first ||
                                                    (statusFor(key).windowEnd && statusFor(key).status === 'idle'))
                                        )
                                        .map((key) => ({ key, repository }))
                                )
                                if (provider === 'remote')
                                    entries.sort(
                                        (a, b) =>
                                            (statusFor(a.key).lastProgressAt ?? 0) -
                                            (statusFor(b.key).lastProgressAt ?? 0)
                                    )
                                if (!entries.length) return
                                yield* Effect.forEach(entries, ({ key, repository }) => acquire(key, repository), {
                                    concurrency: 2,
                                    discard: true
                                })
                                if (!options.since) return
                                first = false
                            }
                        })
                    const jobs = [rounds('git'), rounds('remote')]
                    if (
                        !options.missingOnly &&
                        !options.repositoryId &&
                        (!options.source || options.source === 'notion') &&
                        connections().notion
                    )
                        jobs.push(
                            source('notion').lane.withPermits(1)(
                                Effect.gen(function* () {
                                    const saves = yield* local(() => store.publications())
                                    for (const id of new Set(
                                        saves.filter((s) => s.status === 'confirmed').map((s) => s.entryId)
                                    )) {
                                        if (!id || store.generation !== generation || suspensions.size) continue
                                        const previous = yield* local(() => store.entry(`notion:${id}`))
                                        const entry = yield* notion.refreshEntry(id)
                                        yield* local(() => store.refreshEntry(entry, generation, previous))
                                    }
                                    for (const save of saves.filter((s) => s.status === 'unknown'))
                                        yield* publishing.reconcile(save.id)
                                }).pipe(
                                    Effect.catchAll((error) =>
                                        checkpoint('notion', { status: 'error', error: error.message }, generation)
                                    )
                                )
                            )
                        )
                    yield* Effect.all(jobs, { concurrency: 4, discard: true })
                    const errors = Object.entries(store.config.acquisition)
                        .filter(([, status]) => status.status !== 'cancelled' && status.error)
                        .map(([key, status]) => `${key}: ${status.error}`)
                    yield* local(() =>
                        store.saveProgress(
                            {
                                refreshError: errors.length ? errors.join('\n') : undefined,
                                ...(acquired &&
                                !errors.length &&
                                !Object.values(store.config.acquisition).some((status) => status.windowEnd)
                                    ? { lastRefreshed: new Date().toISOString() }
                                    : {})
                            },
                            generation
                        )
                    )
                    return undefined
                })
                const prepare = Effect.acquireRelease(Effect.succeed([] as string[]), (owned) =>
                    Effect.gen(function* () {
                        for (const key of owned) {
                            if (store.generation !== generation) continue
                            const admission = source(key),
                                status = statusFor(key)
                            if (
                                --admission.pending === 0 &&
                                status.status === 'running' &&
                                store.generation === generation
                            ) {
                                status.status = 'idle'
                                yield* checkpoint(key, status, generation).pipe(Effect.orDie)
                            }
                        }
                    })
                ).pipe(
                    Effect.tap((owned) =>
                        Effect.gen(function* () {
                            for (const key of keys) {
                                if (!statuses.has(key))
                                    statuses.set(
                                        key,
                                        (yield* local(() => store.acquisitionCheckpoint(key))) ?? { status: 'idle' }
                                    )
                                const admission = source(key),
                                    status = statusFor(key)
                                admission.pending++
                                owned.push(key)
                                if (
                                    stopped(key, tokens.get(key)!, generation) ||
                                    (status.status === 'cancelled' && !options.resume) ||
                                    (status.retryAt && Date.parse(status.retryAt) > Date.now())
                                )
                                    continue
                                const repository = repositories.find((r) => key.endsWith(':' + r.id))!
                                const configuration = key.startsWith('git:')
                                    ? gitConfiguration(repository, identity)
                                    : contributionConfiguration(repository, identity)
                                if (
                                    options.missingOnly &&
                                    options.since &&
                                    status.historySince &&
                                    status.historySince <= options.since &&
                                    status.historyTimezone === config.settings.timezone &&
                                    status.configuration === configuration
                                )
                                    continue
                                status.status = 'running'
                                yield* checkpoint(key, status, generation)
                            }
                        })
                    ),
                    Effect.as(perform)
                )
                yield* shared(signature, prepare, ready)
            })
        const backfill = (repositoryId: string, since: string) =>
            Effect.gen(function* () {
                const repository = store.config.repositories.find((r) => r.id === repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                if (since > repository.trackingStart)
                    return yield* Effect.fail(new JournalError('Choose a date before the current history start.'))
                yield* refresh({ repositoryId, since, resume: true })
            })
        const startRefresh = (options: RefreshOptions = {}) =>
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
