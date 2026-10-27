import { afterEach } from 'vitest'
import { Layer, ManagedRuntime } from 'effect'
import { run } from './effect-fixtures'
import { Notion } from '../src/main/notion'
import { NotionRequests } from '../src/main/notion-request'
import { JournalStore, ConnectionState } from '../src/main/journal-context'
import { JournalPublishing, JournalPublishingLive } from '../src/main/journal-publishing'
import type { Store } from '../src/main/store'
import type { Reply } from '../src/shared/model'
import type { ProviderNotion, ProviderPublishing } from '../src/main/provider-notion'
const lifetimes = new Set<() => Promise<void>>()
afterEach(async () => {
    await Promise.all([...lifetimes].map((close) => close()))
    lifetimes.clear()
})
export const bindNotion = (operations: Notion): ProviderNotion => ({
    prepareJournal: (...args) => run(operations.prepareJournal(...args)),
    accessiblePages: (...args) => run(operations.accessiblePages(...args)),
    destinationIcon: (...args) => run(operations.destinationIcon(...args)),
    describeDestination: (...args) => run(operations.describeDestination(...args)),
    profile: (...args) => run(operations.profile(...args)),
    verifyDestination: (...args) => run(operations.verifyDestination(...args)),
    refreshEntry: (...args) => run(operations.refreshEntry(...args))
})
export const bindPublishing = (operations: JournalPublishing): ProviderPublishing => ({
    publish: (id) => run(operations.publish(id)),
    reconcile: (id) => run(operations.reconcile(id))
})
export function createPublishingCommands(
    store: Store,
    notion: Notion,
    requests: NotionRequests,
    connections: () => Reply['connections']
): ProviderPublishing {
    const runtime = ManagedRuntime.make(
        JournalPublishingLive.pipe(
            Layer.provide(
                Layer.mergeAll(
                    Layer.succeed(JournalStore, store),
                    Layer.succeed(ConnectionState, { snapshot: connections }),
                    Layer.succeed(Notion, notion),
                    Layer.succeed(NotionRequests, requests)
                )
            )
        )
    )
    lifetimes.add(() => runtime.dispose())
    return bindPublishing(runtime.runSync(JournalPublishing))
}
