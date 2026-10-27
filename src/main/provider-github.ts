import { Effect } from 'effect'
import type { GitHub, ActivityScan } from './github'
type Execute<F> = F extends (...args: infer A) => Effect.Effect<infer R, infer _E, infer _C>
    ? (...args: A) => Promise<R>
    : never
export interface ProviderActivityScan extends Omit<ActivityScan, 'checkpoint' | 'batch'> {
    checkpoint?: (page: number, complete: boolean) => void
    batch?: (items: Parameters<NonNullable<ActivityScan['batch']>>[0]) => Promise<void>
}
export type ProviderGitHub = Omit<{ [K in keyof GitHub]: Execute<GitHub[K]> }, 'activities'> & {
    activities: (
        repository: Parameters<GitHub['activities']>[0],
        login: string,
        trackedPrIds: string[],
        scan?: ProviderActivityScan
    ) => ReturnType<Execute<GitHub['activities']>>
}
const failure = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
/** Temporary execution seam for the journal's remaining Promise caller. Removed with its migration. */
export const bindGitHub = (
    operations: GitHub,
    execute: <A, E>(operation: Effect.Effect<A, E>) => Promise<A>
): ProviderGitHub => ({
    start: (...args) => execute(operations.start(...args)),
    poll: (...args) => execute(operations.poll(...args)),
    activities: (repository, login, trackedPrIds, scan) =>
        execute(
            operations.activities(
                repository,
                login,
                trackedPrIds,
                scan
                    ? {
                          ...scan,
                          checkpoint: scan.checkpoint
                              ? (...args) => Effect.try({ try: () => scan.checkpoint!(...args), catch: failure })
                              : undefined,
                          batch: scan.batch
                              ? (...args) => Effect.tryPromise({ try: () => scan.batch!(...args), catch: failure })
                              : undefined
                      }
                    : undefined
            )
        ),
    files: (...args) => execute(operations.files(...args)),
    commitDetails: (...args) => execute(operations.commitDetails(...args)),
    snapshot: (...args) => execute(operations.snapshot(...args))
})
