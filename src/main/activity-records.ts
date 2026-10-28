import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { makeSharedRequests } from './shared-requests'
import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { GitHub } from './github'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
import { commitDetails, githubRemote } from './git'
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
        const github = yield* GitHub
        const connections = (yield* ConnectionState).snapshot
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
                const activity = yield* local(() => store.activity(activityId))
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
                        { id, prId: activity.id, ...snapshot, diff: retain ? snapshot.diff : '' },
                        generation
                    )
                )
                return id
            })
        const loadDetails = (activity: Activity, includeDiff: boolean): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const generation = store.generation
                const repository = store.config.repositories.find((r) => r.id === activity.repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                let diff: string | undefined
                if (activity.kind === 'pr') {
                    if (includeDiff) {
                        yield* capture(activity.id)
                        activity = (yield* local(() => store.activity(activity.id)))!
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
                                if (!githubRemote(repository.remote) || !connections().github)
                                    return Effect.fail(
                                        new JournalError(
                                            'Local changes are unavailable (' +
                                                localError.message +
                                                '). Locate the repository, or connect GitHub and select its remote in Settings.'
                                        )
                                    )
                                return github.commitDetails(repository, sha, includeDiff)
                            }
                        )
                    )
                    if (includeDiff) diff = details.diff
                    activity.files = details.files
                } else if (activity.prId) activity.files = yield* github.files(repository, activity)
                activity.filesLoaded = true
                yield* local(() => store.recordActivityDetails(activity, diff, undefined, generation))
            })
        const details = (activityId: string, includeDiff: boolean): Effect.Effect<{ diff?: string }, Error> =>
            Effect.gen(function* () {
                const activity = yield* local(() => store.activity(activityId))
                if (!activity) return yield* Effect.fail(new JournalError('Work is no longer available'))
                const patch = includeDiff ? yield* local(() => store.patch(activity.id)) : undefined
                const cached = includeDiff
                    ? patch !== undefined &&
                      !isCombinedDiff(patch) &&
                      (activity.kind !== 'pr' || activity.diffRevision === activity.revision)
                    : hasFileStatistics(activity)
                if (!cached)
                    yield* sharedDetails(
                        JSON.stringify([
                            store.generation,
                            activity.id,
                            activity.sourceVersion ?? activity.sha ?? '',
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
