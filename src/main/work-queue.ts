/** Bounded I/O work with foreground admission ahead of queued background work. */
export class WorkQueue {
    private active = 0
    private pending: { priority: number; start: () => void }[] = []
    constructor(private readonly limit: number) {}
    run<T>(work: () => Promise<T>, priority = 0): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.pending.push({
                priority,
                start: () => {
                    this.active++
                    void work()
                        .then(resolve, reject)
                        .finally(() => {
                            this.active--
                            this.drain()
                        })
                }
            })
            this.pending.sort((a, b) => b.priority - a.priority)
            this.drain()
        })
    }
    private drain(): void {
        while (this.active < this.limit && this.pending.length) this.pending.shift()!.start()
    }
}

export async function forEachConcurrent<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
    let next = 0
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) await work(items[next++])
        })
    )
}
