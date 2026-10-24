import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { sampleState } from '../src/renderer/workspace-sample'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const loader = pathToFileURL(require.resolve('tsx/esm/api').replace(/index\.cjs$/, 'index.mjs')).href
const source = new URL('../src/main/store-writer.ts', import.meta.url).href
const worker = new URL(
    `data:text/javascript,${encodeURIComponent(`import {tsImport} from ${JSON.stringify(loader)};await tsImport(${JSON.stringify(source)},import.meta.url);`)}`
)
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

it('retries a failed image write without another draft edit and flushes image bytes before shutdown', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-worker-image-'))
    const path = join(directory, 'journal.sqlite')
    let store = new Store(path)
    const db = new DatabaseSync(path)
    try {
        store.enableBackgroundWrites(worker)
        db.exec(
            "CREATE TRIGGER reject_image BEFORE INSERT ON images BEGIN SELECT RAISE(ABORT,'image disk failure'); END;"
        )
        const bytes = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#aaa' } })
            .png()
            .toBuffer()
        await expect(store.importImage(bytes)).rejects.toThrow('image disk failure')
        db.exec('DROP TRIGGER reject_image')
        const id = await store.importImage(bytes)
        expect(store.hasImage(id)).toBe(true)
        const backup = store.export()
        await store.restore(backup)
        expect(store.hasImage(id)).toBe(true)
        await store.shutdown()
        store = new Store(path)
        expect(Buffer.from(store.image(id)!.bytes)).toEqual(bytes)
    } finally {
        await store.shutdown()
        db.close()
        rmSync(directory, { recursive: true, force: true })
    }
})

it('keeps main-thread timers responsive during a locked commit and flushes writes in order before shutdown', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-worker-'))
    const path = join(directory, 'journal.sqlite')
    let store = new Store(path)
    store.state = sampleState('2026-10-12')
    store.persist()
    const db = new DatabaseSync(path)
    try {
        store.enableBackgroundWrites(worker)
        store.persist()
        await store.flush()
        db.exec('BEGIN IMMEDIATE')
        let flushed = false
        store.state.drafts[0].title = 'First pending save'
        store.cacheGitHistory('fixture', { configuration: 'fixture', refs: {}, items: [store.state.activities[0]] })
        store.persist()
        store.state.drafts[0].title = 'Latest pending save'
        store.persist()
        const saving = store.flush().then(() => {
            flushed = true
        })
        await pause(80)
        expect(flushed).toBe(false)
        const closing = store.shutdown()
        expect(() => store.persist()).toThrow('closing')
        db.exec('COMMIT')
        await saving
        await closing
        store = new Store(path)
        expect(store.state.drafts[0].title).toBe('Latest pending save')
        expect(store.gitHistory('fixture')?.items[0].id).toBe(store.state.activities[0].id)
    } finally {
        if (db.isTransaction) db.exec('ROLLBACK')
        await store.shutdown()
        db.close()
        rmSync(directory, { recursive: true, force: true })
    }
})

it('rejects failed and dependent queued saves, then retries a complete current snapshot without losing updates', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-worker-'))
    const path = join(directory, 'journal.sqlite')
    let store = new Store(path)
    store.state = sampleState('2026-10-12')
    store.persist()
    const db = new DatabaseSync(path)
    try {
        store.enableBackgroundWrites(worker)
        store.persist()
        await store.flush()
        db.exec(
            "CREATE TRIGGER reject_draft BEFORE UPDATE ON state_records WHEN NEW.collection='drafts' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;"
        )
        store.state.drafts[0].title = 'Failed first write'
        store.persist()
        store.state.activities[0].title = 'Dependent queued update'
        store.persist()
        await expect(store.flush()).rejects.toThrow()
        await expect(store.shutdown()).rejects.toThrow()
        db.exec('DROP TRIGGER reject_draft')
        store.state.drafts[0].title = 'Retry latest draft'
        store.persist()
        await store.flush()
        await store.shutdown()
        store = new Store(path)
        expect(store.state.drafts[0].title).toBe('Retry latest draft')
        expect(store.state.activities[0].title).toBe('Dependent queued update')
    } finally {
        await store.shutdown()
        db.close()
        rmSync(directory, { recursive: true, force: true })
    }
})
