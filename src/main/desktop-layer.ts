import { NotionRequests, makeNotionRequests } from './notion-request'
import { Effect, Layer } from 'effect'
import { Http, HttpLive } from './http'
import { ProviderAccountsLive } from './provider-accounts'
import { RemoteContributionsLive } from './remote-contributions'
import { Notion, makeNotion } from './notion'
import { NotionConnection, NotionConnectionLive } from './notion-connection'
import type { ConnectionAdapters } from './notion-connection'
import { ConnectionState, JournalStore } from './journal-context'
import { JournalModulesLive } from './journal-layer'
import type { JournalDatabase } from './journal-database'
import type { Vault } from './vault'

/** Native adapters and scoped modules are assembled once for the desktop lifetime. */
export function desktopLayer(
    store: JournalDatabase,
    vault: Vault,
    connection: Omit<ConnectionAdapters, 'vault'> & { gitlabClientId?: string }
) {
    const native = Layer.mergeAll(
        Layer.scope,
        Layer.succeed(JournalStore, store),
        HttpLive(connection.fetcher, {
            pauses: () => store.config.transportPauses,
            changed: (scope, until) => store.savePause(scope, until).then(() => undefined)
        })
    )
    const authorization = Layer.merge(
        NotionConnectionLive({ ...connection, vault }),
        ProviderAccountsLive({ vault, fetcher: connection.fetcher, gitlabClientId: connection.gitlabClientId })
    ).pipe(Layer.provideMerge(native))
    const providers = Layer.mergeAll(
        RemoteContributionsLive,
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
                    remote: store.config.accounts.some(
                        (a) =>
                            ['connected', 'session'].includes(a.status) &&
                            !!a.credentialKey &&
                            !!vault.get(a.credentialKey)
                    ),
                    notion: installed.connected(),
                    protectedStorage: vault.protected()
                })
            }))
        )
    ).pipe(Layer.provideMerge(authorization))
    return JournalModulesLive.pipe(Layer.provideMerge(providers))
}
export type DesktopEnvironment = Layer.Layer.Success<ReturnType<typeof desktopLayer>>
