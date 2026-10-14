import type { FileData, HunkTokens } from 'react-diff-view'
import { parseDiff } from 'react-diff-view'

import { required } from '../shared/required'

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

const requestWorker = (payload: DiffRequest): Promise<DiffReply> => {
    const { promise, resolve } = Promise.withResolvers<DiffReply>()
    try {
        worker ??= new Worker(new URL('diff-worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<DiffReply>) => {
            requests.get(event.data.id)?.(event.data)
            requests.delete(event.data.id)
        }
        worker.onerror = () => {
            for (const [id, complete] of requests) {
                complete({ id })
            }
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
    return promise
}

export const cachedDiffTokens = (file: FileData): HunkTokens | undefined => tokenCache.get(file)

const highlightAndCache = async (file: FileData): Promise<HunkTokens | undefined> => {
    let tokens: HunkTokens | undefined
    if (typeof Worker === 'undefined') {
        const { highlightDiff } = await import('./diff-syntax')
        tokens = highlightDiff(file)
    } else {
        nextId += 1
        const reply = await requestWorker({ file, id: nextId, type: 'highlight' })
        tokens = reply.tokens
    }
    tokenCache.set(file, tokens)
    pendingTokens.delete(file)
    return tokens
}

export const loadDiffTokens = (file: FileData): Promise<HunkTokens | undefined> => {
    if (tokenCache.has(file)) {
        return Promise.resolve(tokenCache.get(file))
    }
    const inflight = pendingTokens.get(file)
    if (inflight) {
        return inflight
    }
    const request = highlightAndCache(file)
    pendingTokens.set(file, request)
    return request
}

export const cachedDiff = (text: string): Files | undefined => cache.get(text)

const parseAndCache = async (text: string): Promise<Files> => {
    let files: Files
    if (typeof Worker === 'undefined') {
        // Defer synchronous parsing so the shared request is registered first.
        await Promise.resolve()
        try {
            files = parseDiff(text)
        } catch {
            files = []
        }
    } else {
        nextId += 1
        const reply = await requestWorker({ id: nextId, text, type: 'parse' })
        files = reply.files ?? []
    }
    cache.set(text, files)
    let bytes = 0
    for (const key of cache.keys()) {
        bytes += key.length * 2
    }
    while (cache.size > 3 || bytes > 6_000_000) {
        const oldest = required(cache.keys().next().value)
        bytes -= oldest.length * 2
        cache.delete(oldest)
    }
    pending.delete(text)
    return files
}

export const loadDiff = (text: string): Promise<Files> => {
    const known = cache.get(text)
    if (known) {
        return Promise.resolve(known)
    }
    const inflight = pending.get(text)
    if (inflight) {
        return inflight
    }
    const request = parseAndCache(text)
    pending.set(text, request)
    return request
}
