import type { DatabaseSync } from 'node:sqlite'

export interface StoreWrite {
    parts: [string, string][]
    removeParts: string[]
    records: [string, string, string][]
    removeRecords: [string, string][]
    patches: [string, string][]
    removePatches: string[]
    initialize: boolean
    reset?: boolean
}

export function writeStore(db: DatabaseSync, batch: StoreWrite): void {
    db.exec('BEGIN IMMEDIATE')
    try {
        if (batch.reset) db.exec('DELETE FROM state_parts; DELETE FROM state_records; DELETE FROM patches;')
        const patch = db.prepare(
            'INSERT INTO patches VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET content=excluded.content'
        )
        for (const row of batch.patches) patch.run(...row)
        const removePatch = db.prepare('DELETE FROM patches WHERE id=?')
        for (const id of batch.removePatches) removePatch.run(id)
        const part = db.prepare(
            'INSERT INTO state_parts VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json=excluded.json'
        )
        for (const row of batch.parts) part.run(...row)
        const removePart = db.prepare('DELETE FROM state_parts WHERE key=?')
        for (const key of batch.removeParts) removePart.run(key)
        const record = db.prepare(
            'INSERT INTO state_records VALUES(?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET json=excluded.json'
        )
        for (const row of batch.records) record.run(...row)
        const removeRecord = db.prepare('DELETE FROM state_records WHERE collection=? AND id=?')
        for (const row of batch.removeRecords) removeRecord.run(...row)
        if (batch.initialize)
            db.prepare('INSERT INTO state VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(
                JSON.stringify({ storageVersion: 3 })
            )
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}
