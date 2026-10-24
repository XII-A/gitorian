import { parseDiff, type FileData, type HunkTokens } from 'react-diff-view'
import { markBinaryDiffs } from '../shared/diff-format'

type Files = ReturnType<typeof parseDiff>
export type DiffRequest = { id: number } & ({ type: 'parse'; text: string } | { type: 'highlight'; file: FileData })
interface DiffReply {
    id: number
    files?: Files
    tokens?: HunkTokens
}
const cache = new Map<string, Files>()
const pending = new Map<string, Promise<Files>>()
const tokenCache = new WeakMap<FileData, HunkTokens | undefined>()
const pendingTokens = new WeakMap<FileData, Promise<HunkTokens | undefined>>()
const requests = new Map<number, (reply: DiffReply) => void>()
let worker: Worker | undefined
let nextId = 0

function requestWorker(payload: DiffRequest): Promise<DiffReply> {
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
            requests.set(payload.id, resolve)
            worker.postMessage(payload)
        } catch {
            requests.delete(payload.id)
            resolve({ id: payload.id })
        }
    })
}

export function cachedDiffTokens(file: FileData): HunkTokens | undefined {
    return tokenCache.get(file)
}

export function loadDiffTokens(file: FileData): Promise<HunkTokens | undefined> {
    if (tokenCache.has(file)) return Promise.resolve(tokenCache.get(file))
    const inflight = pendingTokens.get(file)
    if (inflight) return inflight
    const request = (
        typeof Worker === 'undefined'
            ? import('./diff-syntax').then(({ highlightDiff }) => highlightDiff(file))
            : requestWorker({ id: ++nextId, type: 'highlight', file }).then((reply) => reply.tokens)
    ).then((tokens) => {
        tokenCache.set(file, tokens)
        pendingTokens.delete(file)
        return tokens
    })
    pendingTokens.set(file, request)
    return request
}

export function cachedDiff(text: string): Files | undefined {
    return cache.get(text)
}
export function loadDiff(text: string): Promise<Files> {
    const known = cache.get(text)
    if (known) return Promise.resolve(known)
    const inflight = pending.get(text)
    if (inflight) return inflight
    const request = (
        typeof Worker === 'undefined'
            ? Promise.resolve().then(() => {
                  try {
                      return parseDiff(text)
                  } catch {
                      return []
                  }
              })
            : requestWorker({ id: ++nextId, type: 'parse', text }).then((reply) => reply.files ?? [])
    ).then((files) => {
        files = markBinaryDiffs(files, text)
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
