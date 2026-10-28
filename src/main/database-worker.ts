import { parentPort, workerData } from 'node:worker_threads'
import { JournalEngine } from './database/engine'
import { DatabaseError } from './database/types'

const port = parentPort!
const { path, migrations, now } = workerData as { path: string; migrations: string; now: number }
let currentTime = now
let engine: JournalEngine
try {
    engine = new JournalEngine(path, migrations, () => currentTime)
    port.postMessage({ ready: true, configuration: engine.config() })
} catch (error) {
    port.postMessage({
        ready: false,
        error: { code: 'schema', message: error instanceof Error ? error.message : String(error) }
    })
    port.close()
}
port.on('message', (message: { id: number; operation: keyof JournalEngine; args: unknown[]; now: number }) => {
    try {
        currentTime = message.now
        const operation = engine[message.operation] as (...args: unknown[]) => unknown
        const result = operation.apply(engine, message.args)
        if (message.operation === 'close') {
            port.postMessage({ id: message.id, result })
            port.close()
        } else port.postMessage({ id: message.id, result, configuration: engine.config() })
    } catch (error) {
        port.postMessage({
            id: message.id,
            error:
                error instanceof DatabaseError
                    ? { code: error.code, message: error.message }
                    : {
                          code: 'storage',
                          message: 'The journal could not be saved. Check available disk space and try again.',
                          detail: error instanceof Error ? error.message : String(error)
                      }
        })
    }
})
