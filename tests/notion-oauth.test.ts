import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createOAuthHandler } from '../services/notion-oauth/src/handler'
import { NotionConnection } from '../src/main/notion-connection'

const origin = 'https://auth.example.com'
const config = { origin, clientId: 'public-app', clientSecret: 'server-only-secret', stateSecret: 's'.repeat(48) }
const verifier = 'v'.repeat(43)
const challenge = createHash('sha256').update(verifier).digest('base64url')
const nonce = 'n'.repeat(32)
const credentials = { access_token: 'access-one', refresh_token: 'refresh-one', workspace_id: 'workspace-one' }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const jsonRequest = (path: string, value: unknown) =>
    new Request(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
    })
const active: NotionConnection[] = []
afterEach(() => {
    active.splice(0).forEach((connection) => connection.cancel())
})

async function authorize(handler: ReturnType<typeof createOAuthHandler>, port = 12345) {
    const started = await handler(new Request(`${origin}/authorize?port=${port}&challenge=${challenge}&nonce=${nonce}`))
    expect(started.status).toBe(302)
    const location = new URL(started.headers.get('Location')!)
    expect(location.origin).toBe('https://api.notion.com')
    return location.searchParams.get('state')!
}

it('binds the browser callback and token exchange to the desktop verifier without a token in redirects', async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(response(credentials))
    const handler = createOAuthHandler(config, provider)
    const state = await authorize(handler)
    const callback = await handler(
        new Request(`${origin}/callback?state=${encodeURIComponent(state)}&code=one-use-code`)
    )
    const location = new URL(callback.headers.get('Location')!)
    expect(location.origin).toBe('http://127.0.0.1:12345')
    expect(location.pathname).toBe(`/callback/${nonce}`)
    expect(location.searchParams.get('code')).toBe('one-use-code')
    expect(location.toString()).not.toContain('access-one')
    expect((await handler(jsonRequest('/token', { state, code: 'one-use-code', verifier: 'wrong' }))).status).toBe(400)
    expect(provider).not.toHaveBeenCalled()
    const exchanged = await handler(jsonRequest('/token', { state, code: 'one-use-code', verifier }))
    expect(await exchanged.json()).toEqual(credentials)
    expect(exchanged.headers.get('Cache-Control')).toBe('no-store')
    const init = provider.mock.calls[0][1]!
    expect(new Headers(init.headers).get('Authorization')).toBe(
        `Basic ${Buffer.from('public-app:server-only-secret').toString('base64')}`
    )
    expect(JSON.parse(init.body as string)).toEqual({
        grant_type: 'authorization_code',
        code: 'one-use-code',
        redirect_uri: `${origin}/callback`
    })
})

it('rejects tampering, expiration, unsafe callbacks and oversized payloads before contacting Notion', async () => {
    const provider = vi.fn<typeof fetch>()
    let now = 1000000
    const handler = createOAuthHandler(config, provider, () => now)
    const state = await authorize(handler)
    for (const bad of [`${state}x`, 'invalid'])
        expect((await handler(new Request(`${origin}/callback?state=${bad}&code=x`))).status).toBe(400)
    now += 11 * 60_000
    expect((await handler(jsonRequest('/token', { state, code: 'x', verifier }))).status).toBe(400)
    for (const port of ['0', '65536', '12345@evil.example', '//evil.example'])
        expect(
            (await handler(new Request(`${origin}/authorize?port=${port}&challenge=${challenge}&nonce=${nonce}`)))
                .status
        ).toBe(400)
    expect((await handler(jsonRequest('/refresh', { refresh_token: 'x'.repeat(20000) }))).status).toBe(413)
    expect(provider).not.toHaveBeenCalled()
})

it('returns safe provider failures, forwards denial only to the paired app, and rotates refresh credentials', async () => {
    const provider = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response({ error: 'invalid_grant', message: config.clientSecret }, 400))
        .mockResolvedValueOnce(response(credentials))
    const handler = createOAuthHandler(config, provider)
    const state = await authorize(handler)
    const denial = await handler(new Request(`${origin}/callback?state=${state}&error=access_denied`))
    expect(new URL(denial.headers.get('Location')!).searchParams.get('error')).toBe('access_denied')
    const failed = await handler(jsonRequest('/refresh', { refresh_token: 'expired' }))
    expect(failed.status).toBe(401)
    expect(await failed.text()).not.toContain(config.clientSecret)
    expect(await (await handler(jsonRequest('/refresh', { refresh_token: 'valid' }))).json()).toEqual(credentials)
    expect(JSON.parse(provider.mock.calls[1][1]?.body as string)).toEqual({
        grant_type: 'refresh_token',
        refresh_token: 'valid'
    })
})

