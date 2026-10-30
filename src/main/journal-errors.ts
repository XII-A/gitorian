import { JournalError } from './journal-context'
import { DurabilityError } from './durability-error'
import { GitHubFailure } from './github'
import type { GitHubError } from './github'
import { isNotionError } from './notion'
import type { NotionError } from './notion'
import { WorkBusy, WorkClosed } from './application-work'
import { ProviderAccountError } from './provider-accounts'
import { GitLabFailure } from './gitlab'
export type JournalFailure =
    | JournalError
    | DurabilityError
    | GitHubError
    | GitLabFailure
    | ProviderAccountError
    | NotionError
    | WorkBusy
    | WorkClosed
export function toJournalFailure(error: unknown): JournalFailure {
    if (
        error instanceof JournalError ||
        error instanceof DurabilityError ||
        error instanceof GitHubFailure ||
        error instanceof GitLabFailure ||
        error instanceof ProviderAccountError ||
        error instanceof WorkBusy ||
        error instanceof WorkClosed ||
        isNotionError(error)
    )
        return error
    return new JournalError(error instanceof Error ? error.message : String(error), { cause: error })
}
