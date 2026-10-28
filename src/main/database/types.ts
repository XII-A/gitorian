import type { Activity, State } from '../../shared/model'
import type { GitHistory } from '../git'

export interface JournalView {
    since: string
    until: string
    activityId?: string
    entryId?: string
    cursor?: { instant: number; id: string }
    limit?: number
}
export interface Configuration {
    generation: string
    sequence: number
    settings: State['settings']
    repositories: State['repositories']
    acquisition: NonNullable<State['acquisition']>
    transportPauses: Record<string, number>
    repositoryImport?: State['repositoryImport']
    lastRefreshed?: string
    lastRefreshAttempt?: string
    refreshError?: string
}
export interface AcquisitionBatch {
    source?: { repositoryId: string; provider: 'git' | 'github'; configuration: string }
    repository?: State['repositories'][number]
    activities?: Activity[]
    checkpoint?: { key: string; value: NonNullable<State['acquisition']>[string] }
    history?: GitHistory
}
export class DatabaseError extends Error {
    constructor(
        readonly code: 'conflict' | 'generation' | 'storage' | 'invalid' | 'schema',
        message: string
    ) {
        super(message)
        this.name = 'DatabaseError'
    }
}
