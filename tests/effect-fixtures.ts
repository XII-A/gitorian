import { NotionRequests } from '../src/main/notion-request'
import { afterEach } from 'vitest'
import { Cause, Effect, Exit, ManagedRuntime } from 'effect'
import { Http, HttpLive } from '../src/main/http'

const lifetimes = new Set<() => Promise<void>>()
afterEach(async () => {
    await Promise.all([...lifetimes].map((close) => close()))
    lifetimes.clear()
})

/** Fixtures execute the same scoped module Layer used by Electron. */
export async function transportClient(...adapters: Parameters<typeof HttpLive>): Promise<Http> {
    const runtime = ManagedRuntime.make(HttpLive(...adapters))
    lifetimes.add(() => runtime.dispose())
    return runtime.runPromise(Http)
}

export async function run<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(operation)
    if (Exit.isSuccess(exit)) return exit.value
    const error = Cause.squash(exit.cause)
    throw error
}
import { makeGitHub, type GitHub } from '../src/main/github'
import { Layer } from 'effect'

export function githubClient(http: Http, credential: () => string): Promise<GitHub> {
    return Promise.resolve(
        makeGitHub(<A>(url: string, init: RequestInit = {}, format: 'json' | 'text' = 'json', background = false) =>
            http.request<A>(url, credential(), init, format, {
                background,
                maxBytes: format === 'text' ? 2_000_000 : undefined
            })
        )
    )
}
import { makeNotion } from '../src/main/notion'
import type { JournalDatabase } from '../src/main/journal-database'
import { downloadImage } from '../src/main/images'

export function notionClient(
    http: Http,
    token: (refresh?: boolean, rejected?: string) => string | Promise<string>,
    images?: Pick<JournalDatabase, 'image' | 'importImage'>,
    imageDownload = downloadImage
) {
    return makeNotion(
        http,
        (refresh, rejected) =>
            Effect.tryPromise({
                try: () => Promise.resolve(token(refresh, rejected)),
                catch: (error) => (error instanceof Error ? error : new Error(String(error)))
            }),
        images,
        imageDownload
    )
}
import { ProviderAccountsLive } from '../src/main/provider-accounts'
import { RemoteContributions } from '../src/main/remote-contributions'
import { JournalStore, ConnectionState } from '../src/main/journal-context'
import { JournalModulesLive } from '../src/main/journal-layer'
import { JournalService } from '../src/main/service'
import { Notion } from '../src/main/notion'
import type { Reply } from '../src/shared/model'

export async function journalClient(
    store: JournalDatabase,
    github: RemoteContributions,
    notion: Notion,
    connections: () => Reply['connections'],
    requests: NotionRequests
) {
    const providers = Layer.mergeAll(
        Layer.succeed(JournalStore, store),
        Layer.succeed(RemoteContributions, github),
        Layer.succeed(Notion, notion),
        Layer.succeed(NotionRequests, requests),
        Layer.succeed(ConnectionState, { snapshot: connections })
    )
    const accountLayer = ProviderAccountsLive({
        vault: {
            get: () => JSON.stringify({ access_token: 'test-token' }),
            set: () => undefined,
            protected: () => false
        }
    }).pipe(Layer.provideMerge(Layer.merge(Layer.succeed(JournalStore, store), HttpLive())))
    const runtime = ManagedRuntime.make(
        JournalModulesLive.pipe(Layer.provideMerge(providers), Layer.provideMerge(accountLayer))
    )
    lifetimes.add(() => runtime.dispose())
    return runtime.runPromise(JournalService)
}
