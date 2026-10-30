import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { JournalEngine } from './engine'
import { DatabaseError, type Configuration } from './types'
type Operation = Exclude<keyof JournalEngine, 'close'>
type Result<K extends Operation> = ReturnType<JournalEngine[K]>

export class DatabaseWorker {
    private readonly worker: Worker
    private sequence = 0
    private readonly pending = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>()
    private closed = false
    private failure?: Error
    private configuration!: Configuration
    private readonly ready: Promise<void>
    private constructor(path: string, base: string) {
        let file = new URL('./database-worker.js', base)
        if (new URL(base).pathname.endsWith('.ts')) {
            const require = createRequire(base)
            const loader = pathToFileURL(require.resolve('tsx/esm/api').replace(/index\.cjs$/, 'index.mjs')).href
            const source = new URL('./database-worker.ts', base).href
            file = new URL(
                `data:text/javascript,${encodeURIComponent(`import {tsImport} from ${JSON.stringify(loader)};await tsImport(${JSON.stringify(source)},import.meta.url);`)}`
            )
        }
        this.worker = new Worker(file, {
            workerData: {
                path,
                now: Date.now(),
                migrations: fileURLToPath(new URL('../../resources/migrations', base))
            }
        })
        this.ready = new Promise((resolve, reject) => {
            this.worker.on(
                'message',
                (message: {
                    ready?: boolean
                    id?: number
                    result?: never
                    configuration?: Configuration
                    error?: { code: DatabaseError['code']; message: string; detail?: string }
                }) => {
                    if (message.configuration) this.configuration = message.configuration
                    const error = message.error
                        ? new DatabaseError(message.error.code, message.error.message)
                        : undefined
                    if (error && message.error?.detail) error.cause = new Error(message.error.detail)
                    if (message.ready !== undefined) {
                        if (error) {
                            this.failure = error
                            reject(error)
                        } else resolve()
                        return
                    }
                    const pending = this.pending.get(message.id!)
                    this.pending.delete(message.id!)
                    if (error) pending?.reject(error)
                    else pending?.resolve(message.result!)
                }
            )
            const fail = (error: Error) => {
                this.failure = error
                reject(error)
                for (const pending of this.pending.values()) pending.reject(error)
                this.pending.clear()
            }
            this.worker.on('error', fail)
            this.worker.on('exit', (code) => {
                if (!this.closed || this.pending.size)
                    fail(
                        new DatabaseError(
                            'storage',
                            `The journal worker stopped (${code}). Reopen the journal to verify the last save.`
                        )
                    )
            })
        })
    }
    static async open(path: string, base: string) {
        const database = new DatabaseWorker(path, base)
        try {
            await database.ready
            return database
        } catch (error) {
            database.closed = true
            await database.worker.terminate()
            throw error
        }
    }
    get config(): Configuration {
        return structuredClone(this.configuration)
    }
    get generation(): string {
        return this.configuration.generation
    }
    request<K extends Operation>(operation: K, ...args: Parameters<JournalEngine[K]>): Promise<Result<K>> {
        if (this.failure) return Promise.reject(this.failure)
        if (this.closed) return Promise.reject(new DatabaseError('storage', 'The journal is closing.'))
        return new Promise((resolve, reject) => {
            const id = ++this.sequence
            this.pending.set(id, { resolve: resolve, reject })
            this.worker.postMessage({ id, operation, args, now: Date.now() })
        })
    }
    get available() {
        return !this.failure && !this.closed
    }
    async close() {
        if (this.closed) return
        this.closed = true
        if (this.failure) {
            await this.worker.terminate()
            return
        }
        await new Promise<void>((resolve, reject) => {
            const id = ++this.sequence
            this.pending.set(id, { resolve: () => resolve(), reject })
            this.worker.postMessage({ id, operation: 'close', args: [], now: Date.now() })
        })
        await this.worker.terminate()
    }
}
