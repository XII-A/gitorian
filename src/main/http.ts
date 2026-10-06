export class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message)
    }
}
export class Http {
    private blockedUntil = new Map<string, number>()
    constructor(private readonly fetcher: typeof fetch = fetch) {}
    async request<T>(url: string, token: string, init: RequestInit = {}, format: 'json' | 'text' = 'json'): Promise<T> {
        const host = new URL(url).host
        const remaining = (this.blockedUntil.get(host) ?? 0) - Date.now()
        if (remaining > 0) throw new Error(`Service rate limit; try again in ${Math.ceil(remaining / 1000)} seconds`)
        const headers = new Headers(init.headers)
        headers.set('Content-Type', 'application/json')
        headers.set('Authorization', `Bearer ${token}`)
        if (host === 'api.notion.com') headers.set('Notion-Version', '2025-09-03')
        else {
            if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json')
            headers.set('X-GitHub-Api-Version', '2022-11-28')
        }
        const response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(30000), headers })
        if (
            response.status === 429 ||
            (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
        ) {
            const delay = Number(response.headers.get('retry-after') ?? 60) * 1000
            const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
            this.blockedUntil.set(host, Math.max(Date.now() + delay, reset))
        }
        if (!response.ok)
            throw new HttpError(response.status, `Service returned ${response.status}: ${response.statusText}`)
        return (format === 'text' ? await response.text() : await response.json()) as T
    }
}
