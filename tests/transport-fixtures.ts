import { afterEach } from 'vitest'
import { Cause, Effect, Exit, ManagedRuntime } from 'effect'
import { Http, HttpLive } from '../src/main/http'
import type { ProviderHttp } from '../src/main/provider-http'
const lifetimes = new Set<() => Promise<void>>()
afterEach(async () => {
    await Promise.all([...lifetimes].map((close) => close()))
    lifetimes.clear()
})
export async function run<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(operation)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}
export function transportClient(...adapters: Parameters<typeof HttpLive>): Http {
    const runtime = ManagedRuntime.make(HttpLive(...adapters))
    lifetimes.add(() => runtime.dispose())
    return runtime.runSync(Http)
}
/** Execute the real scoped transport at the fixture's native I/O seam. */
export function providerHttp(
    fetcher?: typeof fetch,
    persistence?: { pauses: Record<string, number>; changed: () => void }
): ProviderHttp {
    const http = transportClient(
        fetcher,
        persistence ? { pauses: () => persistence.pauses, changed: persistence.changed } : undefined
    )
    return { request: <T>(...args: Parameters<Http['request']>) => run(http.request<T>(...args)) }
}
