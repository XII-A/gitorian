import type { Effect } from 'effect'
import type { Activity, Repository } from '../shared/model'

export interface ActivityScan {
    incomplete?: Record<string, string>
    recordIncomplete?: (key: string, reason: string) => Effect.Effect<void, Error>
    pending?: { key: string; pages: Record<string, unknown> }
    savePending?: (pending: { key: string; pages: Record<string, unknown> } | undefined) => Effect.Effect<void, Error>
    timezone?: string
    since?: string
    page?: number
    offset?: number
    versions?: Record<string, string>
    background?: boolean
    checkpoint?: (page: number, complete: boolean, offset?: number) => Effect.Effect<void, Error>
    batch?: (activities: Activity[]) => Effect.Effect<void, Error>
}

/** Provider-neutral contribution reads; authorization and durable writes have separate owners. */
export interface ContributionReader {
    activities: (
        repository: Repository,
        username: string,
        tracked: string[],
        scan?: ActivityScan
    ) => Effect.Effect<Activity[], Error>
    files: (repository: Repository, activity: Activity) => Effect.Effect<Activity['files'], Error>
    snapshot: (
        repository: Repository,
        activity: Activity,
        background?: boolean
    ) => Effect.Effect<{ diff: string; base: string; head: string; fingerprint?: string }, Error>
    commitDetails: (
        repository: Repository,
        sha: string,
        includeDiff?: boolean
    ) => Effect.Effect<{ files: Activity['files']; diff: string }, Error>
}
