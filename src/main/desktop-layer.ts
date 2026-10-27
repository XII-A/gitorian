import { NotionRequests, makeNotionRequests } from './notion-request'
import { Effect, Layer } from 'effect'
import { Http, HttpLive } from './http'
import { GitHubLive } from './github'
import { Notion, makeNotion } from './notion'
import { NotionConnection, NotionConnectionLive } from './notion-connection'
import type { ConnectionAdapters } from './notion-connection'
import { ConnectionState, JournalStore } from './journal-context'
import { JournalModulesLive } from './journal-layer'
import type { Store } from './store'
import type { Vault } from './vault'

/** Native adapters and scoped modules are assembled once for the desktop lifetime. */
export function desktopLayer(store: Store, vault: Vault, connection: Omit<ConnectionAdapters, 'vault'>) {
    const native = Layer.mergeAll(
        Layer.scope,
        Layer.succeed(JournalStore, store),
        HttpLive(connection.fetcher, {
            pauses: () => (store.state.transportPauses ??= {}),
            changed: () => {
                store.persist()
            }
        })
    )
    const authorization = NotionConnectionLive({ ...connection, vault }).pipe(Layer.provideMerge(native))
    const providers = Layer.mergeAll(
        GitHubLive(
            () => vault.get('github'),
            (token) => {
                vault.set('github', token)
            },
            connection.fetcher
        ),
        Layer.effect(
            Notion,
            Effect.gen(function* () {
                const http = yield* Http
                const installed = yield* NotionConnection
                return makeNotion(http, installed.token, store)
            })
        ),
        Layer.effect(
            NotionRequests,
            Effect.gen(function* () {
                const http = yield* Http
                const installed = yield* NotionConnection
                return makeNotionRequests(http, installed.token)
            })
        ),
        Layer.effect(
            ConnectionState,
            Effect.map(NotionConnection, (installed) => ({
                snapshot: () => ({
                    github: !!vault.get('github'),
                    notion: installed.connected(),
                    protectedStorage: vault.protected()
                })
            }))
        )
    ).pipe(Layer.provideMerge(authorization))
    return JournalModulesLive.pipe(Layer.provideMerge(providers))
}
export type DesktopEnvironment = Layer.Layer.Success<ReturnType<typeof desktopLayer>>
