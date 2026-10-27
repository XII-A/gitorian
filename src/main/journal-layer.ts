import type { downloadImage } from './images'
import { NotionRequestsLive } from './notion-request'
import { ApplicationWorkLive } from './application-work'
import { type Effect, Layer } from 'effect'
import { JournalStore, ConnectionState } from './journal-context'
import { HttpLive } from './http'
import { GitHubLive } from './github'
import { NotionLive } from './notion'
import { ActivityRecordsLive } from './activity-records'
import { JournalPublishingLive } from './journal-publishing'
import { ActivityAcquisitionLive } from './activity-acquisition'
import { JournalLive } from './service'
import type { Reply } from '../shared/model'
import type { Store } from './store'

/** One acyclic graph, shared by Electron and fixtures. */
export const JournalModulesLive = JournalLive.pipe(
    Layer.provideMerge(
        ActivityAcquisitionLive.pipe(Layer.provideMerge(Layer.merge(ActivityRecordsLive, JournalPublishingLive)))
    ),
    Layer.provideMerge(ApplicationWorkLive)
)

export interface JournalAdapters {
    store: Store
    fetcher?: typeof fetch
    imageDownload?: typeof downloadImage
    githubCredential: () => string
    setGitHubCredential: (token: string) => void
    notionToken: (refresh?: boolean, rejected?: string) => Effect.Effect<string, Error>
    connections: () => Reply['connections']
}

export function journalLayer(adapters: JournalAdapters) {
    const native = Layer.mergeAll(
        Layer.succeed(JournalStore, adapters.store),
        Layer.succeed(ConnectionState, { snapshot: adapters.connections }),
        HttpLive(adapters.fetcher, {
            pauses: () => (adapters.store.state.transportPauses ??= {}),
            changed: () => {
                adapters.store.persist()
            }
        })
    )
    const providers = Layer.mergeAll(
        GitHubLive(adapters.githubCredential, adapters.setGitHubCredential, adapters.fetcher),
        NotionLive(adapters.notionToken, adapters.store, adapters.imageDownload),
        NotionRequestsLive(adapters.notionToken)
    ).pipe(Layer.provideMerge(native))
    return JournalModulesLive.pipe(Layer.provideMerge(providers))
}
