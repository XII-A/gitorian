import { createHash } from 'node:crypto'
import { WorkQueue } from './work-queue'

export class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly retryAt?: number
    ) {
        super(message)
    }
}
interface ReadOptions {
    background?: boolean
    maxBytes?: number
}
interface PauseStore {
    pauses: Record<string, number>
    changed: () => void
}
interface CachedResponse {
    etag: string
    value: unknown
    bytes: number
}

export class Http {
    private lanes = new Map<string, WorkQueue>()
    private inflight = new Map<string, Promise<unknown>>()
    private cache = new Map<string, CachedResponse>()
    private cacheBytes = 0
    private budgets = new Map<string, { remaining: number; reset: number }>()
    private lastRequest = new Map<string, number>()
    private readonly pauses: Record<string, number>
    constructor(
        private readonly fetcher: typeof fetch = fetch,
        private readonly pauseStore?: PauseStore
    ) {
        this.pauses = pauseStore?.pauses ?? {}
    }
    request<T>(
        url: string,
        token: string,
        init: RequestInit = {},
        format: 'json' | 'text' = 'json',
        options: ReadOptions = {}
    ): Promise<T> {
        const host = new URL(url).host
        const scope = `${host}:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`
        const headers = new Headers(init.headers)
        if (!(init.body instanceof FormData) && !headers.has('Content-Type'))
            headers.set('Content-Type', 'application/json')
        headers.set('Authorization', `Bearer ${token}`)
        if (host === 'api.notion.com') {
            if (!headers.has('Notion-Version')) headers.set('Notion-Version', '2025-09-03')
        } else {
            if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json')
            headers.set('X-GitHub-Api-Version', '2022-11-28')
        }
        const read = !init.method || init.method === 'GET'
        const key = `${scope}:${url}:${headers.get('Accept')}:${format}:${options.maxBytes ?? 8_000_000}`
        const shared = read && !init.signal
        const existing = shared ? this.inflight.get(key) : undefined
        if (existing) return existing as Promise<T>
        const run = () => this.perform<T>(scope, key, url, headers, init, format, options)
        let lane = this.lanes.get(scope)
        if (!lane) {
            lane = new WorkQueue(1)
            this.lanes.set(scope, lane)
        }
        const request = (host === 'api.github.com' ? lane.run(run, options.background ? 0 : 1) : run()).finally(() => {
            if (this.inflight.get(key) === request) this.inflight.delete(key)
        })
        if (shared) this.inflight.set(key, request)
        return request
    }
    private pause(scope: string, until: number): void {
        this.pauses[scope] = Math.max(this.pauses[scope] ?? 0, until)
        this.pauseStore?.changed()
    }
    private async perform<T>(
        scope: string,
        key: string,
        url: string,
        headers: Headers,
        init: RequestInit,
        format: 'json' | 'text',
        options: ReadOptions
    ): Promise<T> {
        const github = new URL(url).host === 'api.github.com'
        const read = !init.method || init.method === 'GET'
        const cached = read ? this.cache.get(key) : undefined
        if (cached) headers.set('If-None-Match', cached.etag)
        for (let attempt = 0; ; attempt++) {
            const until = this.pauses[scope] ?? 0
            if (until > Date.now())
                throw new HttpError(
                    429,
                    `Service rate limit; requests paused until ${new Date(until).toLocaleString()}. Cached work is available.`,
                    until
                )
            const budget = this.budgets.get(scope)
            if (github && options.background && budget && budget.reset > Date.now() && budget.remaining <= 500)
                throw new HttpError(
                    429,
                    'Background GitHub refresh paused to preserve quota for opening changes.',
                    budget.reset
                )
            if (github && options.background) {
                const delay = Math.max(0, 150 - (Date.now() - (this.lastRequest.get(scope) ?? 0)))
                if (delay) await new Promise((done) => setTimeout(done, delay))
            }
            init.signal?.throwIfAborted()
            this.lastRequest.set(scope, Date.now())
            try {
                const timeout = AbortSignal.timeout(30000)
                const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout
                const response = await this.fetcher(url, { ...init, signal, headers })
                const remaining = response.headers.get('x-ratelimit-remaining')
                const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
                if (remaining !== null) this.budgets.set(scope, { remaining: Number(remaining), reset })
                if (remaining === '0' && reset) this.pause(scope, reset)
                if (response.status === 304 && cached) return cached.value as T
                const body = await this.body(response, options.maxBytes ?? 8_000_000)
                const secondary =
                    response.status === 403 &&
                    (/secondary rate limit|abuse detection/i.test(body) || response.headers.has('retry-after'))
                if (response.status === 429 || secondary || (response.status === 403 && remaining === '0')) {
                    const retry = response.headers.get('retry-after')
                    const delay = retry
                        ? /^\d+$/.test(retry)
                            ? Number(retry) * 1000
                            : Math.max(0, Date.parse(retry) - Date.now())
                        : 60000
                    const retryAt = Math.max(Date.now() + delay, remaining === '0' ? reset : 0)
                    this.pause(scope, retryAt)
                    throw new HttpError(
                        response.status,
                        `Source returned ${response.status}: rate limit. Retry after ${new Date(retryAt).toLocaleString()}.`,
                        retryAt
                    )
                }
                if (!response.ok) {
                    if (read && response.status >= 500 && attempt < 2) {
                        await this.retry(attempt)
                        continue
                    }
                    const detail =
                        response.status === 401
                            ? 'Reconnect the account in Settings.'
                            : response.status === 403
                              ? 'The connected account does not have permission for this source.'
                              : response.status === 404
                                ? 'This source is missing or inaccessible to the connected account.'
                                : response.statusText
                    throw new HttpError(response.status, `Source returned ${response.status}. ${detail}`)
                }
                const value = format === 'text' ? body : (JSON.parse(body) as unknown)
                const etag = response.headers.get('etag')
                if (read && etag) {
                    const previous = this.cache.get(key)
                    if (previous) this.cacheBytes -= previous.bytes
                    this.cache.delete(key)
                    this.cache.set(key, { etag, value, bytes: body.length * 2 })
                    this.cacheBytes += body.length * 2
                    while (this.cacheBytes > 20_000_000 || this.cache.size > 200) {
                        const oldest = this.cache.keys().next().value!
                        this.cacheBytes -= this.cache.get(oldest)!.bytes
                        this.cache.delete(oldest)
                    }
                }
                return value as T
            } catch (error) {
                if (read && !(error instanceof HttpError) && !init.signal?.aborted && attempt < 2) {
                    await this.retry(attempt)
                    continue
                }
                throw error
            }
        }
    }
    private retry(attempt: number): Promise<void> {
        return new Promise((done) => setTimeout(done, 200 * 2 ** attempt + Math.floor(Math.random() * 100)))
    }
    private async body(response: Response, maxBytes: number): Promise<string> {
        if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
            await response.body?.cancel()
            throw new HttpError(413, 'Changes are too large to display. Open the source externally.')
        }
        const reader = response.body?.getReader()
        if (!reader) return ''
        const decoder = new TextDecoder()
        let bytes = 0
        let text = ''
        while (true) {
            const part = await reader.read()
            if (part.done) break
            bytes += part.value.byteLength
            if (bytes > maxBytes) {
                await reader.cancel()
                throw new HttpError(413, 'Changes are too large to display. Open the source externally.')
            }
            text += decoder.decode(part.value, { stream: true })
        }
        return text + decoder.decode()
    }
}
