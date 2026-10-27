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
import type { Activity, State } from '../shared/model'
/** Shared merge rules preserve journal decisions while replacing provider evidence. */
export function mergeActivities(state: State, items: Activity[]): void {
    const activities = new Map(state.activities.map((item) => [item.id, item]))
    for (const incoming of items) {
        const current = activities.get(incoming.id)
        if (!current) {
            state.activities.push(incoming)
            activities.set(incoming.id, incoming)
        } else
            Object.assign(current, incoming, {
                disposition: current.disposition,
                deferUntil: current.deferUntil,
                reason: current.reason,
                explicit: current.explicit,
                revision: incoming.revision ?? current.revision,
                fingerprint: incoming.fingerprint ?? current.fingerprint,
                deletedBranches: current.deletedBranches,
                branches: [...new Set([...current.branches, ...incoming.branches])],
                files: incoming.filesLoaded ? incoming.files : current.files,
                filesLoaded:
                    current.filesLoaded && (!incoming.sourceVersion || incoming.sourceVersion === current.sourceVersion)
            })
    }
}
export interface ActivityRecords {
    readonly capture: (
        activityId: string,
        options?: {
            retainDiff?: boolean
            persist?: boolean
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
        const capture = (
            activityId: string,
            options: {
                retainDiff?: boolean
                persist?: boolean
            } = {}
        ): Effect.Effect<string, Error> =>
            Effect.gen(function* () {
                const state = store.state
                const activity = state.activities.find((item) => item.id === activityId)
                if (!activity) return yield* Effect.fail(new JournalError('Work is no longer available'))
                const repository = state.repositories.find((item) => item.id === activity.repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                const { retainDiff = true, persist = true } = options
                const version = activity.sourceVersion
                const snapshot = yield* github.snapshot(repository, activity, !persist)
                if (state !== store.state)
                    return yield* Effect.fail(
                        new JournalError('Local data was restored while loading. Open the activity again.')
                    )
                if (version !== activity.sourceVersion)
                    return yield* Effect.fail(
                        new JournalError(
                            'Activity changed while loading. Select it again to load the current revision.'
                        )
                    )
                const prior = snapshot.fingerprint
                    ? state.revisions.find(
                          (revision) => revision.prId === activity.id && revision.fingerprint === snapshot.fingerprint
                      )
                    : state.revisions.find(
                          (revision) =>
                              revision.prId === activity.id &&
                              revision.base === snapshot.base &&
                              revision.head === snapshot.head
                      )
                const id = prior?.id ?? randomUUID()
                if (!prior)
                    state.revisions.push({ id, prId: activity.id, ...snapshot, diff: retainDiff ? snapshot.diff : '' })
                else if (retainDiff) prior.diff = snapshot.diff
                Object.assign(activity, { revision: id, fingerprint: snapshot.fingerprint, head: snapshot.head })
                if (retainDiff) {
                    state.diffs[activity.id] = snapshot.diff
                    activity.diffRevision = id
                    if (!hasFileStatistics(activity)) {
                        const files = filesFromDiff(snapshot.diff)
                        if (files !== undefined) {
                            activity.files = files
                            activity.filesLoaded = true
                        }
                    }
                }
                if (persist) store.persist()
                return id
            })
        const loadDetails = (activity: Activity, includeDiff: boolean): Effect.Effect<void, Error> =>
            Effect.gen(function* () {
                const state = store.state
                const repository = state.repositories.find((item) => item.id === activity.repositoryId)
                if (!repository) return yield* Effect.fail(new JournalError('Repository is no longer available'))
                const version = activity.sourceVersion
                if (activity.kind === 'pr') {
                    if (includeDiff) yield* capture(activity.id)
                    if (!hasFileStatistics(activity)) activity.files = yield* github.files(repository, activity)
                } else if (activity.sha) {
                    const sha = activity.sha
                    const local = repository.available
                        ? Effect.tryPromise({
                              try: () => commitDetails(repository, sha, includeDiff),
                              catch: (error) => (error instanceof Error ? error : new JournalError(String(error)))
                          })
                        : Effect.fail(new JournalError('Local checkout unavailable'))
                    const details = yield* local.pipe(
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
                    if (state !== store.state)
                        return yield* Effect.fail(
                            new JournalError('Local data was restored while loading. Open the activity again.')
                        )
                    if (includeDiff) state.diffs[activity.id] = details.diff
                    activity.files = details.files
                } else if (activity.prId) activity.files = yield* github.files(repository, activity)
                if (state !== store.state)
                    return yield* Effect.fail(
                        new JournalError('Local data was restored while loading. Open the activity again.')
                    )
                if (version !== activity.sourceVersion)
                    return yield* Effect.fail(
                        new JournalError(
                            'Activity changed while loading. Select it again to load the current revision.'
                        )
                    )
                activity.filesLoaded = true
                store.persist()
            })
        const details = (
            activityId: string,
            includeDiff: boolean
        ): Effect.Effect<
            {
                diff?: string
            },
            Error
        > =>
            Effect.gen(function* () {
                const state = store.state
                const activity = state.activities.find((item) => item.id === activityId)
                if (!activity) return yield* Effect.fail(new JournalError('Work is no longer available'))
                const cached = includeDiff
                    ? state.diffs[activity.id] !== undefined &&
                      !isCombinedDiff(state.diffs[activity.id]) &&
                      (activity.kind !== 'pr' || activity.diffRevision === activity.revision)
                    : hasFileStatistics(activity)
                if (!cached) {
                    const key = JSON.stringify([
                        state.restoreId,
                        activity.id,
                        activity.sourceVersion ?? activity.sha ?? '',
                        includeDiff
                    ])
                    yield* sharedDetails(
                        key,
                        Effect.succeed(loadDetails(activity, includeDiff).pipe(Effect.as(undefined)))
                    )
                }
                return includeDiff ? { diff: state.diffs[activity.id] ?? '' } : {}
            })
        return {
            capture: Effect.fn('ActivityRecords.capture')(capture, Effect.mapError(toJournalFailure)),
            details: Effect.fn('ActivityRecords.details')(details, Effect.mapError(toJournalFailure))
        }
    })
)
