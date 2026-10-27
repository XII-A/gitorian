import { ConnectionError } from './connection-errors'
import { DurabilityError } from './durability-error'
import { Context, Effect, Layer } from 'effect'
import { Http, HttpError, type TransportError } from './http'
export type NotionRequestFailure = ConnectionError | DurabilityError | HttpError | TransportError
const credentialError = (error: unknown): ConnectionError | DurabilityError =>
    error instanceof ConnectionError || error instanceof DurabilityError ? error : new ConnectionError(error)
export type NotionToken = (refresh?: boolean, rejected?: string) => Effect.Effect<string, Error>
/** Internal authenticated provider access shared by reads, setup and publishing. */
export interface NotionRequests {
    readonly request: <T>(path: string, init?: RequestInit) => Effect.Effect<T, NotionRequestFailure>
}
export const NotionRequests = Context.GenericTag<NotionRequests>('gitorian/NotionRequests')
export const NotionRequestsLive = (getToken: NotionToken) =>
    Layer.effect(
        NotionRequests,
        Effect.map(Http, (http) => makeNotionRequests(http, getToken))
    )
export function makeNotionRequests(http: Http, getToken: NotionToken): NotionRequests {
    const request = <T>(path: string, init?: RequestInit): Effect.Effect<T, NotionRequestFailure> =>
        Effect.gen(function* () {
            const token = yield* getToken().pipe(Effect.mapError(credentialError))
            if (!token) return yield* Effect.fail(new HttpError(401, 'Connect Notion to publish or refresh'))
            return yield* http.request<T>('https://api.notion.com/v1/' + path, token, init).pipe(
                Effect.catchAll((error) => {
                    if (!(error instanceof HttpError) || error.status !== 401) return Effect.fail(error)
                    return getToken(true, token).pipe(
                        Effect.mapError(credentialError),
                        Effect.flatMap((refreshed) =>
                            !refreshed || refreshed === token
                                ? Effect.fail(error)
                                : http.request<T>('https://api.notion.com/v1/' + path, refreshed, init)
                        )
                    )
                })
            )
        })
    return { request }
}