function desktop(serviceOrigin = origin) {
    const secrets = new Map<string, string>()
    const provider = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response(credentials)))
    const handler = createOAuthHandler({ ...config, origin: serviceOrigin }, provider)
    const fetcher: typeof fetch = (input, init) => handler(new Request(input, init))
    const connection = new NotionConnection(
        {
            get: (key) => secrets.get(key) ?? '',
            set: (key, value) => {
                secrets.set(key, value)
            }
        },
        serviceOrigin,
        fetcher
    )
    active.push(connection)
    return { connection, secrets, provider, handler }
}

async function approve(app: ReturnType<typeof desktop>) {
    const started = await app.connection.start()
    const authorization = await app.handler(new Request(started.url))
    const state = new URL(authorization.headers.get('Location')!).searchParams.get('state')!
    const serviceOrigin = new URL(started.url).origin
    const callback = await app.handler(new Request(`${serviceOrigin}/callback?state=${state}&code=approved`))
    const local = await fetch(callback.headers.get('Location')!)
    expect(local.status).toBe(200)
    return started
}

it.each([origin, 'http://localhost:8788'])(
    'connects through %s, persists tokens, refreshes and disconnects',
    async (serviceOrigin) => {
        const app = desktop(serviceOrigin)
        await approve(app)
        const result = await app.connection.poll()
        expect('pending' in result).toBe(false)
        expect(app.connection.connected()).toBe(false)
        expect(app.secrets.size).toBe(0)
        expect(await app.connection.pendingToken()).toBe('access-one')
        await app.connection.completeJournal((_setup, checkpoint) => {
            checkpoint('selected-page')
            return Promise.resolve({ kind: 'page', id: 'selected-page', titleProperty: 'Name', dateProperty: '' })
        })
        expect(app.connection.connected()).toBe(true)
        expect(await app.connection.token()).toBe('access-one')
        app.provider.mockImplementation(() =>
            Promise.resolve(response({ ...credentials, access_token: 'access-two', refresh_token: 'refresh-two' }))
        )
        expect(await Promise.all([app.connection.token(true), app.connection.token(true)])).toEqual([
            'access-two',
            'access-two'
        ])
        expect(app.provider).toHaveBeenCalledTimes(2)
        const restored = new NotionConnection(
            {
                get: (key) => app.secrets.get(key) ?? '',
                set: (key, value) => {
                    app.secrets.set(key, value)
                }
            },
            serviceOrigin
        )
        active.push(restored)
        expect(await restored.token()).toBe('access-two')
        app.connection.disconnect()
        expect(await app.connection.token()).toBe('')
        expect(app.secrets.get('notion')).toBe('')
    }
)

it('ignores an exchange completing after cancellation and closes the old callback listener', async () => {
    const app = desktop()
    await approve(app)
    let resolve!: (value: Response) => void
    app.provider.mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done
            })
    )
    const polling = app.connection.poll()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    app.connection.cancel()
    resolve(response(credentials))
    await expect(polling).rejects.toThrow(/cancel/i)
    expect(await app.connection.token()).toBe('')
})

it('does not resurrect a disconnected account after a delayed refresh; installed static tokens remain usable', async () => {
    const app = desktop()
    app.secrets.set('notion', 'installed-static-token')
    expect(await app.connection.token()).toBe('installed-static-token')
    await approve(app)
    await app.connection.poll()
    await app.connection.completeJournal((_setup, checkpoint) => {
        checkpoint('selected-page')
        return Promise.resolve({ kind: 'page', id: 'selected-page', titleProperty: 'Name', dateProperty: '' })
    })
    let resolve!: (value: Response) => void
    app.provider.mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done
            })
    )
    const refresh = app.connection.token(true)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    // Closing the settings authorization surface must not discard a valid rotated credential.
    app.connection.cancel()
    resolve(response({ ...credentials, access_token: 'after-close', refresh_token: 'after-close-refresh' }))
    expect(await refresh).toBe('after-close')
    const afterClose = app.connection.token(true)
    await vi.waitFor(() => expect(app.provider).toHaveBeenCalledTimes(3))
    app.connection.disconnect()
    resolve(response({ ...credentials, access_token: 'late-token' }))
    await expect(afterClose).rejects.toThrow(/cancel|disconnect/i)
    expect(await app.connection.token()).toBe('')
})

it('discards unconfirmed authorization, but finishes an explicitly confirmed operation after Settings closes', async () => {
    const app = desktop()
    await approve(app)
    await app.connection.poll()
    app.connection.cancel()
    expect(app.secrets.size).toBe(0)
    await expect(app.connection.pendingToken()).rejects.toThrow(/connect/i)
    await approve(app)
    await app.connection.poll()
    let finish!: () => void
    const saving = app.connection.completeJournal(async (_setup, checkpoint) => {
        checkpoint()
        await new Promise<void>((done) => {
            finish = done
        })
        checkpoint('confirmed-page')
        return { kind: 'page', id: 'confirmed-page', titleProperty: 'Name', dateProperty: '' }
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    app.connection.cancel()
    finish()
    expect((await saving).id).toBe('confirmed-page')
    expect(app.connection.connected()).toBe(true)
    expect(app.secrets.get('notion-setup')).toBe('')
})
