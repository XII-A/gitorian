import { DatabaseSync } from 'node:sqlite'
import { initialState, stateSchema } from '../shared/model'
import type { State } from '../shared/model'

export class Store {
    private readonly db: DatabaseSync
    state: State
    constructor(path: string) {
        this.db = new DatabaseSync(path)
        this.db.exec(
            'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)'
        )
        const row = this.db.prepare('SELECT json FROM state WHERE id=1').get()
        this.state = row ? stateSchema.parse(JSON.parse(String(row.json))) : initialState()
        // A process exit during a write is always an unknown outcome.
        for (const save of this.state.saves) if (save.status === 'pending') save.status = 'unknown'
        this.persist()
    }
    persist(): void {
        this.db
            .prepare('INSERT INTO state VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
            .run(JSON.stringify(this.state))
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
