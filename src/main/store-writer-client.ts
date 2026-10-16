import { Worker } from 'node:worker_threads'
import type { StoreWrite } from './store-writes'

export class StoreWriter {
    private readonly worker: Worker
    private sequence = 0
    private pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
    private failure: Error | undefined
    private closing = false

    constructor(path: string, file: URL) {
        this.worker = new Worker(file, { workerData: { path } })
        this.worker.on('message', (message: { id: number; error?: string }) => {
            const pending = this.pending.get(message.id)
            this.pending.delete(message.id)
            if (message.error) pending?.reject(new Error(message.error))
            else pending?.resolve()
        })
        this.worker.on('error', (error) => this.fail(error))
        this.worker.on('exit', (code) => {
            if (!this.closing || this.pending.size)
                this.fail(new Error(`Journal writer exited before saving (${code})`))
        })
    }

    private fail(error: Error) {
        this.failure = error
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
    }

    write(batch: StoreWrite): Promise<void> {
        if (this.closing) return Promise.reject(new Error('Journal writer is closing'))
        if (this.failure) return Promise.reject(this.failure)
        return new Promise((resolve, reject) => {
            const id = ++this.sequence
            this.pending.set(id, { resolve, reject })
            this.worker.postMessage({ id, batch })
        })
    }

    get unavailable(): boolean {
        return !!this.failure
    }

    async close(): Promise<void> {
        this.closing = true
        await this.worker.terminate()
    }
}
