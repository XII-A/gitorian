import { required } from '../shared/required'

/** Bounded I/O work with foreground admission ahead of queued background work. */
export class WorkQueue {
    private active = 0
    private pending: { priority: number; start: () => void }[] = []
    private readonly limit: number
    constructor(limit: number) {
        this.limit = limit
    }
    run<T>(work: () => Promise<T>, priority = 0): Promise<T> {
        const { promise, resolve, reject } = Promise.withResolvers<T>()
        this.pending.push({
            priority,
            start: async () => {
                this.active += 1
                try {
                    resolve(await work())
                } catch (error) {
                    reject(error)
                } finally {
                    this.active -= 1
                    this.drain()
                }
            }
        })
        this.pending = this.pending.toSorted((a, b) => b.priority - a.priority)
        this.drain()
        return promise
    }
    private drain(): void {
        while (this.active < this.limit && this.pending.length) {
            required(this.pending.shift()).start()
        }
    }
}

export const forEachConcurrent = async <T>(
    items: T[],
    limit: number,
    work: (item: T) => Promise<void>
): Promise<void> => {
    let next = 0
    const consume = async (): Promise<void> => {
        if (next >= items.length) {
            return
        }
        const item = items[next]
        next += 1
        await work(item)
        await consume()
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume))
}
