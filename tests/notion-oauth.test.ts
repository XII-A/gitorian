import { deferred } from './deferred'
import { NotionFailure, toNotionError } from '../src/main/notion'
import { notionClient, run, transportClient } from './effect-fixtures'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { http, passthrough } from 'msw'
import { setupServer } from 'msw/node'
import { channel } from 'node:diagnostics_channel'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotionSetupStore, type JournalSetupStore } from '../src/main/notion-setup'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createOAuthHandler } from '../services/notion-oauth/src/handler'
import type { Destination } from '../src/shared/model'
import type { JournalSetup } from '../src/main/notion-connection'
import { NotionConnection, makeNotionConnection } from '../src/main/notion-connection'
import type { ConnectionAdapters } from '../src/main/notion-connection'
import { Effect, Layer, ManagedRuntime, Scheduler } from 'effect'
import { initialState } from '../src/shared/model'
const origin = 'https://auth.example.com'
const providerServer = setupServer(http.get(/^http:\/\/127\.0\.0\.1:\d+\//, () => passthrough()))
beforeAll(() => providerServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => providerServer.close())

function tokenEndpoint(reply: (request: Request) => Response | Promise<Response>) {
    const attempts: Request[] = []
    providerServer.use(
        http.post('https://api.notion.com/v1/oauth/token', ({ request }) => {
            attempts.push(request.clone())
            return reply(request)
        })
    )
    return attempts
}
it('lets a host exit after provider denial without an explicit connection cancel', async () => {
    const source = new URL('../src/main/notion-connection.ts', import.meta.url).href
    const script = `
        import { NotionConnection, makeNotionConnection } from ${JSON.stringify(source)};
        import { Effect, Layer, ManagedRuntime, Exit, Cause } from 'effect';
        const runtime=ManagedRuntime.make(Layer.scoped(NotionConnection,makeNotionConnection({
            vault:{get:()=>'',set:()=>{}},origin:'https://auth.example.com',fetcher:async()=>new Response('{}'),
            recovery:{get:()=>undefined,set:()=>{},clear:()=>{}}
        },{config:{settings:{}},generation:'fixture',setDestination:async()=>{}},()=>({
            prepareJournal:()=>Effect.fail(new Error('Unexpected setup')),destinationIcon:()=>Effect.succeed(undefined)
        }))));
        const connection=await runtime.runPromise(NotionConnection);
        const started=new URL((await runtime.runPromise(connection.start())).url);
        const callback=new URL('http://127.0.0.1:'+started.searchParams.get('port')+'/callback/'+started.searchParams.get('nonce'));
        callback.search=new URLSearchParams({state:'fixture-state',error:'access_denied'}).toString();
        await (await fetch(callback)).text();
        const failed=await runtime.runPromiseExit(connection.poll());
        if(Exit.isSuccess(failed) || !String(Cause.squash(failed.cause)).includes('declined')) throw new Error('Denial was not reported');
        console.log('denied');
    `
    const result = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script],
        { timeout: 10000 }
    )
    expect(result.stdout).toContain('denied')
})
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
const active: (() => Promise<void>)[] = []
const directories: string[] = []

function temporaryDirectory() {
    const directory = mkdtempSync(join(tmpdir(), 'gitorian-oauth-'))
    directories.push(directory)
    return directory
}
function diskCredentials() {
    const directory = temporaryDirectory()
    const path = (key: string) => join(directory, key + '.secret')
    return {
        path,
        get(key: string) {
            return existsSync(path(key)) ? readFileSync(path(key), 'utf8') : undefined
        },
        set(key: string, value: string) {
            writeFileSync(path(key), value)
        },
        delete(key: string) {
            rmSync(path(key), { force: true })
        },
        get size() {
            return readdirSync(directory).length
        }
    }
}

