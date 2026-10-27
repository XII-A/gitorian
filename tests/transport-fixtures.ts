import { afterEach } from 'vitest'
import { Cause, Effect, Exit, ManagedRuntime } from 'effect'
import { Http, HttpLive } from '../src/main/http'
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
