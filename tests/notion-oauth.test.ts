import { providerHttp } from './transport-fixtures'
import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createOAuthHandler } from '../services/notion-oauth/src/handler'
import { Notion } from '../src/main/notion'
import type { Destination } from '../src/shared/model'
import type { JournalSetup } from '../src/main/notion-connection'
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
it.each([false, true])(
    'credential staging failure preserves the persisted pair across restart (installed=%s)',
    async (hasInstalled) => {
        const app = desktop()
        let destination: Destination | undefined = hasInstalled ? await installed(app) : undefined
        const previous = destination
        const next = {
            ...credentials,
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            workspace_id: 'new-workspace'
        }
        app.provider.mockImplementation(() => Promise.resolve(response(next)))
        await approve(app)
        await app.connection.poll()
        let creations = 0
        const confirm = () =>
            app.connection.completeJournal(
                (setup, checkpoint) => {
                    if (!setup.pageId) creations++
                    checkpoint('new-journal')
                    return Promise.resolve({ ...selectedPage, id: 'new-journal' })
                },
                'New journal',
                (value) => {
                    destination = value
                    return Promise.resolve()
                }
            )
        const write = vi.spyOn(app.secrets, 'set').mockImplementationOnce(() => {
            throw new Error('Credential file is locked')
        })
        await expect(confirm()).rejects.toThrow(/Credential file/)
        expect(destination).toEqual(previous)
        const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
        expect(restarted.connection.connected()).toBe(hasInstalled)
        expect(await restarted.connection.token()).toBe(hasInstalled ? 'access-one' : '')
        write.mockRestore()
        await expect(confirm()).resolves.toMatchObject({ id: 'new-journal' })
        const committed = desktop(origin, new Map(), { secrets: app.secrets, destination })
        expect(committed.connection.connected()).toBe(true)
        expect(await committed.connection.token()).toBe('new-access')
        expect(creations).toBe(1)
    }
)
it('restart selects staged credentials if the process dies immediately after the destination commit', async () => {
    const app = desktop()
    let destination = await installed(app)
    app.provider.mockImplementation(() =>
        Promise.resolve(response({ ...credentials, access_token: 'new-access', refresh_token: 'new-refresh' }))
    )
    await approve(app)
    await app.connection.poll()
    await expect(
        app.connection.completeJournal(
            (_setup, checkpoint) => {
                checkpoint('new-journal')
                return Promise.resolve({ ...selectedPage, id: 'new-journal' })
            },
            undefined,
            (value) => {
                destination = value
                return Promise.reject(new Error('Process terminated after SQLite commit'))
            }
        )
    ).rejects.toThrow(/Process terminated/)
    const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
    expect(restarted.connection.connected()).toBe(true)
    expect(await restarted.connection.token()).toBe('new-access')
    expect(destination.id).toBe('new-journal')
})
it('does not fall back to legacy credentials when the committed credential slot is unavailable', async () => {
    const app = desktop()
    const destination = await installed(app)
    app.secrets.set('notion', JSON.stringify(app.session()))
    app.secrets.delete('notion-a')
    const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
    expect(restarted.connection.connected()).toBe(false)
    expect(await restarted.connection.token()).toBe('')
})
it.each([false, true])('defers credential rotation until destination commit finishes (installed=%s)', async (edit) => {
    const app = desktop()
    if (edit) {
        await installed(app)
        app.connection.choose()
    } else {
        await approve(app)
        await app.connection.poll()
    }
    let release!: () => void
    let destination: Destination | undefined
    const saved = app.connection.completeJournal(
        (_setup, checkpoint) => {
            checkpoint('new-journal')
            return Promise.resolve({ ...selectedPage, id: 'new-journal' })
        },
        undefined,
        (value) => {
            destination = value
            return new Promise<void>((resolve) => {
                release = resolve
            })
        }
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    app.provider.mockImplementation(() =>
        Promise.resolve(response({ ...credentials, access_token: 'rotated-access', refresh_token: 'rotated-refresh' }))
    )
    const refreshing = edit ? app.connection.token(true) : app.connection.pendingToken(true)
    expect(app.provider).toHaveBeenCalledTimes(1)
    release()
    await saved
    expect(await refreshing).toBe('rotated-access')
    const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
    expect(await restarted.connection.token()).toBe('rotated-access')
})
it('rejects an intercepted handoff paired with another valid attempt before contacting Notion', async () => {
    const provider = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response(credentials)))
    const handler = createOAuthHandler(config, provider)
    const victimState = await authorize(handler)
    const callback = await handler(new Request(`${origin}/callback?state=${victimState}&code=intercepted-code`))
    const returned = new URL(callback.headers.get('Location')!)
    const intercepted = returned.searchParams.get('grant') ?? returned.searchParams.get('code')!
    const otherVerifier = 'a'.repeat(43)
    const started = await handler(
        new Request(
            `${origin}/authorize?port=23456&challenge=${createHash('sha256').update(otherVerifier).digest('base64url')}&nonce=${'m'.repeat(32)}`
        )
    )
    const otherState = new URL(started.headers.get('Location')!).searchParams.get('state')!
    const rejected = await handler(
        jsonRequest('/token', { state: otherState, code: intercepted, grant: intercepted, verifier: otherVerifier })
    )
    expect(rejected.status).toBe(400)
    expect(provider).not.toHaveBeenCalled()
    expect(returned.searchParams.has('code')).toBe(false)
    expect(returned.toString()).not.toContain('intercepted-code')
    const tampered = `${intercepted.slice(0, -4)}AAAA`
    expect((await handler(jsonRequest('/token', { state: victimState, grant: tampered, verifier }))).status).toBe(400)
    expect(
        (await handler(jsonRequest('/token', { state: victimState, code: 'intercepted-code', verifier }))).status
    ).toBe(400)
    expect(provider).not.toHaveBeenCalled()
    const freshInstance = createOAuthHandler(config, provider)
    const accepted = await freshInstance(jsonRequest('/token', { state: victimState, grant: intercepted, verifier }))
    expect(await accepted.json()).toEqual(credentials)
    expect(provider).toHaveBeenCalledTimes(1)
})
it.each(['persist', 'flush'])(
    'retains confirmation after local %s fails and retries without creating another page',
    async (failure) => {
        const app = desktop()
        await approve(app)
        await app.connection.poll()
        let created = 0
        const prepare = vi.fn((setup: JournalSetup, checkpoint: (pageId?: string) => void) => {
            if (!setup.pageId) created++
            checkpoint('created-journal')
            return Promise.resolve({
                kind: 'page' as const,
                id: 'created-journal',
                titleProperty: 'Name',
                dateProperty: ''
            })
        })
        let attempts = 0
        const persist = () => {
            if (++attempts === 1) {
                const error = new Error('Local destination save failed')
                if (failure === 'persist') throw error
                return Promise.reject(error)
            }
            return Promise.resolve()
        }
        const confirm = () => app.connection.completeJournal(prepare, 'Work journal', persist)
        await expect(confirm()).rejects.toThrow(/Local destination save/)
        expect(app.connection.connected()).toBe(false)
        expect(await app.connection.pendingToken()).toBe('access-one')
        await expect(confirm()).resolves.toMatchObject({ id: 'created-journal' })
        expect(app.connection.connected()).toBe(true)
        expect(created).toBe(1)
    }
)
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
    const grant = location.searchParams.get('grant')!
    expect(grant).toBeTruthy()
    expect(location.searchParams.has('code')).toBe(false)
    expect(location.toString()).not.toContain('one-use-code')
    expect(location.toString()).not.toContain('access-one')
    expect((await handler(jsonRequest('/token', { state, grant, verifier: 'wrong' }))).status).toBe(400)
    expect(provider).not.toHaveBeenCalled()
    const exchanged = await handler(jsonRequest('/token', { state, grant, verifier }))
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
    const callback = await handler(new Request(`${origin}/callback?state=${state}&code=expires`))
    const grant = new URL(callback.headers.get('Location')!).searchParams.get('grant')!
    for (const bad of [`${state}x`, 'invalid'])
        expect((await handler(new Request(`${origin}/callback?state=${bad}&code=x`))).status).toBe(400)
    now += 11 * 60000
    expect((await handler(jsonRequest('/token', { state, grant, verifier }))).status).toBe(400)
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
function desktop(
    serviceOrigin = origin,
    recovery = new Map<string, JournalSetup>(),
    disk?: {
        secrets: Map<string, string>
        destination?: Destination
    }
) {
    const secrets = disk?.secrets ?? new Map<string, string>()
    let readKey = 'notion'
    const provider = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response(credentials)))
    const handler = createOAuthHandler({ ...config, origin: serviceOrigin }, provider)
    const fetcher: typeof fetch = (input, init) => handler(new Request(input, init))
    const connection = new NotionConnection(
        {
            get: (key) => {
                readKey = key
                return secrets.get(key) ?? ''
            },
            set: (key, value) => {
                secrets.set(key, value)
            }
        },
        serviceOrigin,
        fetcher,
        {
            get: (workspace: string) => recovery.get(workspace),
            set: (workspace: string, setup: JournalSetup) => {
                recovery.set(workspace, structuredClone(setup))
            },
            clear: (workspace: string) => {
                recovery.delete(workspace)
            }
        },
        disk?.destination
    )
    active.push(connection)
    return {
        connection,
        secrets,
        provider,
        handler,
        session: () => {
            connection.profileKey()
            return JSON.parse(secrets.get(readKey) ?? '{}')
        }
    }
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
        const destination = await app.connection.completeJournal((_setup, checkpoint) => {
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
            serviceOrigin,
            (input, init) => app.handler(new Request(input, init)),
            { get: () => undefined, set: vi.fn(), clear: vi.fn() },
            destination
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
})
const selectedPage = { kind: 'page' as const, id: 'selected-page', titleProperty: 'Name', dateProperty: '' }
const rotated = { ...credentials, access_token: 'access-two', refresh_token: 'refresh-two' }
it('keeps a saved connection usable when recovery cleanup fails and permits another destination edit', async () => {
    const recovery = new Map<string, JournalSetup>()
    const app = desktop(origin, recovery)
    await installed(app)
    vi.spyOn(recovery, 'delete').mockImplementationOnce(() => {
        throw new Error('Recovery file is locked')
    })
    expect(() => app.connection.destinationSaved()).not.toThrow()
    expect(app.connection.connected()).toBe(true)
    expect(await app.connection.token()).toBe('access-one')
    expect(recovery.size).toBe(1)
    expect(app.connection.choose()).toBe(true)
    await expect(
        app.connection.completeJournal((setup, checkpoint) => {
            expect(setup.started).toBe(false)
            checkpoint('another-journal')
            return Promise.resolve({ ...selectedPage, id: 'another-journal' })
        }, 'Another journal')
    ).resolves.toMatchObject({ id: 'another-journal' })
    app.connection.destinationSaved()
    expect(recovery.size).toBe(0)
})
async function installed(app: ReturnType<typeof desktop>) {
    await approve(app)
    await app.connection.poll()
    return app.connection.completeJournal((_setup, checkpoint) => {
        checkpoint(selectedPage.id)
        return Promise.resolve(selectedPage)
    })
}
it('recovers a created page after losing all in-memory credentials and restarting authorization', async () => {
    const recovery = new Map<string, JournalSetup>()
    const first = desktop(origin, recovery)
    await approve(first)
    await first.connection.poll()
    let creations = 0
    let marker = ''
    await expect(
        first.connection.completeJournal((setup, checkpoint) => {
            checkpoint()
            marker = setup.id
            creations++
            return Promise.reject(new Error('Process lost after provider accepted creation'))
        }, 'Work journal')
    ).rejects.toThrow(/Process lost/)
    first.connection.cancel()
    const restarted = desktop(origin, recovery)
    await approve(restarted)
    await restarted.connection.poll()
    await restarted.connection.completeJournal((setup) => {
        if (!setup.started || setup.id !== marker) creations++
        expect(setup).toMatchObject({ id: marker, started: true, title: 'Work journal' })
        return Promise.resolve(selectedPage)
    }, 'Work journal')
    expect(creations).toBe(1)
})
it.each([
    { name: 'new authorization discovery', edit: false, confirm: false },
    { name: 'destination edit discovery', edit: true, confirm: false },
    { name: 'destination edit confirmation', edit: true, confirm: true }
])('refreshes rejected credentials during $name', async ({ edit, confirm }) => {
    const app = desktop()
    if (edit) {
        await installed(app)
        expect(app.connection.choose()).toBe(true)
    } else {
        await approve(app)
        await app.connection.poll()
    }
    app.provider.mockResolvedValue(response(rotated))
    const api = vi.fn<typeof fetch>((_url, init) =>
        Promise.resolve(
            new Headers(init?.headers).get('Authorization') === 'Bearer access-one'
                ? response({ message: 'expired' }, 401)
                : response(confirm ? {} : { results: [], has_more: false, next_cursor: null })
        )
    )
    const notion = new Notion(providerHttp(api), (refresh, rejected) => app.connection.pendingToken(refresh, rejected))
    if (confirm) {
        await expect(
            app.connection.completeJournal((setup, checkpoint) =>
                notion.prepareJournal(setup, checkpoint, { ...selectedPage, id: 'another-page' })
            )
        ).resolves.toMatchObject({ id: 'another-page' })
        expect(app.session().refresh_token).toBe('refresh-two')
    } else {
        await expect(notion.accessiblePages()).resolves.toEqual([])
        expect(await app.connection.pendingToken()).toBe('access-two')
    }
    expect(
        app.provider.mock.calls.filter(
            ([, init]) => JSON.parse(typeof init?.body === 'string' ? init.body : '{}').grant_type === 'refresh_token'
        )
    ).toHaveLength(1)
    expect(api.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'))).toEqual([
        'Bearer access-one',
        'Bearer access-two'
    ])
})
it('confirmation preserves credentials rotated by a concurrent installed-session request', async () => {
    const app = desktop()
    await installed(app)
    app.connection.choose()
    app.provider.mockResolvedValue(response(rotated))
    await app.connection.completeJournal(async () => {
        await app.connection.token(true, 'access-one')
        return { ...selectedPage, id: 'new-destination' }
    })
    expect(app.session()).toMatchObject({ ...rotated, journal: { pageId: 'new-destination' } })
})
it('waits for an in-flight rotation before committing an edited destination', async () => {
    const app = desktop()
    await installed(app)
    app.connection.choose()
    let finish!: (response: Response) => void
    app.provider.mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = resolve
            })
    )
    const refresh = app.connection.token(true, 'access-one')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const saved = app.connection.completeJournal(() => Promise.resolve({ ...selectedPage, id: 'new-destination' }))
    const outcomes = Promise.allSettled([refresh, saved])
    await new Promise((resolve) => setTimeout(resolve, 0))
    finish(response(rotated))
    expect((await outcomes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(app.session()).toMatchObject({ ...rotated, journal: { pageId: 'new-destination' } })
})
