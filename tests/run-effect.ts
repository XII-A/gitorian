import { Cause, Effect, Exit } from 'effect'

export async function run<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(operation)
    if (Exit.isSuccess(exit)) return exit.value
    const error = Cause.squash(exit.cause)
    throw error
}
