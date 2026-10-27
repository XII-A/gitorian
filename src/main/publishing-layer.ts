import { Layer } from 'effect'
import { ApplicationWorkLive } from './application-work'
import { HttpLive } from './http'
import { JournalStore, ConnectionState } from './journal-context'
import { NotionLive } from './notion'
import { NotionRequestsLive } from './notion-request'
import type { NotionToken } from './notion-request'
import { JournalPublishingLive } from './journal-publishing'
import type { Store } from './store'
import type { Reply } from '../shared/model'
import type { downloadImage } from './images'
export interface PublishingAdapters {
    store: Store
    fetcher?: typeof fetch
    imageDownload?: typeof downloadImage
    notionToken: NotionToken
    connections: () => Reply['connections']
}
/** Shared native provider/publishing graph; the journal command caller migrates in the final stage. */
export function publishingLayer(adapters: PublishingAdapters) {
    const native = Layer.mergeAll(
        ApplicationWorkLive,
        Layer.succeed(JournalStore, adapters.store),
        Layer.succeed(ConnectionState, { snapshot: adapters.connections }),
        HttpLive(adapters.fetcher, {
            pauses: () => (adapters.store.state.transportPauses ??= {}),
            changed: () => {
                adapters.store.persist()
            }
        })
    )
    const providers = Layer.merge(
        NotionLive(adapters.notionToken, adapters.store, adapters.imageDownload),
        NotionRequestsLive(adapters.notionToken)
    ).pipe(Layer.provideMerge(native))
    return JournalPublishingLive.pipe(Layer.provideMerge(providers))
}
export type PublishingEnvironment = Layer.Layer.Success<ReturnType<typeof publishingLayer>>
