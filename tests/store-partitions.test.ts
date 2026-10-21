import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { sampleState } from '../src/renderer/workspace-sample'
import { stateSchema } from '../src/shared/model'

it('migrates the legacy row atomically, writes only changed draft sections, and reopens without losing content', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'weekly-j-partitions-'))
    const path = join(directory, 'journal.sqlite')
    const original = sampleState('2026-10-12')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)')
    db.prepare('INSERT INTO state VALUES(1, ?)').run(JSON.stringify(original))
    let store: Store | undefined
    try {
        store = new Store(path)
        expect(store.state.activities).toEqual(original.activities)
        expect(store.state.drafts).toEqual(original.drafts)
        expect(JSON.parse(String(db.prepare('SELECT json FROM state WHERE id=1').get()!.json))).toEqual({
            storageVersion: 3
        })
        db.exec(
            'CREATE TABLE writes (key TEXT); CREATE TRIGGER track_parts AFTER UPDATE ON state_parts BEGIN INSERT INTO writes VALUES(NEW.key); END; CREATE TRIGGER track_records AFTER UPDATE ON state_records BEGIN INSERT INTO writes VALUES(NEW.collection); END;'
        )
        store.state.drafts[0].title = 'Latest draft'
        store.persist()
        expect(
            db
                .prepare('SELECT key FROM writes ORDER BY key')
                .all()
                .map((row) => row.key)
        ).toEqual(['drafts', 'snapshotVersion'])
        db.exec('DELETE FROM writes')
        store.state.activities[0].description = 'Updated by refresh'
        store.persist()
        expect(
            db
                .prepare('SELECT key FROM writes ORDER BY key')
                .all()
                .map((row) => row.key)
        ).toEqual(['activities', 'snapshotVersion'])
        const beforeCheckpoint = store.snapshot()
        store.state.activities[0].title = 'Acquired between checkpoints'
        const unpersisted = store.snapshot()
        expect(unpersisted.snapshotVersion).toBeGreaterThan(beforeCheckpoint.snapshotVersion!)
        expect(store.snapshot()).toBe(unpersisted)
        store.persist()
        const expected = store.snapshot()
        const backup = stateSchema.parse(JSON.parse(store.export()).state)
        expect(backup.drafts).toEqual(expected.drafts)
        store.close()
        store = new Store(path)
        expect(store.state.drafts).toEqual(expected.drafts)
        expect(store.state.activities).toEqual(expected.activities)
        store.state.refreshError = 'Transient error'
        store.persist()
        delete store.state.refreshError
        store.persist()
        store.close()
        store = new Store(path)
        expect(store.state.refreshError).toBeUndefined()
        await store.restore(JSON.stringify(backup))
        expect(store.state.drafts).toEqual(backup.drafts)
        expect(store.state.restoreId).toBeTruthy()
    } finally {
        store?.close()
        db.close()
        rmSync(directory, { recursive: true, force: true })
    }
})

it('rolls back legacy migration on failure and retries failed saves without accepting a partial revision', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weekly-j-partitions-'))
    const path = join(directory, 'journal.sqlite')
    const state = sampleState('2026-10-12')
    const raw = JSON.stringify(state)
    const db = new DatabaseSync(path)
    db.exec(
        "CREATE TABLE state (id INTEGER PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE state_parts (key TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TRIGGER reject_part BEFORE INSERT ON state_parts BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
    )
    db.prepare('INSERT INTO state VALUES(1, ?)').run(raw)
    let store: Store | undefined
    try {
        expect(() => new Store(path)).toThrow('test failure')
        expect(db.prepare('SELECT json FROM state WHERE id=1').get()!.json).toBe(raw)
        expect(db.prepare('SELECT count(*) AS count FROM state_parts').get()!.count).toBe(0)
        db.exec('DROP TRIGGER reject_part')
        store = new Store(path)
        const originalTitle = store.state.drafts[0].title
        db.exec(
            "CREATE TRIGGER reject_update BEFORE UPDATE ON state_records WHEN NEW.collection='drafts' BEGIN SELECT RAISE(ABORT, 'save failure'); END;"
        )
        store.state.drafts[0].title = 'After failure'
        expect(() => store!.persist()).toThrow('save failure')
        const persisted = JSON.parse(
            String(db.prepare("SELECT json FROM state_records WHERE collection='drafts'").get()!.json)
        )
        expect(persisted.title).toBe(originalTitle)
        db.exec('DROP TRIGGER reject_update')
        store.persist()
        store.close()
        store = new Store(path)
        expect(store.state.drafts[0].title).toBe('After failure')
    } finally {
        store?.close()
        db.close()
        rmSync(directory, { recursive: true, force: true })
    }
})
