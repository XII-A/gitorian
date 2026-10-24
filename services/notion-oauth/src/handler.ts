import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Data, Effect, Schema } from 'effect'
import { attemptLifetime, callbackPath, credentialSchema } from './protocol'

export interface OAuthConfig {
    origin: string
    clientId: string
    clientSecret: string
    stateSecret: string
}
class OAuthFailure extends Data.TaggedError('OAuthFailure')<{ status: number; message: string }> {}
const stateSchema = Schema.Struct({
    port: Schema.Number,
    challenge: Schema.String,
    nonce: Schema.String,
    expires: Schema.Number
})
const exchangeSchema = Schema.Struct({
    state: Schema.NonEmptyString,
    grant: Schema.NonEmptyString,
    verifier: Schema.String
})
const refreshSchema = Schema.Struct({ refresh_token: Schema.NonEmptyString })
const safeHeaders = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
}
const failure = (status: number, message: string) => new OAuthFailure({ status, message })
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export function createOAuthHandler(config: OAuthConfig, fetcher: typeof fetch = fetch, now = Date.now) {
    const origin = new URL(config.origin).origin
    if (
        origin !== config.origin ||
        (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) ||
        !config.clientId ||
        !config.clientSecret ||
        config.stateSecret.length < 32
    )
        throw new Error(
            'Configure the OAuth origin, client ID, client secret and a state secret of at least 32 characters.'
        )
    const signature = (payload: string) => createHmac('sha256', config.stateSecret).update(payload).digest('base64url')
    const handoffKey = createHmac('sha256', config.stateSecret)
        .update(`weekly-j:notion:handoff:v1:${origin}:${config.clientId}`)
        .digest()
    const sealCode = (code: string, state: string) => {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', handoffKey, iv)
        cipher.setAAD(Buffer.from(state))
        const sealed = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()])
        return [iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64url')).join('.')
    }
    const openCode = (grant: string, state: string) =>
        Effect.try({
            try: () => {
                if (grant.length > 2048) throw new Error('Invalid handoff')
                const parts = grant.split('.')
                if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
                    throw new Error('Invalid handoff')
                const [iv, tag, sealed] = parts.map((part) => Buffer.from(part, 'base64url'))
                if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid handoff')
                const cipher = createDecipheriv('aes-256-gcm', handoffKey, iv)
                cipher.setAAD(Buffer.from(state))
                cipher.setAuthTag(tag)
                const code = Buffer.concat([cipher.update(sealed), cipher.final()]).toString('utf8')
                if (!code || code.length > 1024) throw new Error('Invalid handoff')
                return code
            },
            catch: () => failure(400, 'Invalid sign-in. Start again in weekly-j.')
        })
    const readState = (state: string) =>
        Effect.try({
            try: () => {
                if (state.length > 2048) throw failure(400, 'Sign-in expired. Start again in weekly-j.')
                const [payload, signed, extra] = state.split('.')
                if (!payload || !signed || extra || !equal(signature(payload), signed))
                    throw failure(400, 'Invalid sign-in. Start again in weekly-j.')
                const decoded = Schema.decodeUnknownSync(stateSchema)(
                    JSON.parse(Buffer.from(payload, 'base64url').toString())
                )
                if (
                    decoded.expires <= now() ||
                    decoded.expires > now() + attemptLifetime ||
                    !Number.isInteger(decoded.port) ||
                    decoded.port < 1 ||
                    decoded.port > 65535 ||
                    !/^[A-Za-z0-9_-]{32,64}$/.test(decoded.nonce) ||
                    !/^[A-Za-z0-9_-]{43}$/.test(decoded.challenge)
                )
                    throw failure(400, 'Sign-in expired. Start again in weekly-j.')
                return decoded
            },
            catch: () => failure(400, 'Invalid or expired sign-in. Start again in weekly-j.')
        })
    const body = <A, I>(request: Request, schema: Schema.Schema<A, I>) =>
        Effect.gen(function* () {
            if (!request.headers.get('Content-Type')?.startsWith('application/json'))
                return yield* failure(415, 'Send a JSON request.')
            // Bound streaming reads as well as declared Content-Length.
            const raw = yield* Effect.tryPromise({
                try: async () => {
                    const reader = request.body?.getReader()
                    if (!reader) return ''
                    const chunks: Uint8Array[] = []
                    let size = 0
                    try {
                        for (;;) {
                            const part = await reader.read()
                            if (part.done) break
                            size += part.value.byteLength
                            if (size > 8192) throw failure(413, 'Request is too large.')
                            chunks.push(part.value)
                        }
                        return Buffer.concat(chunks).toString('utf8')
                    } finally {
                        await reader.cancel()
                    }
                },
                catch: (error) => (error instanceof OAuthFailure ? error : failure(400, 'Invalid request.'))
            })
            return yield* Effect.try({
                try: () => Schema.decodeUnknownSync(schema)(JSON.parse(raw)),
                catch: () => failure(400, 'Invalid request.')
            })
        })
    const token = (payload: Record<string, string>) =>
        Effect.gen(function* () {
            const response = yield* Effect.tryPromise({
                try: () =>
                    fetcher('https://api.notion.com/v1/oauth/token', {
                        method: 'POST',
                        redirect: 'error',
                        signal: AbortSignal.timeout(20000),
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
                        },
                        body: JSON.stringify(payload)
                    }),
                catch: () => failure(502, 'Notion could not be reached. Try connecting again.')
            })
            if (!response.ok)
                return yield* failure(
                    response.status < 500 ? 401 : 502,
                    'Notion authorization could not be completed. Connect again.'
                )
            return yield* Effect.tryPromise({
                try: async () => Schema.decodeUnknownSync(credentialSchema)(await response.json()),
                catch: () => failure(502, 'Notion returned an incomplete connection. Connect again.')
            })
        })
    return (request: Request): Promise<Response> =>
        Effect.runPromise(
            Effect.gen(function* () {
                const url = new URL(request.url)
                if (url.origin !== origin) return yield* failure(400, 'Invalid OAuth origin.')
                if (request.method === 'GET' && url.pathname === '/health') return Response.json({ ready: true })
                if (request.method === 'GET' && url.pathname === '/authorize') {
                    const port = Number(url.searchParams.get('port'))
                    const challenge = url.searchParams.get('challenge') ?? ''
                    const nonce = url.searchParams.get('nonce') ?? ''
                    if (
                        !Number.isInteger(port) ||
                        port < 1 ||
                        port > 65535 ||
                        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
                        !/^[A-Za-z0-9_-]{32,64}$/.test(nonce)
                    )
                        return yield* failure(400, 'Start sign-in from weekly-j.')
                    const payload = Buffer.from(
                        JSON.stringify({ port, challenge, nonce, expires: now() + attemptLifetime })
                    ).toString('base64url')
                    const authorize = new URL('https://api.notion.com/v1/oauth/authorize')
                    authorize.search = new URLSearchParams({
                        client_id: config.clientId,
                        redirect_uri: `${origin}${callbackPath}`,
                        response_type: 'code',
                        owner: 'user',
                        state: `${payload}.${signature(payload)}`
                    }).toString()
                    return new Response(null, { status: 302, headers: { Location: authorize.toString() } })
                }
                if (request.method === 'GET' && url.pathname === callbackPath) {
                    const state = url.searchParams.get('state') ?? ''
                    const decoded = yield* readState(state)
                    const redirect = new URL(`http://127.0.0.1:${decoded.port}/callback/${decoded.nonce}`)
                    redirect.searchParams.set('state', state)
                    if (url.searchParams.has('error')) redirect.searchParams.set('error', 'access_denied')
                    else {
                        const code = url.searchParams.get('code')
                        if (!code || code.length > 1024)
                            return yield* failure(400, 'Authorization code is missing. Connect again.')
                        redirect.searchParams.set('grant', sealCode(code, state))
                    }
                    return new Response(null, { status: 302, headers: { Location: redirect.toString() } })
                }
                if (request.method === 'POST' && url.pathname === '/token') {
                    const input = yield* body(request, exchangeSchema)
                    const state = yield* readState(input.state)
                    if (
                        !/^[A-Za-z0-9_-]{43,128}$/.test(input.verifier) ||
                        !equal(createHash('sha256').update(input.verifier).digest('base64url'), state.challenge)
                    )
                        return yield* failure(400, 'Invalid sign-in. Start again in weekly-j.')
                    const code = yield* openCode(input.grant, input.state)
                    return Response.json(
                        yield* token({
                            grant_type: 'authorization_code',
                            code,
                            redirect_uri: `${origin}${callbackPath}`
                        })
                    )
                }
                if (request.method === 'POST' && url.pathname === '/refresh') {
                    const input = yield* body(request, refreshSchema)
                    return Response.json(
                        yield* token({ grant_type: 'refresh_token', refresh_token: input.refresh_token })
                    )
                }
                return yield* failure(404, 'Route not found.')
            }).pipe(
                Effect.catchTag('OAuthFailure', (error) =>
                    Effect.succeed(Response.json({ message: error.message }, { status: error.status }))
                ),
                Effect.map((response) => {
                    for (const [name, value] of Object.entries(safeHeaders)) response.headers.set(name, value)
                    return response
                })
            )
        )
}

export function oauthConfig(env: Record<string, string | undefined>): OAuthConfig {
    return {
        origin: env.NOTION_OAUTH_ORIGIN ?? '',
        clientId: env.NOTION_CLIENT_ID ?? '',
        clientSecret: env.NOTION_CLIENT_SECRET ?? '',
        stateSecret: env.NOTION_STATE_SECRET ?? ''
    }
}
