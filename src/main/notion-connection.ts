import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { attemptLifetime, credentialSchema } from '../../services/notion-oauth/src/protocol'
import type { Destination } from '../shared/model'
import type { JournalSetupStore } from './notion-setup'

interface CredentialStore {
    get: (key: string) => string
    set: (key: string, value: string) => void
}
export interface JournalSetup {
    id: string
    started: boolean
    pageId?: string
    title?: string
}
const sessionSchema = Schema.Struct({
    ...credentialSchema.fields,
    origin: Schema.NonEmptyString,
    journal: Schema.Struct({
        id: Schema.NonEmptyString,
        started: Schema.Boolean,
        pageId: Schema.optional(Schema.NonEmptyString),
        title: Schema.optional(Schema.NonEmptyString)
    })
})
type Session = Omit<typeof sessionSchema.Type, 'journal'> & { journal: JournalSetup }
function decodeTokens(value: unknown) {
    try {
        return Schema.decodeUnknownSync(credentialSchema)(value)
    } catch {
        throw new Error('Notion returned an incomplete connection. Connect again.')
    }
}
interface Attempt {
    server: Server
    nonce: string
    verifier: string
    expires: number
    callback?: { state: string; code: string }
    error?: string
    exchange?: Promise<void>
    timer: ReturnType<typeof setTimeout>
}

/** Owns the desktop connection lifetime. Only this module reads or rotates Notion credentials. */
export class NotionConnection {
    private attempt?: Attempt
    private generation = 0
    private credentialGeneration = 0
    private refreshing?: Promise<string>
    private completing?: Promise<Destination>
    private pending?: Session
    private pendingInstalled = false
    private pendingRefreshing?: Promise<string>
    constructor(
        private readonly vault: CredentialStore,
        private readonly origin: string,
        private readonly fetcher: typeof fetch,
        private readonly recovery: JournalSetupStore
    ) {}

