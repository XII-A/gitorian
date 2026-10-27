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
import { GitHub, GitHubLive } from '../src/main/github'
import { Layer } from 'effect'

export async function githubClient(http: Http, ...adapters: Parameters<typeof GitHubLive>): Promise<GitHub> {
    const runtime = ManagedRuntime.make(GitHubLive(...adapters).pipe(Layer.provide(Layer.succeed(Http, http))))
    lifetimes.add(() => runtime.dispose())
    return runtime.runPromise(GitHub)
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
import { JournalStore, ConnectionState } from '../src/main/journal-context'
import { JournalModulesLive } from '../src/main/journal-layer'
import { JournalService } from '../src/main/service'
import { Notion } from '../src/main/notion'
import type { Reply } from '../src/shared/model'

export async function journalClient(
    store: JournalDatabase,
    github: GitHub,
    notion: Notion,
    connections: () => Reply['connections'],
    requests: NotionRequests
) {
    const providers = Layer.mergeAll(
        Layer.succeed(JournalStore, store),
        Layer.succeed(GitHub, github),
        Layer.succeed(Notion, notion),
        Layer.succeed(NotionRequests, requests),
        Layer.succeed(ConnectionState, { snapshot: connections })
    )
    const runtime = ManagedRuntime.make(JournalModulesLive.pipe(Layer.provideMerge(providers)))
    lifetimes.add(() => runtime.dispose())
    return runtime.runPromise(JournalService)
}