it.each([false, true])(
    'credential staging failure preserves the persisted pair across restart (installed=%s)',
    async (hasInstalled) => {
        const disk = diskCredentials()
        const app = desktop(origin, new Map(), { secrets: disk })
        let destination: Destination | undefined = hasInstalled ? await installed(app) : undefined
        const previous = destination
        const next = {
            ...credentials,
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            workspace_id: 'new-workspace'
        }
        app.provider.reply = () => response(next)
        await approve(app)
        await run(app.connection.poll())
        let creations = 0
        const confirm = () =>
            confirmJournal(app, {
                prepare: (setup, checkpoint) => {
                    if (!setup.pageId) creations++
                    checkpoint('new-journal')
                    return Promise.resolve({ ...selectedPage, id: 'new-journal' })
                },
                title: 'New journal',
                commit: (value) => {
                    destination = value
                    return Promise.resolve()
                }
            })
        const blocked = disk.path(previous?.credentialSlot === 'a' ? 'notion-b' : 'notion-a')
        mkdirSync(blocked)
        await expect(confirm()).rejects.toThrow(/EISDIR|EPERM|directory|operation/i)
        rmSync(blocked, { recursive: true })
        expect(destination).toEqual(previous)
        const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
        expect(restarted.connection.connected()).toBe(hasInstalled)
        expect(await run(restarted.connection.token())).toBe(hasInstalled ? 'access-one' : '')
        await expect(confirm()).resolves.toMatchObject({ id: 'new-journal' })
        const committed = desktop(origin, new Map(), { secrets: app.secrets, destination })
        expect(committed.connection.connected()).toBe(true)
        expect(await run(committed.connection.token())).toBe('new-access')
        expect(creations).toBe(1)
    }
)
it('restart selects staged credentials if the process dies immediately after the destination commit', async () => {
    const app = desktop()
    let destination = await installed(app)
    app.provider.reply = () =>
        Promise.resolve(response({ ...credentials, access_token: 'new-access', refresh_token: 'new-refresh' }))
    await approve(app)
    await run(app.connection.poll())
    await expect(
        confirmJournal(app, {
            prepare: (_setup, checkpoint) => {
                checkpoint('new-journal')
                return Promise.resolve({ ...selectedPage, id: 'new-journal' })
            },
            title: undefined,
            commit: (value) => {
                destination = value
                return Promise.reject(new Error('Process terminated after SQLite commit'))
            }
        })
    ).rejects.toThrow(/Process terminated/)
    const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
    expect(restarted.connection.connected()).toBe(true)
    expect(await run(restarted.connection.token())).toBe('new-access')
    expect(destination.id).toBe('new-journal')
})
it('does not fall back to legacy credentials when the committed credential slot is unavailable', async () => {
    const app = desktop()
    const destination = await installed(app)
    app.secrets.set('notion', JSON.stringify(app.session()))
    app.secrets.delete('notion-a')
    const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
    expect(restarted.connection.connected()).toBe(false)
    expect(await run(restarted.connection.token())).toBe('')
})
it.each([false, true])('defers credential rotation until destination commit finishes (installed=%s)', async (edit) => {
    const app = desktop()
    if (edit) {
        await installed(app)
        await run(app.connection.choose())
    } else {
        await approve(app)
        await run(app.connection.poll())
    }
    let release!: () => void
    let destination: Destination | undefined
    const saved = confirmJournal(app, {
        prepare: (_setup, checkpoint) => {
            checkpoint('new-journal')
            return Promise.resolve({ ...selectedPage, id: 'new-journal' })
        },
        title: undefined,
        commit: (value) => {
            destination = value
            return new Promise<void>((resolve) => {
                release = resolve
            })
        }
    })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    app.provider.reply = () =>
        Promise.resolve(response({ ...credentials, access_token: 'rotated-access', refresh_token: 'rotated-refresh' }))
    const refreshing = edit ? run(app.connection.token(true)) : run(app.connection.pendingToken(true))
    expect(app.provider.requests).toHaveLength(1)
    release()
    await saved
    expect(await refreshing).toBe('rotated-access')
    const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination })
    expect(await run(restarted.connection.token())).toBe('rotated-access')
})
it('rejects an intercepted handoff paired with another valid attempt before contacting Notion', async () => {
    const provider = tokenEndpoint(() => response(credentials))
    const handler = createOAuthHandler(config)
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
    expect(provider).toHaveLength(0)
    expect(returned.searchParams.has('code')).toBe(false)
    expect(returned.toString()).not.toContain('intercepted-code')
    const tampered = `${intercepted.slice(0, -4)}AAAA`
    expect((await handler(jsonRequest('/token', { state: victimState, grant: tampered, verifier }))).status).toBe(400)
    expect(
        (await handler(jsonRequest('/token', { state: victimState, code: 'intercepted-code', verifier }))).status
    ).toBe(400)
    expect(provider).toHaveLength(0)
    const freshInstance = createOAuthHandler(config)
    const accepted = await freshInstance(jsonRequest('/token', { state: victimState, grant: intercepted, verifier }))
    expect(await accepted.json()).toEqual(credentials)
    expect(provider).toHaveLength(1)
})
it.each(['persist', 'flush'])(
    'retains confirmation after local %s fails and retries without creating another page',
    async (failure) => {
        const app = desktop()
        await approve(app)
        await run(app.connection.poll())
        let created = 0
        const prepare = (setup: JournalSetup, checkpoint: (pageId?: string) => void) => {
            if (!setup.pageId) created++
            checkpoint('created-journal')
            return Promise.resolve({
                kind: 'page' as const,
                id: 'created-journal',
                titleProperty: 'Name',
                dateProperty: ''
            })
        }
        let attempts = 0
        const persist = () => {
            if (++attempts === 1) {
                const error = new Error('Local destination save failed')
                if (failure === 'persist') throw error
                return Promise.reject(error)
            }
            return Promise.resolve()
        }
        const confirm = () =>
            confirmJournal(app, {
                prepare: prepare,
                title: 'Work journal',
                commit: persist
            })
        await expect(confirm()).rejects.toThrow(/Local destination save/)
        expect(app.connection.connected()).toBe(false)
        expect(await run(app.connection.pendingToken())).toBe('access-one')
        await expect(confirm()).resolves.toMatchObject({ id: 'created-journal' })
        expect(app.connection.connected()).toBe(true)
        expect(created).toBe(1)
    }
)
afterEach(async () => {
    await Promise.all(active.splice(0).map((close) => close()))
    providerServer.resetHandlers()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
async function authorize(handler: ReturnType<typeof createOAuthHandler>, port = 12345) {
    const started = await handler(new Request(`${origin}/authorize?port=${port}&challenge=${challenge}&nonce=${nonce}`))
    expect(started.status).toBe(302)
    const location = new URL(started.headers.get('Location')!)
    expect(location.origin).toBe('https://api.notion.com')
    return location.searchParams.get('state')!
}
it('binds the browser callback and token exchange to the desktop verifier without a token in redirects', async () => {
    const provider = tokenEndpoint(() => response(credentials))
    const handler = createOAuthHandler(config)
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
    expect(provider).toHaveLength(0)
    const exchanged = await handler(jsonRequest('/token', { state, grant, verifier }))
    expect(await exchanged.json()).toEqual(credentials)
    expect(exchanged.headers.get('Cache-Control')).toBe('no-store')
    const request = provider[0]
    expect(request.headers.get('Authorization')).toBe(
        `Basic ${Buffer.from('public-app:server-only-secret').toString('base64')}`
    )
    expect(await request.json()).toEqual({
        grant_type: 'authorization_code',
        code: 'one-use-code',
        redirect_uri: `${origin}/callback`
    })
})
it('rejects tampering, expiration, unsafe callbacks and oversized payloads before contacting Notion', async () => {
    const provider = tokenEndpoint(() => response({}, 500))
    let now = 1000000
    const handler = createOAuthHandler(config, fetch, () => now)
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
    expect(provider).toHaveLength(0)
})
it('returns safe provider failures, forwards denial only to the paired app, and rotates refresh credentials', async () => {
    const provider = tokenEndpoint(async (request) => {
        const body = (await request.json()) as { refresh_token?: string }
        return body.refresh_token === 'expired'
            ? response({ error: 'invalid_grant', message: config.clientSecret }, 400)
            : response(credentials)
    })
    const handler = createOAuthHandler(config)
    const state = await authorize(handler)
    const denial = await handler(new Request(`${origin}/callback?state=${state}&error=access_denied`))
    expect(new URL(denial.headers.get('Location')!).searchParams.get('error')).toBe('access_denied')
    const failed = await handler(jsonRequest('/refresh', { refresh_token: 'expired' }))
    expect(failed.status).toBe(401)
    expect(await failed.text()).not.toContain(config.clientSecret)
    expect(await (await handler(jsonRequest('/refresh', { refresh_token: 'valid' }))).json()).toEqual(credentials)
    expect(await provider[1].json()).toEqual({
        grant_type: 'refresh_token',
        refresh_token: 'valid'
    })
})
function ownConnection(
    adapters: ConnectionAdapters,
    state = initialState(),
    pages: Parameters<typeof makeNotionConnection>[2] = () => ({
        destinationIcon: (icon) => Effect.succeed(icon),
        describeDestination: (destination) => Effect.succeed(destination),
        prepareJournal: () => Effect.fail(new NotionFailure('Unexpected journal preparation'))
    }),
    commit: () => Promise<void> = () => Promise.resolve()
) {
    const store = {
        state,
        get config() {
            return { settings: this.state.settings }
        },
        get generation() {
            return this.state.restoreId ?? 'fixture'
        },
        persist: () => state,
        async setDestination(destination: Destination, generation?: string) {
            if (generation && generation !== this.generation) throw new Error('Journal changed during restore')
            const current = this.state,
                previous = current.settings.destination
            current.settings.destination = destination
            try {
                this.persist()
                await commit()
            } catch (error) {
                if (this.state === current && current.settings.destination === destination)
                    current.settings.destination = previous
                throw error
            }
        }
    }
    const runtime = ManagedRuntime.make(Layer.scoped(NotionConnection, makeNotionConnection(adapters, store, pages)))
    active.push(() => runtime.dispose())
    return { connection: runtime.runSync(NotionConnection), store, close: () => runtime.dispose() }
}
function connectionFixture(
    vault: ConnectionAdapters['vault'],
    origin: string,
    fetcher: typeof fetch,
    recovery: ConnectionAdapters['recovery'],
    destination?: Destination
) {
    const state = initialState()
    state.settings.destination = destination
    return ownConnection({ vault, origin, fetcher, recovery }, state).connection
}
function desktop(
    serviceOrigin = origin,
    recovery: Map<string, JournalSetup> | JournalSetupStore = new Map<string, JournalSetup>(),
    disk?: {
        secrets: Pick<Map<string, string>, 'get' | 'set' | 'delete' | 'size'> | ReturnType<typeof diskCredentials>
        destination?: Destination
    }
) {
    const secrets = disk?.secrets ?? new Map<string, string>()
    let readKey = 'notion'
    const clientId = randomUUID()
    const authorization = 'Basic ' + Buffer.from(clientId + ':' + config.clientSecret).toString('base64')
    const provider = {
        reply: (): Response | Promise<Response> => response(credentials),
        requests: [] as Request[]
    }
    providerServer.use(
        http.post('https://api.notion.com/v1/oauth/token', ({ request }) => {
            if (request.headers.get('Authorization') !== authorization) return
            provider.requests.push(request.clone())
            return provider.reply()
        })
    )
    const handler = createOAuthHandler({ ...config, origin: serviceOrigin, clientId })
    const fetcher: typeof fetch = (input, init) => handler(new Request(input, init))
    const state = initialState()
    state.settings.destination = disk?.destination
    const controls: {
        prepare?: (setup: JournalSetup, checkpoint: (pageId?: string) => void) => Promise<Destination>
        commit?: (destination: Destination) => Promise<void>
        describe?: (destination: Destination) => Promise<Destination>
        readCredential?: (key: string) => void
        wroteCredential?: (key: string) => void
    } = {}
    const owned = ownConnection(
        {
            vault: {
                get: (key) => {
                    readKey = key
                    const value = secrets.get(key) ?? ''
                    controls.readCredential?.(key)
                    return value
                },
                set: (key, value) => {
                    secrets.set(key, value)
                    controls.wroteCredential?.(key)
                }
            },
            origin: serviceOrigin,
            fetcher,
            recovery:
                recovery instanceof Map
                    ? {
                          get: (workspace) => recovery.get(workspace),
                          set: (workspace, setup) => {
                              recovery.set(workspace, structuredClone(setup))
                          },
                          clear: (workspace) => {
                              recovery.delete(workspace)
                          }
                      }
                    : recovery
        },
        state,
        () => ({
            destinationIcon: (icon) => Effect.succeed(icon),
            describeDestination: (destination) =>
                Effect.tryPromise({
                    try: () => controls.describe?.(destination) ?? Promise.resolve(destination),
                    catch: toNotionError
                }),
            prepareJournal: (setup, checkpoint, selected) =>
                Effect.tryPromise({
                    try: () =>
                        controls.prepare
                            ? controls.prepare(setup, checkpoint)
                            : Promise.resolve(selected ?? selectedPage),
                    catch: toNotionError
                })
        }),
        () => controls.commit?.(state.settings.destination!) ?? Promise.resolve()
    )
    return {
        connection: owned.connection,
        close: owned.close,
        store: owned.store,
        secrets,
        provider,
        handler,
        controls,
        session: () => {
            owned.connection.profileKey()
            return JSON.parse(secrets.get(readKey) ?? '{}')
        }
    }
}
function confirmJournal(
    app: ReturnType<typeof desktop>,
    fixture: {
        prepare: (setup: JournalSetup, checkpoint: (pageId?: string) => void) => Promise<Destination>
        title?: string
        commit?: (destination: Destination) => Promise<void>
    }
) {
    app.controls.prepare = fixture.prepare
    app.controls.commit = fixture.commit
    return run(app.connection.completeJournal({ title: fixture.title }))
}
async function approve(app: ReturnType<typeof desktop>) {
    const started = await run(app.connection.start())
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
        const result = await run(app.connection.poll())
        expect('pending' in result).toBe(false)
        expect(app.connection.connected()).toBe(false)
        expect(app.secrets.size).toBe(0)
        expect(await run(app.connection.pendingToken())).toBe('access-one')
        const destination = await confirmJournal(app, {
            prepare: (_setup, checkpoint) => {
                checkpoint('selected-page')
                return Promise.resolve({ kind: 'page', id: 'selected-page', titleProperty: 'Name', dateProperty: '' })
            }
        })
        expect(app.connection.connected()).toBe(true)
        expect(await run(app.connection.token())).toBe('access-one')
        app.provider.reply = () =>
            Promise.resolve(response({ ...credentials, access_token: 'access-two', refresh_token: 'refresh-two' }))
        expect(await Promise.all([run(app.connection.token(true)), run(app.connection.token(true))])).toEqual([
            'access-two',
            'access-two'
        ])
        expect(app.provider.requests).toHaveLength(2)
        const restored = connectionFixture(
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
        expect(await run(restored.token())).toBe('access-two')
        await run(app.connection.disconnect())
        expect(await run(app.connection.token())).toBe('')
        expect(app.secrets.get('notion')).toBe('')
    }
)
it('ignores an exchange completing after cancellation and closes the old callback listener', async () => {
    const app = desktop()
    await approve(app)
    let resolve!: (value: Response) => void
    app.provider.reply = () =>
        new Promise((done) => {
            resolve = done
        })
    const polling = run(app.connection.poll())
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await run(app.connection.cancel())
    resolve(response(credentials))
    await expect(polling).rejects.toThrow(/cancel/i)
    expect(await run(app.connection.token())).toBe('')
})
it('does not resurrect a disconnected account after a delayed refresh; installed static tokens remain usable', async () => {
    const app = desktop()
    app.secrets.set('notion', 'installed-static-token')
    expect(await run(app.connection.token())).toBe('installed-static-token')
    await approve(app)
    await run(app.connection.poll())
    await confirmJournal(app, {
        prepare: (_setup, checkpoint) => {
            checkpoint('selected-page')
            return Promise.resolve({ kind: 'page', id: 'selected-page', titleProperty: 'Name', dateProperty: '' })
        }
    })
    const first = deferred<undefined>()
    const second = deferred<undefined>()
    const firstResponse = deferred<Response>()
    const secondResponse = deferred<Response>()
    let rotation = 0
    app.provider.reply = () => {
        if (rotation++ === 0) {
            first.resolve(undefined)
            return firstResponse.promise
        }
        second.resolve(undefined)
        return secondResponse.promise
    }
    const refresh = run(app.connection.token(true))
    await first.promise
    // Closing the settings authorization surface must not discard a valid rotated credential.
    await run(app.connection.cancel())
    firstResponse.resolve(
        response({ ...credentials, access_token: 'after-close', refresh_token: 'after-close-refresh' })
    )
    expect(await refresh).toBe('after-close')
    const afterClose = run(app.connection.token(true))
    await second.promise
    await run(app.connection.disconnect())
    secondResponse.resolve(response({ ...credentials, access_token: 'late-token' }))
    await expect(afterClose).rejects.toThrow(/cancel|disconnect/i)
    expect(await run(app.connection.token())).toBe('')
})
it('discards unconfirmed authorization, but finishes an explicitly confirmed operation after Settings closes', async () => {
    const app = desktop()
    await approve(app)
    await run(app.connection.poll())
    await run(app.connection.cancel())
    expect(app.secrets.size).toBe(0)
    await expect(run(app.connection.pendingToken())).rejects.toThrow(/connect/i)
    await approve(app)
    await run(app.connection.poll())
    let finish!: () => void
    const saving = confirmJournal(app, {
        prepare: async (_setup, checkpoint) => {
            checkpoint()
            await new Promise<void>((done) => {
                finish = done
            })
            checkpoint('confirmed-page')
            return { kind: 'page', id: 'confirmed-page', titleProperty: 'Name', dateProperty: '' }
        }
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await run(app.connection.cancel())
    finish()
    expect((await saving).id).toBe('confirmed-page')
    expect(app.connection.connected()).toBe(true)
})
const selectedPage = { kind: 'page' as const, id: 'selected-page', titleProperty: 'Name', dateProperty: '' }
const rotated = { ...credentials, access_token: 'access-two', refresh_token: 'refresh-two' }
it('keeps a saved connection usable when recovery cleanup fails and permits another destination edit', async () => {
    const path = join(temporaryDirectory(), 'recovery.json')
    const recovery = new NotionSetupStore(path)
    const app = desktop(origin, recovery)
    await approve(app)
    await run(app.connection.poll())
    await confirmJournal(app, {
        prepare: (_setup, checkpoint) => {
            checkpoint(selectedPage.id)
            return Promise.resolve(selectedPage)
        },
        commit: () => {
            mkdirSync(path + '.next')
            return Promise.resolve()
        }
    })
    rmSync(path + '.next', { recursive: true })
    expect(app.connection.connected()).toBe(true)
    expect(await run(app.connection.token())).toBe('access-one')
    expect(recovery.get(credentials.workspace_id)?.pageId).toBe(selectedPage.id)
    expect(await run(app.connection.choose())).toBe(true)
    await expect(
        confirmJournal(app, {
            prepare: (setup, checkpoint) => {
                expect(setup.started).toBe(false)
                checkpoint('another-journal')
                return Promise.resolve({ ...selectedPage, id: 'another-journal' })
            },
            title: 'Another journal'
        })
    ).resolves.toMatchObject({ id: 'another-journal' })
    expect(recovery.get(credentials.workspace_id)).toBeUndefined()
})
async function installed(app: ReturnType<typeof desktop>) {
    await approve(app)
    await run(app.connection.poll())
    return confirmJournal(app, {
        prepare: (_setup, checkpoint) => {
            checkpoint(selectedPage.id)
            return Promise.resolve(selectedPage)
        }
    })
}
it('recovers a created page after losing all in-memory credentials and restarting authorization', async () => {
    const recovery = new Map<string, JournalSetup>()
    const first = desktop(origin, recovery)
    await approve(first)
    await run(first.connection.poll())
    let creations = 0
    let marker = ''
    await expect(
        confirmJournal(first, {
            prepare: (setup, checkpoint) => {
                checkpoint()
                marker = setup.id
                creations++
                return Promise.reject(new Error('Process lost after provider accepted creation'))
            },
            title: 'Work journal'
        })
    ).rejects.toThrow(/Process lost/)
    await run(first.connection.cancel())
    const restarted = desktop(origin, recovery)
    await approve(restarted)
    await run(restarted.connection.poll())
    await confirmJournal(restarted, {
        prepare: (setup) => {
            if (!setup.started || setup.id !== marker) creations++
            expect(setup).toMatchObject({ id: marker, started: true, title: 'Work journal' })
            return Promise.resolve(selectedPage)
        },
        title: 'Work journal'
    })
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
        expect(await run(app.connection.choose())).toBe(true)
    } else {
        await approve(app)
        await run(app.connection.poll())
    }
    app.provider.reply = () => response(rotated)
    const authorizations: (string | null)[] = []
    providerServer.use(
        http.all('https://api.notion.com/v1/*', ({ request }) => {
            if (request.url.endsWith('/oauth/token')) return
            const authorization = request.headers.get('Authorization')
            authorizations.push(authorization)
            return authorization === 'Bearer access-one'
                ? response({ message: 'expired' }, 401)
                : response(confirm ? {} : { results: [], has_more: false, next_cursor: null })
        })
    )
    const notion = notionClient(await transportClient(), (refresh, rejected) =>
        run(app.connection.pendingToken(refresh, rejected))
    )
    if (confirm) {
        await expect(
            confirmJournal(app, {
                prepare: (setup, checkpoint) =>
                    run(notion.prepareJournal(setup, checkpoint, { ...selectedPage, id: 'another-page' }))
            })
        ).resolves.toMatchObject({ id: 'another-page' })
        expect(app.session().refresh_token).toBe('refresh-two')
    } else {
        await expect(run(notion.accessiblePages())).resolves.toEqual([])
        expect(await run(app.connection.pendingToken())).toBe('access-two')
    }
    expect(
        (
            await Promise.all(
                app.provider.requests.map(async (request) => (await request.json()) as { grant_type?: string })
            )
        ).filter((body) => body.grant_type === 'refresh_token')
    ).toHaveLength(1)
    expect(authorizations).toEqual(['Bearer access-one', 'Bearer access-two'])
})
it('confirmation preserves credentials rotated by a concurrent installed-session request', async () => {
    const app = desktop()
    await installed(app)
    await run(app.connection.choose())
    app.provider.reply = () => response(rotated)
    await confirmJournal(app, {
        prepare: async () => {
            await run(app.connection.token(true, 'access-one'))
            return { ...selectedPage, id: 'new-destination' }
        }
    })
    expect(app.session()).toMatchObject({ ...rotated, journal: { pageId: 'new-destination' } })
})
it('waits for an in-flight rotation before committing an edited destination', async () => {
    const app = desktop()
    await installed(app)
    await run(app.connection.choose())
    let finish!: (response: Response) => void
    app.provider.reply = () =>
        new Promise((resolve) => {
            finish = resolve
        })
    const refresh = run(app.connection.token(true, 'access-one'))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const prepared = deferred<undefined>()
    const saved = confirmJournal(app, {
        prepare: () => {
            prepared.resolve(undefined)
            return Promise.resolve({ ...selectedPage, id: 'new-destination' })
        }
    })
    const outcomes = Promise.allSettled([refresh, saved])
    await prepared.promise
    finish(response(rotated))
    expect((await outcomes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(app.session()).toMatchObject({ ...rotated, journal: { pageId: 'new-destination' } })
})

it('closes every superseded listener when starts overlap and cancellation wins', async () => {
    const app = desktop()
    await run(app.connection.start())
    const starts = await Promise.allSettled([run(app.connection.start()), run(app.connection.start())])
    const successful = starts.filter(
        (value): value is PromiseFulfilledResult<{ url: string; interval: number }> => value.status === 'fulfilled'
    )
    expect(successful.length).toBeGreaterThan(0)
    await run(app.connection.cancel())
    for (const start of successful) {
        const port = new URL(start.value.url).searchParams.get('port')
        await expect(fetch('http://127.0.0.1:' + String(port), { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
    }
})

it('invalidates pending destination setup when restoration selects another workspace', async () => {
    const recovery = new Map<string, JournalSetup>()
    const app = desktop(origin, recovery)
    await installed(app)
    const original = app.secrets.get('notion-a')
    recovery.set('workspace-one', { id: 'old-recovery', started: true, pageId: 'old-workspace-page' })
    await run(app.connection.choose())
    const restored = initialState()
    restored.restoreId = 'restored-journal'
    restored.settings.destination = { ...selectedPage, id: 'workspace-two-page', credentialSlot: 'b' }
    app.secrets.set(
        'notion-b',
        JSON.stringify({
            ...credentials,
            access_token: 'workspace-two-access',
            refresh_token: 'workspace-two-refresh',
            workspace_id: 'workspace-two',
            origin,
            journal: { id: 'other', started: true, pageId: 'workspace-two-page' }
        })
    )
    app.store.state = restored
    await expect(run(app.connection.pendingToken())).rejects.toThrow(/Connect Notion/)
    let prepared = false
    await expect(
        confirmJournal(app, {
            prepare: () => {
                prepared = true
                return Promise.resolve({ ...selectedPage, id: 'old-workspace-page' })
            }
        })
    ).rejects.toThrow()
    expect(prepared).toBe(false)
    expect(app.store.state.settings.destination).toEqual(restored.settings.destination)
    expect(await run(app.connection.token())).toBe('workspace-two-access')
    expect(app.secrets.get('notion-a')).toBe(original)
})

it('does not reinstall destination selection after a later cancellation', async () => {
    const app = desktop()
    await installed(app)
    await run(app.connection.start())
    const chosen = run(app.connection.choose())
    const outcome = chosen.then(
        () => 'chosen',
        () => 'cancelled'
    )
    await run(app.connection.cancel())
    expect(await outcome).toBe('cancelled')
    await expect(run(app.connection.pendingToken())).rejects.toThrow(/Connect Notion/)
})
it('settles a start whose lifetime closes while the listener is binding', async () => {
    const app = desktop()
    const listening = channel('tracing:net.server.listen:asyncStart')
    const stop = () => {
        void app.close()
    }
    listening.subscribe(stop)
    try {
        await expect(run(app.connection.start())).rejects.toThrow()
    } finally {
        listening.unsubscribe(stop)
    }
})

it('keeps the current credential slot when old destination metadata finishes after confirmation', async () => {
    const app = desktop()
    const original = await installed(app)
    let release!: (destination: Destination) => void
    app.controls.describe = () =>
        new Promise((resolve) => {
            release = resolve
        })
    const metadata = run(app.connection.refreshDestination())
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await run(app.connection.choose())
    const confirmed = await confirmJournal(app, { prepare: () => Promise.resolve(original) })
    app.provider.reply = () => response(rotated)
    await run(app.connection.token(true, 'access-one'))
    release({ ...original, title: 'Late old metadata' })
    await metadata
    expect(app.store.state.settings.destination?.credentialSlot).toBe(confirmed.credentialSlot)
    const restarted = desktop(origin, new Map(), {
        secrets: app.secrets,
        destination: app.store.state.settings.destination
    })
    expect(await run(restarted.connection.token())).toBe(rotated.access_token)
})
it('refreshes installed destination metadata without a pending setup session', async () => {
    const seed = desktop()
    const destination = await installed(seed)
    const state = initialState()
    state.settings.destination = destination
    const requests: Request[] = []
    providerServer.use(
        http.get('https://api.notion.com/v1/pages/' + destination.id, ({ request }) => {
            requests.push(request)
            return response({
                id: destination.id,
                url: 'https://notion.so/current',
                properties: { title: { title: [{ plain_text: 'Updated journal' }] } }
            })
        })
    )
    const client = await transportClient()
    const app = ownConnection(
        {
            vault: {
                get: (key) => seed.secrets.get(key) ?? '',
                set: (key, value) => {
                    seed.secrets.set(key, value)
                }
            },
            origin,
            fetcher: () => Promise.resolve(response({})),
            recovery: { get: () => undefined, set: vi.fn(), clear: vi.fn() }
        },
        state,
        (getToken) => notionClient(client, (refresh, rejected) => run(getToken(refresh, rejected)))
    )
    expect(app.connection.connected()).toBe(true)
    await run(app.connection.refreshDestination())
    expect(state.settings.destination?.title).toBe('Updated journal')
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer access-one')
})
function atNextInstruction(action: () => void | Promise<void>) {
    let armed = false,
        scheduled = false
    let failure: unknown
    const scheduler = Scheduler.make(
        (task) => {
            const apply = scheduled
            scheduled = false
            queueMicrotask(() => {
                void Promise.resolve()
                    .then(() => (apply ? action() : undefined))
                    .then(task, (error: unknown) => {
                        failure = error
                        task()
                    })
            })
        },
        (fiber) => {
            if (armed) {
                armed = false
                scheduled = true
                return 0
            }
            return Scheduler.defaultShouldYield(fiber)
        }
    )
    return {
        scheduler,
        pause: () => {
            armed = true
        },
        get failure() {
            return failure
        }
    }
}
it('does not reinstall Notion rotation credentials after a disconnect at the save seam', async () => {
    const app = desktop()
    await installed(app)
    let rotating = false
    const turn = atNextInstruction(() => run(app.connection.disconnect()))
    app.controls.readCredential = (key) => {
        if (rotating && key === 'notion-a') {
            rotating = false
            turn.pause()
        }
    }
    app.provider.reply = () => {
        rotating = true
        return response(rotated)
    }
    await run(app.connection.token(true).pipe(Effect.withScheduler(turn.scheduler)))
    expect(turn.failure).toBeUndefined()
    const restarted = desktop(origin, new Map(), {
        secrets: app.secrets,
        destination: app.store.state.settings.destination
    })
    expect(restarted.connection.connected()).toBe(false)
    expect(await run(restarted.connection.token())).toBe('')
})
it.each(['before staging', 'after staging'] as const)(
    'preserves restored state when confirmation yields %s',
    async (boundary) => {
        const app = desktop()
        await installed(app)
        await run(app.connection.choose())
        const prior = JSON.parse(app.secrets.get('notion-a')!)
        const restored = initialState()
        restored.restoreId = 'restored-journal'
        restored.settings.destination = { ...selectedPage, id: 'restored-page', credentialSlot: 'b' }
        let durable = structuredClone(restored.settings.destination)
        const set = app.secrets.set.bind(app.secrets)
        const turn = atNextInstruction(() => {
            set(
                'notion-b',
                JSON.stringify({
                    ...prior,
                    access_token: 'restored-access',
                    refresh_token: 'restored-refresh',
                    workspace_id: 'restored-workspace',
                    journal: { ...prior.journal, pageId: 'restored-page' }
                })
            )
            app.store.state = restored
            durable = structuredClone(restored.settings.destination!)
        })
        let preparing = false
        app.controls.readCredential = (key) => {
            if (preparing && boundary === 'before staging' && key === 'notion-a') {
                preparing = false
                turn.pause()
            }
        }
        app.controls.wroteCredential = (key) => {
            if (preparing && boundary === 'after staging' && key === 'notion-b') {
                preparing = false
                turn.pause()
            }
        }
        app.controls.commit = () => {
            durable = structuredClone(app.store.state.settings.destination!)
            return Promise.resolve()
        }
        app.controls.prepare = () => {
            preparing = true
            return Promise.resolve({ ...selectedPage, id: 'old-workspace-page' })
        }
        await expect(run(app.connection.completeJournal().pipe(Effect.withScheduler(turn.scheduler)))).rejects.toThrow(
            /cancel|changed/i
        )
        expect(turn.failure).toBeUndefined()
        expect(durable.id).toBe('restored-page')
        expect(app.store.state.settings.destination?.id).toBe('restored-page')
        await app.close()
        const restarted = desktop(origin, new Map(), { secrets: app.secrets, destination: durable })
        expect(await run(restarted.connection.token())).toBe('restored-access')
    }
)

it.each(['choose', 'poll'] as const)(
    'reports an unreadable recovery checkpoint through %s failure channel',
    async (mode) => {
        const path = join(temporaryDirectory(), 'recovery.json')
        const recovery = new NotionSetupStore(path)
        const app = desktop(origin, recovery)
        if (mode === 'choose') await installed(app)
        else await approve(app)
        writeFileSync(path, '{broken')
        const result = await run(
            Effect.either(
                mode === 'choose'
                    ? app.connection.choose().pipe(Effect.asVoid)
                    : app.connection.poll().pipe(Effect.asVoid)
            )
        )
        expect(result._tag).toBe('Left')
        if (result._tag !== 'Left') throw new Error('Expected recovery read failure')
        expect(result.left).toMatchObject({ _tag: 'ConnectionError', cause: expect.any(SyntaxError) })
        expect(app.store.state.settings.destination?.id).toBe(mode === 'choose' ? selectedPage.id : undefined)
    }
)
