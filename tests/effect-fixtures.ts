import { Effect } from 'effect'
import { makeNotion } from '../src/main/notion'
import type { Http } from '../src/main/http'
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
