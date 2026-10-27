import { Effect } from 'effect'
import { makeNotion } from '../src/main/notion'
import { Http } from '../src/main/http'
import type { Store } from '../src/main/store'
import { downloadImage } from '../src/main/images'
export { run, transportClient } from './transport-fixtures'
export function notionClient(
    http: Http,
    token: (refresh?: boolean, rejected?: string) => string | Promise<string>,
    images?: Pick<Store, 'image' | 'importImage'>,
    imageDownload = downloadImage
) {
    return makeNotion(
        http,
        (refresh, rejected) =>
            Effect.tryPromise({
                try: () => Promise.resolve(token(refresh, rejected)),
                catch: (error) => (error instanceof Error ? error : new Error(String(error)))
            }).pipe(Effect.uninterruptible),
        images,
        imageDownload
    )
}

import { GitHub, GitHubLive } from '../src/main/github'
import { Layer, ManagedRuntime } from 'effect'
import { afterEach } from 'vitest'
const githubLifetimes = new Set<() => Promise<void>>()
afterEach(async () => {
    await Promise.all([...githubLifetimes].map((close) => close()))
    githubLifetimes.clear()
})
export async function githubClient(http: Http, ...adapters: Parameters<typeof GitHubLive>): Promise<GitHub> {
    const runtime = ManagedRuntime.make(GitHubLive(...adapters).pipe(Layer.provide(Layer.succeed(Http, http))))
    githubLifetimes.add(() => runtime.dispose())
    return runtime.runPromise(GitHub)
}
