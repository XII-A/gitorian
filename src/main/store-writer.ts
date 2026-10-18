import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { writeStore, type StoreWrite } from './store-writes'

const port = parentPort!
const db = new DatabaseSync((workerData as { path: string }).path)
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
let failed = false
port.on('message', (message: { id: number; batch?: StoreWrite; close?: boolean }) => {
    if (message.close) {
        db.close()
        port.close()
        return
    }
    try {
        if (!message.batch) throw new Error('Missing journal write')
        if (failed && !message.batch.reset) throw new Error('An earlier journal write failed; retry saving')
        writeStore(db, message.batch)
        failed = false
        port.postMessage({ id: message.id })
    } catch (error) {
        // Later deltas depend on this write. Refuse them until a complete retry succeeds.
        failed = true
        port.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) })
    }
})
