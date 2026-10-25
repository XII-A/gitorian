import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, statSync, rmSync } from 'node:fs'
import { z } from 'zod'
import type { NotionPage, NotionDiscoveryProgress } from '../shared/model'

const lifetime = 300000
const maxBytes = 8_000_000
const pageSchema = z.object({
    kind: z.enum(['page', 'data_source']),
    id: z.string().min(1).max(256),
    title: z.string().max(2000),
    url: z.string().max(8192),
    icon: z.string().max(8192).optional(),
    parentId: z.string().max(256).optional()
})
const entrySchema = z.object({
    version: z.literal(2),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.number(),
    pages: z.array(pageSchema).max(100000)
})
type Entry = z.infer<typeof entrySchema>
type Load = (signal: AbortSignal, progress: (update: NotionDiscoveryProgress) => void) => Promise<NotionPage[]>
const scopeOf = (token: string) => createHash('sha256').update(token).digest('hex')

/** Disposable metadata only. Returns stable picker snapshots while refreshing stale data for the next open. */
export class NotionDiscoveryCache {
    private entry?: Entry
    private pending?: {
        scope: string
        controller: AbortController
        listeners: Set<(update: NotionDiscoveryProgress) => void>
        promise: Promise<NotionPage[]>
    }
    constructor(
        private readonly path: string,
        private readonly now: () => number = () => Date.now()
    ) {
        try {
            if (statSync(path).size <= maxBytes) this.entry = entrySchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        } catch {
            // Missing or invalid metadata must never prevent connecting.
        }
    }
    private persist() {
        try {
            const data = JSON.stringify(this.entry)
            if (Buffer.byteLength(data) > maxBytes) return
            writeFileSync(`${this.path}.tmp`, data, { mode: 0o600 })
            renameSync(`${this.path}.tmp`, this.path)
        } catch {
            // Optional cache: keep working if storage is unavailable.
        }
    }
    cancel() {
        this.pending?.controller.abort(new Error('Notion page discovery cancelled.'))
        this.pending = undefined
    }
    clear() {
        this.cancel()
        this.entry = undefined
        try {
            rmSync(this.path, { force: true })
        } catch {
            /* Cache removal must not block disconnect. */
        }
    }
    remember(token: string, page: NotionPage) {
        if (this.entry?.scope !== scopeOf(token)) return
        this.cancel()
        const pages = this.entry.pages.filter((item) => item.id !== page.id)
        this.entry = { ...this.entry, pages: [...pages, page] }
        this.persist()
    }
    async pages(
        token: string,
        load: Load,
        progress: (update: NotionDiscoveryProgress) => void = () => {
            /* Counts are optional for background callers. */
        }
    ) {
        const scope = scopeOf(token)
        const cached = this.entry?.scope === scope ? this.entry : undefined
        const age = cached ? this.now() - cached.updatedAt : lifetime
        if (this.pending && this.pending.scope !== scope) this.cancel()
        if (cached && age >= 0 && age < lifetime) return cached.pages
        if (!this.pending) {
            const controller = new AbortController()
            const listeners = new Set<(update: NotionDiscoveryProgress) => void>()
            if (!cached) listeners.add(progress)
            const promise = Promise.resolve()
                .then(() => {
                    controller.signal.throwIfAborted()
                    return load(controller.signal, (update) => {
                        if (!controller.signal.aborted) for (const listener of listeners) listener(update)
                    })
                })
                .then((pages) => {
                    controller.signal.throwIfAborted()
                    this.entry = entrySchema.parse({ version: 2, scope, updatedAt: this.now(), pages })
                    this.persist()
                    return this.entry.pages
                })
                .finally(() => {
                    if (this.pending?.controller === controller) this.pending = undefined
                })
            this.pending = { scope, controller, listeners, promise }
        } else if (!cached) this.pending.listeners.add(progress)
        if (cached) {
            void this.pending.promise.catch(() => {
                /* A failed refresh keeps the cached snapshot available. */
            })
            return cached.pages
        }
        return this.pending.promise
    }
}