    private session(key = 'notion'): Session | undefined {
        const raw = this.vault.get(key)
        if (!raw.startsWith('{')) return undefined // Real installations may still have a static integration token.
        try {
            return Schema.decodeUnknownSync(sessionSchema)(JSON.parse(raw))
        } catch {
            return undefined
        }
    }
    private save(session: Session) {
        this.vault.set('notion', JSON.stringify(session))
    }
    private request(path: string, body?: unknown, origin = this.origin): Promise<unknown> {
        return Effect.runPromise(
            Effect.tryPromise({
                try: async () => {
                    const target = new URL(origin)
                    if (
                        target.origin !== origin ||
                        (target.protocol !== 'https:' &&
                            !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))
                    )
                        throw new Error('Notion sign-in is unavailable. Check the connection configuration.')
                    const response = await this.fetcher(`${origin}${path}`, {
                        method: body ? 'POST' : 'GET',
                        redirect: 'error',
                        headers: { 'Content-Type': 'application/json' },
                        ...(body ? { body: JSON.stringify(body) } : {}),
                        signal: AbortSignal.timeout(25000)
                    })
                    if (!response.ok)
                        throw new Error(
                            response.status === 503
                                ? 'Configure the local Notion OAuth module before connecting.'
                                : response.status === 401
                                  ? 'Notion authorization expired. Connect again.'
                                  : 'Notion could not connect. Try again.'
                        )
                    return response.json()
                },
                catch: (error) => (error instanceof Error ? error : new Error('Notion could not connect. Try again.'))
            })
        )
    }
    async start(): Promise<{ url: string; interval: number }> {
        if (this.completing) throw new Error('Notion is finishing setup. Try again in a moment.')
        this.cancel()
        const generation = this.generation
        if (!this.origin) throw new Error('Notion sign-in is unavailable. Check the connection configuration.')
        await this.request('/health')
        if (generation !== this.generation) throw new Error('Notion connection cancelled.')
        const nonce = randomBytes(24).toString('base64url')
        const verifier = randomBytes(32).toString('base64url')
        const server = createServer((incoming, outgoing) => {
            const current = this.attempt
            const url = new URL(incoming.url ?? '/', 'http://127.0.0.1')
            const host = `127.0.0.1:${(server.address() as { port: number } | null)?.port}`
            if (
                !current ||
                current.server !== server ||
                incoming.method !== 'GET' ||
                incoming.headers.host !== host ||
                url.pathname !== `/callback/${nonce}` ||
                current.callback ||
                current.error
            ) {
                outgoing.writeHead(400).end()
                return
            }
            const state = url.searchParams.get('state')
            const code = url.searchParams.get('code')
            if (!state || state.length > 2048 || (!code && !url.searchParams.has('error'))) {
                outgoing.writeHead(400).end()
                return
            }
            if (Date.now() >= current.expires) current.error = 'Notion sign-in expired. Connect again.'
            else if (url.searchParams.has('error')) current.error = 'Notion authorization declined. Connect again.'
            else if (code && code.length <= 1024) current.callback = { state, code }
            else {
                outgoing.writeHead(400).end()
                return
            }
            outgoing.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
            })
            outgoing.end(
                '<!doctype html><html lang="en"><meta charset="utf-8"><title>weekly-j</title><p>Return to weekly-j to finish connecting Notion.</p></html>'
            )
            server.close()
        })
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', resolve)
        })
        if (generation !== this.generation) {
            server.close()
            throw new Error('Notion connection cancelled.')
        }
        const port = (server.address() as { port: number }).port
        const attempt: Attempt = {
            server,
            nonce,
            verifier,
            expires: Date.now() + attemptLifetime,
            timer: setTimeout(() => {
                attempt.error = 'Notion sign-in expired. Connect again.'
                server.close()
            }, attemptLifetime)
        }
        attempt.timer.unref()
        this.attempt = attempt
        const url = new URL(`${this.origin}/authorize`)
        url.search = new URLSearchParams({
            port: String(port),
            challenge: createHash('sha256').update(verifier).digest('base64url'),
            nonce
        }).toString()
        return { url: url.toString(), interval: 1 }
    }
    async poll(): Promise<{ pending: true; interval: number } | { authorized: true }> {
        const current = this.attempt
        if (!current) throw new Error('Notion connection cancelled. Connect again.')
        if (current.error) throw new Error(current.error)
        if (Date.now() >= current.expires) throw new Error('Notion sign-in expired. Connect again.')
        if (!current.callback) return { pending: true, interval: 1 }
        const generation = this.generation
        current.exchange ??= (async () => {
            const tokens = decodeTokens(
                await this.request('/token', { ...current.callback, verifier: current.verifier })
            )
            if (this.generation !== generation) throw new Error('Notion connection cancelled.')
            this.pendingInstalled = false
            this.pending = {
                ...tokens,
                origin: this.origin,
                journal: this.recovery.get(tokens.workspace_id) ?? {
                    id: randomBytes(16).toString('hex'),
                    started: false
                }
            }
            clearTimeout(current.timer)
        })()
        await current.exchange
        if (generation !== this.generation) throw new Error('Notion connection cancelled.')
        return { authorized: true }
    }
    pendingToken(refresh = false, rejected?: string): Promise<string> {
        const session = this.pending
        if (!session) return Promise.reject(new Error('Connect Notion before choosing a page.'))
        if (this.pendingInstalled) return this.token(refresh, rejected)
        if (!refresh || (rejected && session.access_token !== rejected)) return Promise.resolve(session.access_token)
        if (this.pendingRefreshing) return this.pendingRefreshing
        const request = (async () => {
            const tokens = decodeTokens(
                await this.request('/refresh', { refresh_token: session.refresh_token }, session.origin)
            )
            if (this.pending !== session) throw new Error('Notion connection cancelled.')
            if (tokens.workspace_id !== session.workspace_id)
                throw new Error('Notion workspace changed. Connect again.')
            Object.assign(session, tokens)
            return tokens.access_token
        })().finally(() => {
            if (this.pendingRefreshing === request) this.pendingRefreshing = undefined
        })
        this.pendingRefreshing = request
        return request
    }
    choose(): boolean {
        if (this.completing) throw new Error('Notion is finishing setup. Try again in a moment.')
        const session = this.session()
        if (!session) return false
        this.cancel()
        this.pendingInstalled = true
        this.pending = {
            ...session,
            journal: this.recovery.get(session.workspace_id) ?? { id: randomBytes(16).toString('hex'), started: false }
        }
        return true
    }
    token(refresh = false, rejected?: string): Promise<string> {
        const raw = this.vault.get('notion')
        const session = this.session()
        if (!session) return Promise.resolve(raw.startsWith('{') ? '' : raw)
        if (!refresh) return Promise.resolve(session.access_token)
        if (rejected && session.access_token !== rejected) return Promise.resolve(session.access_token)
        if (this.refreshing) return this.refreshing
        const generation = this.credentialGeneration
        const request = (async () => {
            const tokens = decodeTokens(
                await this.request('/refresh', { refresh_token: session.refresh_token }, session.origin)
            )
            const current = this.session()
            if (generation !== this.credentialGeneration || current?.refresh_token !== session.refresh_token)
                throw new Error('Notion connection cancelled or disconnected.')
            if (tokens.workspace_id !== session.workspace_id)
                throw new Error('Notion workspace changed. Connect again.')
            this.save({ ...current, ...tokens })
            return tokens.access_token
        })().finally(() => {
            if (this.refreshing === request) this.refreshing = undefined
        })
        this.refreshing = request
        return request
    }
    connected(): boolean {
        const raw = this.vault.get('notion')
        return !!raw && (raw.startsWith('{') ? !!this.session()?.journal.pageId : true)
    }
    profileKey(): string {
        return this.session()?.access_token ?? this.vault.get('notion')
    }
    completeJournal(
        prepare: (setup: JournalSetup, checkpoint: (pageId?: string) => void) => Promise<Destination>,
        title?: string
    ): Promise<Destination> {
        if (this.completing) return this.completing
        const generation = this.credentialGeneration
        const session = this.pending
        if (!session) return Promise.reject(new Error('Connect Notion before preparing your journal.'))
        if (session.journal.started && title && session.journal.title !== title)
            return Promise.reject(new Error('Finish creating the original page or choose an existing page.'))
        if (title) session.journal = { ...session.journal, title }
        const setup = session.journal
        const check = () => {
            if (generation !== this.credentialGeneration) throw new Error('Notion connection cancelled.')
        }
        const request = Promise.resolve()
            .then(() =>
                prepare(setup, (pageId) => {
                    check()
                    const journal = { ...session.journal, started: true, ...(pageId ? { pageId } : {}) }
                    this.recovery.set(session.workspace_id, journal)
                    session.journal = journal
                })
            )
            .then(async (destination) => {
                // A refresh that began before confirmation owns the rotated credentials.
                const refreshing = this.pendingInstalled ? this.refreshing : this.pendingRefreshing
                if (refreshing) await refreshing
                check()
                const latest = this.pendingInstalled ? this.session() : session
                if (!latest) throw new Error('Notion connection cancelled.')
                this.save({ ...latest, journal: { ...session.journal, pageId: destination.id } })
                this.credentialGeneration++
                this.refreshing = undefined
                this.pending = undefined
                this.vault.set('notion-setup', '')
                return destination
            })
            .finally(() => {
                if (this.completing === request) this.completing = undefined
            })
        this.completing = request
        return request
    }
    destinationSaved(): void {
        const session = this.session()
        if (session) this.recovery.clear(session.workspace_id)
    }
    cancel(): void {
        this.generation++
        if (!this.completing) {
            this.pending = undefined
            this.pendingRefreshing = undefined
        }
        if (this.attempt) {
            clearTimeout(this.attempt.timer)
            this.attempt.server.close()
            this.attempt = undefined
        }
    }
    disconnect(): void {
        this.cancel()
        this.credentialGeneration++
        this.refreshing = undefined
        this.vault.set('notion', '')
        this.vault.set('notion-setup', '')
        this.pending = undefined
    }
}
