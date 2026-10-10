import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { initialState, stateSchema } from '../shared/model'
import type { State } from '../shared/model'

export class Store {
    private readonly db: DatabaseSync
    state: State
    private patches = new Map<string, string>()
    constructor(path: string) {
        this.db = new DatabaseSync(path)
        this.db.exec(
            'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)'
        )
        this.db.exec('CREATE TABLE IF NOT EXISTS patches (id TEXT PRIMARY KEY, content TEXT NOT NULL)')
        const row = this.db.prepare('SELECT json FROM state WHERE id=1').get()
        this.state = row ? stateSchema.parse(JSON.parse(String(row.json))) : initialState()
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
    }
    persist(): void {
        this.state.snapshotVersion = (this.state.snapshotVersion ?? 0) + 1
        const patches = new Map<string, string>([
            ...Object.entries(this.state.diffs).map(([id, text]) => [`diff:${id}`, text] as const),
            ...this.state.revisions.map((revision) => [`revision:${revision.id}`, revision.diff] as const)
        ])
        this.db.exec('BEGIN IMMEDIATE')
        try {
            const write = this.db.prepare(
                'INSERT INTO patches VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET content=excluded.content'
            )
            for (const [id, text] of patches) if (this.patches.get(id) !== text) write.run(id, text)
            for (const id of this.patches.keys())
                if (!patches.has(id)) this.db.prepare('DELETE FROM patches WHERE id=?').run(id)
            this.db
                .prepare('INSERT INTO state VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
                .run(JSON.stringify(this.metadata()))
            this.db.exec('COMMIT')
            this.patches = patches
        } catch (error) {
            this.db.exec('ROLLBACK')
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
        return structuredClone(this.metadata())
    }
    export(): string {
        const backup = structuredClone(this.state)
        backup.diffs = {}
        for (const revision of backup.revisions) revision.diff = ''
        for (const repository of backup.repositories) repository.path = ''
        return JSON.stringify(backup, null, 4)
    }
    restore(json: string): void {
        const restored = stateSchema.parse(JSON.parse(json))
        restored.restoreId = randomUUID()
        for (const repository of restored.repositories) {
            repository.path = ''
            repository.available = false
        }
        for (const save of restored.saves) if (save.status === 'pending') save.status = 'unknown'
        this.state = restored
        this.persist()
    }
    close(): void {
        if (this.db.isOpen) this.db.close()
    }
}
