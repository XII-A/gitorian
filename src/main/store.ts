import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { initialState, stateSchema } from '../shared/model'
import type { State } from '../shared/model'
import { shareSnapshot } from '../shared/snapshot'
import { recordCollections } from '../shared/state-updates'
import { writeStore, type StoreWrite } from './store-writes'
import { StoreWriter } from './store-writer-client'
import type { GitHistory } from './git'
import { imageIds, imageIdPattern, imageLimits } from '../shared/images'
import type { JournalImage } from '../shared/images'
import { validateImage } from './images'

export class Store {
    private readonly db: DatabaseSync
    state: State
    private patches = new Map<string, string>()
    private lastSnapshot: State | undefined
    private persistedSnapshot: State | undefined
    private partKeys = new Set<string>()
    private storageVersion = 0
    private writer: StoreWriter | undefined
    private writerFile: URL | undefined
    private writeError: Error | undefined
    private writeEpoch = 0
    private lastWrite: Promise<void> = Promise.resolve()
    private closing = false
    private restoring = false
    private histories = new Map<string, GitHistory>()
    private changedHistories = new Set<string>()
    constructor(private readonly path: string) {
        this.db = new DatabaseSync(path)
        try {
            this.db.exec(
                'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)'
            )
            this.db.exec('CREATE TABLE IF NOT EXISTS patches (id TEXT PRIMARY KEY, content TEXT NOT NULL)')
            this.db.exec('CREATE TABLE IF NOT EXISTS git_history (id TEXT PRIMARY KEY, json TEXT NOT NULL)')
            this.db.exec(
                'CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL)'
            )
            this.db.exec('CREATE TABLE IF NOT EXISTS state_parts (key TEXT PRIMARY KEY, json TEXT NOT NULL)')
            this.db.exec(
                'CREATE TABLE IF NOT EXISTS state_records (collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(collection,id))'
            )
            const row = this.db.prepare('SELECT json FROM state WHERE id=1').get()
            const stored = row ? (JSON.parse(String(row.json)) as Record<string, unknown>) : undefined
            this.storageVersion = Number(stored?.storageVersion ?? 0)
            if (this.storageVersion && ![2, 3].includes(this.storageVersion))
                throw new Error('Unsupported journal storage version')
            if (this.storageVersion) {
                const parts = this.db.prepare('SELECT key, json FROM state_parts').all()
                this.partKeys = new Set(parts.map((part) => String(part.key)))
                const data = Object.fromEntries(parts.map((part) => [String(part.key), JSON.parse(String(part.json))]))
                if (this.storageVersion === 3)
                    for (const key of recordCollections) {
                        const records = new Map(
                            this.db
                                .prepare('SELECT id, json FROM state_records WHERE collection=?')
                                .all(key)
                                .map((record) => [String(record.id), JSON.parse(String(record.json)) as unknown])
                        )
                        data[key] = (data[key] as string[]).map((id) => {
                            if (!records.has(id)) throw new Error(`Missing ${key} record in journal storage`)
                            return records.get(id)
                        })
                    }
                this.state = stateSchema.parse(data)
                if (this.storageVersion === 3) {
                    this.persistedSnapshot = shareSnapshot(undefined, this.metadata())
                    this.lastSnapshot = this.persistedSnapshot
                }
            } else this.state = stored ? stateSchema.parse(stored) : initialState()
            for (const patch of this.db.prepare('SELECT id, content FROM patches').all()) {
                const id = String(patch.id)
                const content = String(patch.content)
                this.patches.set(id, content)
                if (id.startsWith('diff:')) this.state.diffs[id.slice(5)] = content
                else {
                    const revision = this.state.revisions.find((item) => `revision:${item.id}` === id)
                    if (revision) revision.diff = content
                }
            }
            for (const status of Object.values(this.state.acquisition ?? {}))
                if (status.status === 'running') status.status = 'idle'
            if (this.state.repositoryImport?.status === 'running') {
                this.state.repositoryImport.status = 'error'
                this.state.repositoryImport.message =
                    'Import was interrupted. Add the folder again to continue; existing repositories are kept.'
            }
            // A process exit during a write is always an unknown outcome.
            for (const save of this.state.saves) if (save.status === 'pending') save.status = 'unknown'
            this.persist()
        } catch (error) {
            this.db.close()
            throw error
        }
    }
    persist(): State {
        if (this.restoring) throw new Error('Journal restore is in progress')
        if (this.closing) throw new Error('Journal is closing; no new saves are accepted')
        const reset = !!this.writeError
        if (reset) {
            if (this.writer?.unavailable && this.writerFile) {
                void this.writer.close()
                this.writer = new StoreWriter(this.path, this.writerFile)
            }
            this.persistedSnapshot = undefined
            this.patches = new Map()
            this.partKeys = new Set()
            this.writeError = undefined
            this.writeEpoch++
            this.lastWrite = Promise.resolve()
            for (const id of this.histories.keys()) this.changedHistories.add(id)
        }
        this.state.snapshotVersion = (this.state.snapshotVersion ?? 0) + 1
        const patches = new Map<string, string>([
            ...Object.entries(this.state.diffs).map(([id, text]) => [`diff:${id}`, text] as const),
            ...this.state.revisions.map((revision) => [`revision:${revision.id}`, revision.diff] as const)
        ])
        const metadata = this.snapshot()
        const parts = Object.entries(metadata).filter(([, value]) => value !== undefined)
        const keys = new Set(parts.map(([key]) => key))
        const batch: StoreWrite = {
            parts: [],
            removeParts: [],
            records: [],
            removeRecords: [],
            patches: [...patches].filter(([id, text]) => this.patches.get(id) !== text),
            removePatches: [...this.patches.keys()].filter((id) => !patches.has(id)),
            initialize: this.storageVersion !== 3 || reset,
            reset
        }
        batch.gitHistory = [...this.changedHistories].map((id) => [id, JSON.stringify(this.histories.get(id))])
        for (const [key, value] of parts) {
            if ((recordCollections as readonly string[]).includes(key)) continue
            if (!this.persistedSnapshot || value !== this.persistedSnapshot[key as keyof State])
                batch.parts.push([key, JSON.stringify(value)])
        }
        for (const key of recordCollections) {
            const previous = this.persistedSnapshot?.[key]
            if (previous === metadata[key]) continue
            const before = new Map(previous?.map((record) => [record.id, record]))
            const ids = metadata[key].map((record) => record.id)
            if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key} record identifiers`)
            for (const record of metadata[key])
                if (before.get(record.id) !== record) batch.records.push([key, record.id, JSON.stringify(record)])
            const retained = new Set(ids)
            for (const id of before.keys()) if (!retained.has(id)) batch.removeRecords.push([key, id])
            if (
                !previous ||
                previous.length !== ids.length ||
                previous.some((record, index) => record.id !== ids[index])
            )
                batch.parts.push([key, JSON.stringify(ids)])
        }
        for (const key of this.partKeys) if (!keys.has(key)) batch.removeParts.push(key)
        if (this.writer) {
            const epoch = this.writeEpoch
            this.lastWrite = Promise.all([this.lastWrite, this.writer.write(batch)]).then(() => undefined)
            void this.lastWrite.catch((error: unknown) => {
                if (epoch === this.writeEpoch)
                    this.writeError = error instanceof Error ? error : new Error(String(error))
            })
        } else writeStore(this.db, batch)
        this.patches = patches
        this.partKeys = keys
        this.persistedSnapshot = metadata
        this.storageVersion = 3
        this.changedHistories.clear()
        return metadata
    }

    gitHistory(id: string): GitHistory | undefined {
        const cached = this.histories.get(id)
        if (cached) return cached
        const row = this.db.prepare('SELECT json FROM git_history WHERE id=?').get(id)
        if (!row) return undefined
        const history = JSON.parse(String(row.json)) as GitHistory
        this.histories.set(id, history)
        return history
    }

    cacheGitHistory(id: string, history: GitHistory): void {
        this.histories.set(id, history)
        this.changedHistories.add(id)
    }

    enableBackgroundWrites(file = new URL('./store-writer.js', import.meta.url)): void {
        if (this.writer) return
        this.writerFile = file
        this.writer = new StoreWriter(this.path, file)
    }

    flush(): Promise<void> {
        return this.lastWrite
    }

    async shutdown(): Promise<void> {
        if (!this.db.isOpen) return
        this.closing = true
        try {
            await this.flush()
            await this.writer?.close()
            this.writer = undefined
            this.db.close()
        } catch (error) {
            this.closing = false
            throw error
        }
    }
    private metadata(): State {
        return {
            ...this.state,
            diffs: {},
            revisions: this.state.revisions.map((revision) => ({ ...revision, diff: '' }))
        }
    }
    snapshot(): State {
        const previous = this.lastSnapshot
        this.lastSnapshot = shareSnapshot(previous, this.metadata())
        // Acquisition can change records between persisted checkpoints. Every exposed
        // immutable snapshot needs its own cursor, including those intermediate states.
        if (
            previous &&
            previous !== this.lastSnapshot &&
            previous.snapshotVersion === this.lastSnapshot.snapshotVersion
        ) {
            this.state.snapshotVersion = (this.state.snapshotVersion ?? 0) + 1
            this.lastSnapshot = { ...this.lastSnapshot, snapshotVersion: this.state.snapshotVersion }
        }
        return this.lastSnapshot
    }
    export(): string {
        const size = Number(this.db.prepare('SELECT COALESCE(SUM(length(bytes)),0) AS size FROM images').get()!.size)
        if ((size * 4) / 3 > imageLimits.backup)
            throw new Error(
                'This journal exceeds the 512 MiB backup limit. Close the app and copy its data directory instead.'
            )
        const backup = structuredClone(this.state)
        backup.diffs = {}
        for (const revision of backup.revisions) revision.diff = ''
        for (const repository of backup.repositories) repository.path = ''
        const images = this.db
            .prepare('SELECT * FROM images ORDER BY id')
            .all()
            .map((row) => ({
                id: row.id,
                mime: row.mime,
                width: row.width,
                height: row.height,
                bytes: Buffer.from(row.bytes as Uint8Array).toString('base64')
            }))
        const json = JSON.stringify({ backupVersion: 2, state: backup, images })
        if (Buffer.byteLength(json) > imageLimits.backup)
            throw new Error(
                'This journal exceeds the 512 MiB backup limit. Close the app and copy its data directory instead.'
            )
        return json
    }
    async restore(json: string): Promise<void> {
        if (this.restoring || this.closing) throw new Error('Journal is busy')
        if (Buffer.byteLength(json) > imageLimits.backup) throw new Error('The backup exceeds the 512 MiB limit.')
        const input = JSON.parse(json) as Record<string, unknown>
        if (input.backupVersion !== undefined && input.backupVersion !== 2)
            throw new Error('Unsupported backup version')
        const restored = stateSchema.parse(input.backupVersion === 2 ? input.state : input)
        const images: JournalImage[] = []
        const ids = new Set<string>()
        if (input.backupVersion === 2) {
            if (!Array.isArray(input.images)) throw new Error('Missing backup images')
            for (const value of input.images as Record<string, unknown>[]) {
                if (
                    typeof value.bytes !== 'string' ||
                    value.bytes.length > Math.ceil(imageLimits.bytes / 3) * 4 ||
                    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bytes)
                )
                    throw new Error('Invalid backup image bytes')
                const image = await validateImage(Buffer.from(value.bytes, 'base64'))
                if (
                    image.id !== value.id ||
                    image.mime !== value.mime ||
                    image.width !== value.width ||
                    image.height !== value.height ||
                    ids.has(image.id)
                )
                    throw new Error('Invalid or duplicate backup image')
                images.push(image)
                ids.add(image.id)
            }
        }
        for (const body of [
            ...restored.drafts.map((item) => item.body),
            ...restored.entries.map((item) => item.body),
            ...restored.saves.map((item) => item.body),
            restored.settings.template
        ])
            for (const id of imageIds(body))
                if (!ids.has(id)) throw new Error('The backup is missing a referenced image')
        restored.restoreId = randomUUID()
        for (const repository of restored.repositories) {
            repository.path = ''
            repository.available = false
        }
        for (const save of restored.saves) if (save.status === 'pending') save.status = 'unknown'
        this.restoring = true
        try {
            await this.flush()
            restored.snapshotVersion = (this.state.snapshotVersion ?? 0) + 1
            const metadata = {
                ...restored,
                diffs: {},
                revisions: restored.revisions.map((item) => ({ ...item, diff: '' }))
            }
            const batch: StoreWrite = {
                parts: [],
                records: [],
                patches: [],
                removeParts: [],
                removeRecords: [],
                removePatches: [],
                initialize: true,
                reset: true,
                replaceImages: true,
                images
            }
            for (const [key, value] of Object.entries(metadata)) {
                if (value === undefined) continue
                if ((recordCollections as readonly string[]).includes(key)) {
                    const records = value as { id: string }[]
                    if (new Set(records.map((item) => item.id)).size !== records.length)
                        throw new Error('Duplicate backup records')
                    batch.parts.push([key, JSON.stringify(records.map((item) => item.id))])
                    for (const record of records) batch.records.push([key, record.id, JSON.stringify(record)])
                } else batch.parts.push([key, JSON.stringify(value)])
            }
            for (const [id, text] of Object.entries(restored.diffs)) batch.patches.push([`diff:${id}`, text])
            for (const revision of restored.revisions) batch.patches.push([`revision:${revision.id}`, revision.diff])
            if (this.writer) await this.writer.write(batch)
            else writeStore(this.db, batch)
            this.state = restored
            this.histories.clear()
            this.changedHistories.clear()
            this.lastSnapshot = this.persistedSnapshot = shareSnapshot(undefined, metadata)
            this.partKeys = new Set(batch.parts.map(([key]) => key))
            this.patches = new Map(batch.patches)
            this.storageVersion = 3
            this.lastWrite = Promise.resolve()
            this.writeError = undefined
        } catch (error) {
            this.writeError = error instanceof Error ? error : new Error(String(error))
            throw error
        } finally {
            this.restoring = false
        }
    }
    image(id: string): JournalImage | undefined {
        if (!imageIdPattern.test(id)) return undefined
        const row = this.db.prepare('SELECT * FROM images WHERE id=?').get(id)
        return row
            ? {
                  id,
                  mime: row.mime as JournalImage['mime'],
                  width: Number(row.width),
                  height: Number(row.height),
                  bytes: row.bytes as Uint8Array
              }
            : undefined
    }
    hasImage(id: string): boolean {
        return imageIdPattern.test(id) && !!this.db.prepare('SELECT 1 FROM images WHERE id=?').get(id)
    }
    async importImage(bytes: Uint8Array, restoreId = this.state.restoreId): Promise<string> {
        const image = await validateImage(bytes)
        if (this.restoring || this.closing || restoreId !== this.state.restoreId)
            throw new Error('The journal changed. Insert the image again.')
        if (this.writeError) this.persist()
        if (!this.hasImage(image.id)) {
            const batch: StoreWrite = {
                parts: [],
                records: [],
                patches: [],
                removeParts: [],
                removeRecords: [],
                removePatches: [],
                initialize: false,
                images: [image]
            }
            await this.flush()
            if (this.restoring || restoreId !== this.state.restoreId)
                throw new Error('The journal changed. Insert the image again.')
            try {
                if (this.writer) {
                    this.lastWrite = Promise.all([this.lastWrite, this.writer.write(batch)]).then(() => undefined)
                    await this.lastWrite
                } else writeStore(this.db, batch)
            } catch (error) {
                this.writeError = error instanceof Error ? error : new Error(String(error))
                throw error
            }
        }
        if (this.restoring || restoreId !== this.state.restoreId)
            throw new Error('The journal changed. Insert the image again.')
        return image.id
    }
    close(): void {
        if (this.writer) throw new Error('Use shutdown() to flush the journal writer before closing')
        if (this.db.isOpen) this.db.close()
    }
}
