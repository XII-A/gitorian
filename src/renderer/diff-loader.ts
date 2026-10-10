import { parseDiff } from 'react-diff-view'

type Files = ReturnType<typeof parseDiff>
const cache = new Map<string, Files>()
const pending = new Map<string, Promise<Files>>()
const requests = new Map<number, (files: Files) => void>()
let worker: Worker | undefined
let nextId = 0

export function cachedDiff(text: string): Files | undefined {
    return cache.get(text)
}
export function loadDiff(text: string): Promise<Files> {
    const known = cache.get(text)
    if (known) return Promise.resolve(known)
    const inflight = pending.get(text)
    if (inflight) return inflight
    const request = new Promise<Files>((resolve) => {
        if (typeof Worker === 'undefined') {
            try {
                resolve(parseDiff(text))
            } catch {
                resolve([])
            }
            return
        }
        worker ??= new Worker(new URL('./diff-worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ id: number; files: Files }>) => {
            requests.get(event.data.id)?.(event.data.files)
            requests.delete(event.data.id)
        }
        worker.onerror = () => {
            for (const resolve of requests.values()) resolve([])
            requests.clear()
            worker?.terminate()
            worker = undefined
        }
        const id = ++nextId
        requests.set(id, resolve)
        worker.postMessage({ id, text })
    }).then((files) => {
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
