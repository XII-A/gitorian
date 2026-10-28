import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { makeSharedRequests } from './shared-requests'
import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { RemoteContributions } from './remote-contributions'
import { remoteConfiguration, providerRemote } from '../shared/provider-accounts'
import { JournalError, JournalStore } from './journal-context'
import { commitDetails } from './git'
import { filesFromDiff } from './diff-files'
import { hasFileStatistics } from '../shared/change-statistics'
import { isCombinedDiff } from '../shared/diff-format'
import type { Activity } from '../shared/model'
export interface ActivityRecords {
    readonly capture: (
        activityId: string,
        options?: {
            retainDiff?: boolean
            background?: boolean
        }
    ) => Effect.Effect<string, JournalFailure>
    readonly details: (
        activityId: string,
        includeDiff: boolean
    ) => Effect.Effect<
        {
            diff?: string
        },
        JournalFailure
    >
}
export const ActivityRecords = Context.GenericTag<ActivityRecords>('gitorian/ActivityRecords')
export const ActivityRecordsLive = Layer.scoped(
    ActivityRecords,
    Effect.gen(function* () {
        const store = yield* JournalStore
        const github = yield* RemoteContributions
        const lease = (activity: Activity) => {
            if (!activity.remoteSource) return activity
            const repository = store.config.repositories.find((r) => r.id === activity.repositoryId)
            const account = store.config.accounts.find((a) => a.id === repository?.accountId)
            if (
                !repository ||
                !account ||
                account.provider !== activity.remoteSource.provider ||
                account.host !== activity.remoteSource.host
            )
                return activity
            return {
                ...activity,
                remoteSource: {
                    ...activity.remoteSource,
                    configuration: remoteConfiguration(repository),
                    accountId: account.id,
                    sessionGeneration: account.generation
                }
            }
        }
        const sharedDetails = yield* makeSharedRequests<string, undefined, Error>(
            () => new JournalError('Activity records are closed')
        )
        const local = <A>(operation: () => Promise<A>) =>
            Effect.tryPromise({
                try: operation,
                catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
            })
        const capture = (
            activityId: string,
            options: { retainDiff?: boolean; background?: boolean } = {}
        ): Effect.Effect<string, Error> =>
            Effect.gen(function* () {
                const generation = store.generation
                const stored = yield* local(() => store.activity(activityId))
                const activity = stored && lease(stored)
                if (!activity) return yield* Effect.fail(new JournalError('Work is no longer available'))
                const repository = store.config.repositories.find((r) => r.id === activity.repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                const snapshot = yield* github.snapshot(repository, activity, options.background)
                const revisions = yield* local(() => store.revisions(activity.id))
                const prior = snapshot.fingerprint
                    ? revisions.find((r) => r.fingerprint === snapshot.fingerprint)
                    : undefined
                const id = prior?.id ?? randomUUID()
                const retain = options.retainDiff ?? true
                Object.assign(activity, { revision: id, fingerprint: snapshot.fingerprint, head: snapshot.head })
                if (retain) {
                    activity.diffRevision = id
                    if (!hasFileStatistics(activity)) {
                        const files = filesFromDiff(snapshot.diff)
                        if (files) {
                            activity.files = files
                            activity.filesLoaded = true
                        }
                    }
                }
                yield* local(() =>
                    store.recordActivityDetails(
                        activity,
                        retain ? snapshot.diff : undefined,
                        { id, activityId: activity.id, ...snapshot, diff: retain ? snapshot.diff : '' },
                        generation
                    )
                )
                return id
            })
        const loadDetails = (activity: Activity, includeDiff: boolean): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const readLease = activity.remoteSource
                const generation = store.generation
                const repository = store.config.repositories.find((r) => r.id === activity.repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                let diff: string | undefined
                if (activity.kind === 'change-request') {
                    if (includeDiff) {
                        yield* capture(activity.id)
                        const refreshed = (yield* local(() => store.activity(activity.id)))!
                        activity = { ...refreshed, remoteSource: readLease ?? refreshed.remoteSource }
                    }
                    if (!hasFileStatistics(activity)) activity.files = yield* github.files(repository, activity)
                } else if (activity.sha) {
                    const sha = activity.sha
                    const details = yield* (
                        repository.available
                            ? local(() => commitDetails(repository, sha, includeDiff))
                            : Effect.fail(new JournalError('Local checkout unavailable'))
                    ).pipe(
                        Effect.catchAll(
                            (localError): Effect.Effect<{ diff: string; files: Activity['files'] }, Error> => {
                                if (!providerRemote(repository.remote) || !repository.accountId)
                                    return Effect.fail(
                                        new JournalError(
                                            'Local changes are unavailable (' +
                                                localError.message +
                                                '). Locate the repository, or connect GitHub and select its remote in Settings.'
                                        )
                                    )
                                return github.commitDetails(
                                    activity.remoteSource
                                        ? {
                                              ...repository,
                                              remote: `https://${activity.remoteSource.host}/${activity.remoteSource.path}`,
                                              providerProjectId: activity.remoteSource.projectId
                                          }
                                        : repository,
                                    sha,
                                    includeDiff
                                )
                            }
                        )
                    )
                    if (includeDiff) diff = details.diff
                    activity.files = details.files
                } else if (activity.changeRequestId) activity.files = yield* github.files(repository, activity)
                activity.filesLoaded = true
                yield* local(() => store.recordActivityDetails(activity, diff, undefined, generation))
            })
        const details = (activityId: string, includeDiff: boolean): Effect.Effect<{ diff?: string }, Error> =>
            Effect.gen(function* () {
                const stored = yield* local(() => store.activity(activityId))
                const activity = stored && lease(stored)
                if (!activity) return yield* Effect.fail(new JournalError('Work is no longer available'))
                const patch = includeDiff ? yield* local(() => store.patch(activity.id)) : undefined
                const cached = includeDiff
                    ? patch !== undefined &&
                      !isCombinedDiff(patch) &&
                      (activity.kind !== 'change-request' || activity.diffRevision === activity.revision)
                    : hasFileStatistics(activity)
                if (!cached)
                    yield* sharedDetails(
                        JSON.stringify([
                            store.generation,
                            activity.id,
                            activity.sourceVersion ?? activity.sha ?? '',
                            remoteConfiguration(store.config.repositories.find((r) => r.id === activity.repositoryId)!),
                            activity.remoteSource?.sessionGeneration,
                            activity.remoteSource?.projectId,
                            activity.remoteSource?.path,
                            includeDiff
                        ]),
                        Effect.succeed(loadDetails(activity, includeDiff).pipe(Effect.as(undefined)))
                    )
                return includeDiff ? { diff: (yield* local(() => store.patch(activity.id))) ?? '' } : {}
            })
        return {
            capture: Effect.fn('ActivityRecords.capture')(capture, Effect.mapError(toJournalFailure)),
            details: Effect.fn('ActivityRecords.details')(details, Effect.mapError(toJournalFailure))
        }
    })
)
