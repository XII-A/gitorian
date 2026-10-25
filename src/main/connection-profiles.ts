import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs'
import sharp from 'sharp'
import { z } from 'zod'
import type { ConnectionProfile, ConnectionProfiles, ConnectionService } from '../shared/model'
import { downloadImage } from './images'

const day = 86_400_000
const entrySchema = z.object({
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.number(),
    name: z.string().max(256),
    avatarUrl: z
        .string()
        .max(64_000)
        .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/)
        .optional()
})
type Entry = z.infer<typeof entrySchema>
const cacheSchema = z.object({ github: entrySchema.optional(), notion: entrySchema.optional() })

/** Disposable, bounded profile data. Credentials and journal backups never enter this file. */
export class ConnectionProfileCache {
    private entries: Partial<Record<ConnectionService, Entry>> = {}
    private versions = { github: 0, notion: 0 }
    private pending = new Map<ConnectionService, { scope: string; promise: Promise<ConnectionProfile | undefined> }>()
    constructor(
        private readonly path: string,
        private readonly token: (service: ConnectionService) => string,
        private readonly load: (service: ConnectionService) => Promise<ConnectionProfile>,
        private readonly download: typeof downloadImage = downloadImage,
        private readonly now: () => number = Date.now
    ) {
        try {
            if (statSync(path).size <= 150_000) this.entries = cacheSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        } catch {
            /* A missing or damaged cache never prevents opening the app. */
        }
    }
    private scope(service: ConnectionService) {
        const token = this.token(service)
        return token ? createHash('sha256').update(token).digest('hex') : ''
    }
    private profile(entry: Entry): ConnectionProfile {
        return { name: entry.name, ...(entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}) }
    }
    snapshot(): ConnectionProfiles {
        const result: ConnectionProfiles = {}
        for (const service of ['github', 'notion'] as const) {
            const entry = this.entries[service]
            if (entry && entry.scope === this.scope(service)) result[service] = this.profile(entry)
        }
        return result
    }
    clear(service: ConnectionService) {
        this.versions[service]++
        this.pending.delete(service)
        this.entries[service] = undefined
        this.persist()
    }
    private persist() {
        try {
            writeFileSync(`${this.path}.tmp`, JSON.stringify(this.entries), { mode: 0o600 })
            renameSync(`${this.path}.tmp`, this.path)
        } catch {
            /* Profile caching is optional, including on read-only storage. */
        }
    }
    refresh(service: ConnectionService, initial?: ConnectionProfile): Promise<ConnectionProfile | undefined> {
        const scope = this.scope(service)
        if (!scope) {
            this.clear(service)
            return Promise.resolve(undefined)
        }
        const previous = this.entries[service]
        const cached = previous?.scope === scope ? previous : undefined
        const age = cached ? this.now() - cached.updatedAt : day
        if (cached && age >= 0 && age < day) return Promise.resolve(this.profile(cached))
        const pending = this.pending.get(service)
        if (pending?.scope === scope) return pending.promise
        const version = this.versions[service]
        const current = () => version === this.versions[service] && scope === this.scope(service)
        const promise = (async () => {
            try {
                const profile = initial ?? (await this.load(service))
                let avatarUrl: string | undefined,
                    failed = false
                if (profile.avatarUrl) {
                    try {
                        const image = await this.download(profile.avatarUrl)
                        const bytes = await sharp(image.bytes)
                            .resize(64, 64, { fit: 'cover' })
                            .webp({ quality: 80 })
                            .toBuffer()
                        avatarUrl = `data:image/webp;base64,${bytes.toString('base64')}`
                    } catch {
                        avatarUrl = cached?.avatarUrl
                        failed = true
                    }
                }
                if (!current()) return undefined
                const entry = entrySchema.parse({
                    scope,
                    name: profile.name.slice(0, 256),
                    avatarUrl,
                    updatedAt: this.now() - (failed ? day - 300_000 : 0)
                })
                this.entries[service] = entry
                this.persist()
                return this.profile(entry)
            } catch {
                return current() && cached ? this.profile(cached) : undefined
            }
        })().finally(() => {
            if (this.pending.get(service)?.promise === promise) this.pending.delete(service)
        })
        this.pending.set(service, { scope, promise })
        return promise
    }
}
