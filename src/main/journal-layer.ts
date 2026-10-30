import type { downloadImage } from './images'
import { NotionRequestsLive } from './notion-request'
import { ApplicationWorkLive } from './application-work'
import { type Effect, Layer } from 'effect'
import { JournalStore, ConnectionState } from './journal-context'
import { HttpLive } from './http'
import { ProviderAccountsLive, type ProviderVault } from './provider-accounts'
import { RemoteContributionsLive } from './remote-contributions'
import { NotionLive } from './notion'
import { ActivityRecordsLive } from './activity-records'
import { JournalPublishingLive } from './journal-publishing'
import { ActivityAcquisitionLive } from './activity-acquisition'
import { JournalLive } from './service'
import type { Reply } from '../shared/model'
import type { JournalDatabase } from './journal-database'

/** One acyclic graph, shared by Electron and fixtures. */
export const JournalModulesLive = JournalLive.pipe(
    Layer.provideMerge(
        ActivityAcquisitionLive.pipe(Layer.provideMerge(Layer.merge(ActivityRecordsLive, JournalPublishingLive)))
    ),
    Layer.provideMerge(ApplicationWorkLive)
)

export interface JournalAdapters {
    store: JournalDatabase
    fetcher?: typeof fetch
    imageDownload?: typeof downloadImage
    vault: ProviderVault
    gitlabClientId?: string
    notionToken: (refresh?: boolean, rejected?: string) => Effect.Effect<string, Error>
    connections: () => Reply['connections']
}

export function journalLayer(adapters: JournalAdapters) {
    const native = Layer.mergeAll(
        Layer.succeed(JournalStore, adapters.store),
        Layer.succeed(ConnectionState, { snapshot: adapters.connections }),
        HttpLive(adapters.fetcher, {
            pauses: () => adapters.store.config.transportPauses,
            changed: (scope, until) => adapters.store.savePause(scope, until).then(() => undefined)
        })
    )
    const accounts = ProviderAccountsLive({
        vault: adapters.vault,
        fetcher: adapters.fetcher,
        gitlabClientId: adapters.gitlabClientId
    }).pipe(Layer.provideMerge(native))
    const providers = Layer.mergeAll(
        RemoteContributionsLive,
        NotionLive(adapters.notionToken, adapters.store, adapters.imageDownload),
        NotionRequestsLive(adapters.notionToken)
    ).pipe(Layer.provideMerge(accounts))
    return JournalModulesLive.pipe(Layer.provideMerge(providers))
}
