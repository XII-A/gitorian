import { JournalError } from './journal-context'
import { DurabilityError } from './durability-error'
import { isNotionError } from './notion'
import type { NotionError } from './notion'
import { WorkBusy, WorkClosed } from './application-work'
export type JournalFailure = JournalError | DurabilityError | NotionError | WorkBusy | WorkClosed
export function toJournalFailure(error: unknown): JournalFailure {
    if (
        error instanceof JournalError ||
        error instanceof DurabilityError ||
        error instanceof WorkBusy ||
        error instanceof WorkClosed ||
        isNotionError(error)
    )
        return error
    return new JournalError(error instanceof Error ? error.message : String(error), { cause: error })
}
