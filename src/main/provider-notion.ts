import type { Effect } from 'effect'
import type { Notion } from './notion'
/** Read and setup operations consumed by the remaining Promise journal and desktop callers. */
type Operations = Pick<
    Notion,
    | 'prepareJournal'
    | 'accessiblePages'
    | 'destinationIcon'
    | 'describeDestination'
    | 'profile'
    | 'verifyDestination'
    | 'refreshEntry'
>
export type ProviderNotion = {
    [K in keyof Operations]: (
        ...args: Parameters<Operations[K]>
    ) => Promise<Effect.Effect.Success<ReturnType<Operations[K]>>>
}
export interface ProviderPublishing {
    readonly publish: (draftId: string) => Promise<void>
    readonly reconcile: (saveId: string) => Promise<void>
}
