import { parsePatch, type DiffFile } from './diff-model'

export interface DiffRequest {
    id: number
    text?: string
    priority: 'foreground' | 'background'
    cancel?: boolean
}
export interface DiffReply {
    id: number
    files: DiffFile[]
    total: number
    complete: boolean
    failed?: boolean
}
export interface DiffSnapshot {
    files: DiffFile[]
    total: number
    complete: boolean
}
interface Preparation {
    id: number
    snapshot: DiffSnapshot
    listeners: Set<() => void>
    complete: (files: DiffFile[]) => void
    promise: Promise<DiffFile[]>
    bytes: number
    failed?: boolean
}
const cache = new Map<string, Preparation>()
const requests = new Map<number, Preparation>()
let worker: Worker | undefined
let nextId = 0
const empty: DiffFile[] = []

function trimCache() {
    let bytes = [...cache.values()].reduce((total, entry) => total + entry.bytes, 0)
    for (const [text, entry] of cache) {
        if (cache.size <= 8 && bytes <= 24_000_000) break
        if (!entry.snapshot.complete || entry.listeners.size) continue
        bytes -= entry.bytes
        cache.delete(text)
    }
}

function receive(reply: DiffReply) {
    const entry = requests.get(reply.id)
    if (!entry) return
    const files = reply.failed ? empty : [...entry.snapshot.files, ...reply.files]
    entry.snapshot = { files, total: reply.total, complete: reply.complete }
    entry.failed = reply.failed
    // Account for raw text, both source sides, line references and hunk metadata.
    entry.bytes += reply.files.reduce(
        (total, file) =>
            total +
            file.raw.length * 4 +
            (file.additionLines.length + file.deletionLines.length) * 16 +
            file.hunks.length * 256,
        0
    )
    if (reply.complete) {
        requests.delete(reply.id)
        entry.complete(files)
    }
    for (const listener of entry.listeners) listener()
    trimCache()
}

function failWorker() {
    worker?.terminate()
    worker = undefined
    for (const id of [...requests.keys()]) receive({ id, files: [], total: 0, complete: true, failed: true })
}

function prepare(text: string, priority: DiffRequest['priority']): Preparation {
    const known = cache.get(text)
    if (known && !(known.failed && !known.listeners.size)) {
        cache.delete(text)
        cache.set(text, known)
        if (!known.snapshot.complete && priority === 'foreground')
            worker?.postMessage({ id: known.id, priority } satisfies DiffRequest)
        return known
    }
    let complete!: (files: DiffFile[]) => void
    const entry: Preparation = {
        id: ++nextId,
        snapshot: { files: empty, total: 0, complete: false },
        listeners: new Set(),
        promise: new Promise((resolve) => {
            complete = resolve
        }),
        complete: (files) => complete(files),
        bytes: text.length * 2
    }
    cache.set(text, entry)
    requests.set(entry.id, entry)
    if (typeof Worker === 'undefined') {
        void Promise.resolve().then(() =>
            receive({
                id: entry.id,
                files: parsePatch(text),
                total: 0,
                complete: true
            })
        )
    } else {
        try {
            if (!worker) {
                const current = new Worker(new URL('./diff-worker.ts', import.meta.url), { type: 'module' })
                worker = current
                current.onmessage = (event: MessageEvent<DiffReply>) => {
                    if (worker === current) receive(event.data)
                }
                const fail = () => {
                    if (worker === current) failWorker()
                }
                current.onerror = fail
                current.onmessageerror = fail
            }
            worker.postMessage({ id: entry.id, text, priority } satisfies DiffRequest)
        } catch {
            failWorker()
        }
    }
    return entry
}

export function diffSnapshot(text: string): DiffSnapshot | undefined {
    return cache.get(text)?.snapshot
}
export function subscribeDiff(text: string, listener: () => void): () => void {
    const entry = prepare(text, 'foreground')
    entry.listeners.add(listener)
    return () => {
        entry.listeners.delete(listener)
        if (!entry.listeners.size && !entry.snapshot.complete) {
            worker?.postMessage({ id: entry.id, priority: 'background', cancel: true } satisfies DiffRequest)
            requests.delete(entry.id)
            cache.delete(text)
            entry.complete([])
        }
        trimCache()
    }
}
export function loadDiff(text: string, priority: DiffRequest['priority'] = 'foreground'): Promise<DiffFile[]> {
    if (priority === 'background' && !cache.has(text) && requests.size >= 2) return Promise.resolve([])
    return prepare(text, priority).promise
}
