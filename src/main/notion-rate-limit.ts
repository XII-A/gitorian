import { setTimeout as delay } from 'node:timers/promises'
import { HttpError } from './http'

/** A 429 rejected this request; resume it without replaying completed work. */
export async function retryNotionRateLimit<T>(
    request: () => Promise<T>,
    signal?: AbortSignal,
    waiting?: (retryAt: number) => void
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted()
        try {
            return await request()
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 429 || !error.retryAt || attempt >= 3) throw error
            waiting?.(error.retryAt)
            await delay(Math.max(0, error.retryAt - Date.now()), undefined, { signal })
        }
    }
}
