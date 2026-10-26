import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from 'effect'

/** Owns accepted desktop work; durable shutdown drains before disposing resources. */
export class ApplicationWork {
    private readonly runtime = ManagedRuntime.make(Layer.scope)
    private readonly tasks = new Map<symbol, Fiber.RuntimeFiber<unknown, unknown>>()
    private sealed = false

    constructor() {
        this.runtime.runSync(Effect.void)
    }

    run<A>(work: (drain: () => Promise<void>) => Promise<A>): Promise<A> {
        const completion = new Promise<A>((resolve, reject) => {
            if (this.sealed) {
                reject(new Error('Journal work is closed'))
                return
            }
            const id = Symbol()
            const fiber = this.runtime.runFork(
                Effect.tryPromise({ try: () => work(() => this.drain(id)), catch: (error) => error })
            )
            this.tasks.set(id, fiber)
            fiber.addObserver((exit) => {
                this.tasks.delete(id)
                if (Exit.isSuccess(exit)) resolve(exit.value)
                else {
                    const error = Cause.squash(exit.cause)
                    reject(error instanceof Error ? error : new Error(String(error)))
                }
            })
        })
        // Detached producers still have an error observer; awaiting callers retain rejection.
        void completion.catch(() => {
            /* The command or background producer owns error presentation. */
        })
        return completion
    }

    async drain(except?: symbol): Promise<void> {
        for (;;) {
            const pending = [...this.tasks].filter(([id]) => id !== except).map(([, fiber]) => fiber)
            if (!pending.length) return
            await this.runtime.runPromise(
                Effect.forEach(pending, Fiber.await, { concurrency: 'unbounded', discard: true })
            )
        }
    }

    repeat(milliseconds: number, tick: () => void): void {
        this.runtime.runSync(
            Effect.forkScoped(Effect.forever(Effect.sleep(milliseconds).pipe(Effect.andThen(Effect.sync(tick)))))
        )
    }

    async shutdown(save: () => Promise<void>): Promise<void> {
        await this.drain()
        this.sealed = true
        try {
            await save()
        } catch (error) {
            this.sealed = false
            throw error
        }
        await this.runtime.dispose()
    }
}
