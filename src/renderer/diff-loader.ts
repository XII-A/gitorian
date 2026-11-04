import { parsePatch, type DiffFile } from './diff-model'
export interface DiffRequest {
    id: number
    text: string
}
interface DiffReply {
    id: number
    files?: DiffFile[]
}
const cache = new Map<string, DiffFile[]>()
const pending = new Map<string, Promise<DiffFile[]>>()
const requests = new Map<number, (reply: DiffReply) => void>()
let worker: Worker | undefined
let nextId = 0

function requestWorker(text: string): Promise<DiffReply> {
    const id = ++nextId
    return new Promise((resolve) => {
        try {
            worker ??= new Worker(new URL('./diff-worker.ts', import.meta.url), { type: 'module' })
            worker.onmessage = (event: MessageEvent<DiffReply>) => {
                requests.get(event.data.id)?.(event.data)
                requests.delete(event.data.id)
            }
            worker.onerror = () => {
                for (const [id, complete] of requests) complete({ id })
                requests.clear()
                worker?.terminate()
                worker = undefined
            }
            requests.set(id, resolve)
            worker.postMessage({ id, text } satisfies DiffRequest)
        } catch {
            requests.delete(id)
            resolve({ id })
        }
    })
}

export function cachedDiff(text: string): DiffFile[] | undefined {
    return cache.get(text)
}
export function loadDiff(text: string): Promise<DiffFile[]> {
    const known = cache.get(text)
    if (known) return Promise.resolve(known)
    const inflight = pending.get(text)
    if (inflight) return inflight
    const request = (
        typeof Worker === 'undefined'
            ? Promise.resolve().then(() => parsePatch(text))
            : requestWorker(text).then((reply) => reply.files ?? [])
    ).then((files) => {
        cache.set(text, files)
        let bytes = [...cache.keys()].reduce((total, key) => total + key.length * 2, 0)
        while (cache.size > 3 || bytes > 6_000_000) {
            const oldest = cache.keys().next().value!
            bytes -= oldest.length * 2
            cache.delete(oldest)
        }
        pending.delete(text)
        return files
    })
    pending.set(text, request)
    return request
}
