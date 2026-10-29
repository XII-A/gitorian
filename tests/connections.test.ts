import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Effect, Fiber, Layer, ManagedRuntime } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'
import { ProviderAccounts, ProviderAccountsLive } from '../src/main/provider-accounts'
import { JournalStore } from '../src/main/journal-context'
import { JournalDatabase } from '../src/main/journal-database'
import { HttpLive } from '../src/main/http'
import { run } from './effect-fixtures'
import type { Provider } from '../src/shared/provider-accounts'

// Migrate the retired authenticator's outcomes to the actual account interface:
// restart, renewal, rejection, cancellation, late disconnect and owned shutdown.
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
    vi.useRealTimers()
    for (const close of cleanups.splice(0).reverse()) await close()
})
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-accounts-'))
    const store = await JournalDatabase.open(join(directory, 'journal.sqlite'))
    const secrets = new Map<string, string>()
    const calls: { url: string; body?: Record<string, string>; token: string }[] = []
    const control = {
        user: 42,
        rotations: 0,
        oauthError: '',
        failRenewal: false,
        rejectOld: false,
        renewal: undefined as (() => Promise<void>) | undefined,
        device: undefined as ((signal: AbortSignal) => Promise<void>) | undefined
    }
    const fetcher: typeof fetch = async (input, init = {}) => {
        const url = input instanceof Request ? input.url : input.toString()
        const body =
            typeof init.body === 'string'
                ? new Headers(init.headers).get('content-type') === 'application/x-www-form-urlencoded'
                    ? Object.fromEntries(new URLSearchParams(init.body))
                    : (JSON.parse(init.body) as Record<string, string>)
                : undefined
        const token = new Headers(init.headers).get('Authorization') ?? ''
        calls.push({ url, body, token })
        if (url.endsWith('/device/code') || url.endsWith('/authorize_device')) {
            await control.device?.(init.signal!)
            if (control.oauthError === 'device_flow_disabled') return Response.json({ error: control.oauthError })
            return Response.json({
                device_code: 'synthetic-device',
                user_code: 'ABCD-EFGH',
                verification_uri: url.includes('gitlab.com')
                    ? 'https://gitlab.com/oauth/device'
                    : 'https://github.com/login/device',
                interval: 5,
                expires_in: 60
            })
        }
        if (body?.grant_type === 'refresh_token') {
            control.rotations++
            await control.renewal?.()
            if (control.failRenewal) return Response.json({}, { status: 503 })
            return Response.json({ access_token: 'renewed', refresh_token: 'refresh-next', expires_in: 7200 })
        }
        if (url.endsWith('/access_token') || url.endsWith('/oauth/token'))
            return Response.json(
                control.oauthError
                    ? { error: control.oauthError }
                    : { access_token: 'authorized', refresh_token: 'refresh', expires_in: 7200 },
                { status: control.oauthError ? 400 : 200 }
            )
        if (url.endsWith('/user/emails'))
            return Response.json([
                { email: 'work@example.test', verified: true, confirmed_at: '2026-01-01T00:00:00Z' },
                { email: 'unverified@example.test', verified: false, confirmed_at: null }
            ])
        if (url.endsWith('/user')) return Response.json({ id: control.user, login: 'work', username: 'work' })
        if (control.rejectOld && token === 'Bearer old') return Response.json({}, { status: 401 })
        return new Headers(init.headers).get('Accept') === 'application/vnd.github.diff'
            ? new Response('diff --git a/a b/a')
            : Response.json({ ok: true })
    }
    const vault = {
        get: (key: string) => secrets.get(key) ?? '',
        set: (key: string, value: string) => {
            if (value) secrets.set(key, value)
            else secrets.delete(key)
        },
        protected: () => true
    }
    const native = Layer.merge(
        Layer.succeed(JournalStore, store),
        HttpLive(fetcher, {
            pauses: () => store.config.transportPauses,
            changed: (key, until) => store.savePause(key, until).then(() => undefined)
        })
    )
    const boot = async () => {
        const runtime = ManagedRuntime.make(ProviderAccountsLive({ vault, fetcher }).pipe(Layer.provide(native)))
        return { runtime, accounts: await runtime.runPromise(ProviderAccounts) }
    }
    let installed = await boot()
    cleanups.push(async () => {
        await installed.runtime.dispose()
        await store.close()
        await rm(directory, { recursive: true, force: true })
    })
    const seed = async (expired = true, provider: Provider = 'github') => {
        const id = randomUUID(),
            key = `provider-${randomUUID()}`
        await store.prepareProviderAccount({
            id,
            provider,
            host: provider === 'github' ? 'github.com' : 'gitlab.com',
            userId: String(control.user++),
            username: 'work',
            emails: [],
            generation: 1,
            status: 'connected',
            credentialKey: key
        })
        vault.set(
            key,
            JSON.stringify({
                access_token: 'old',
                refresh_token: 'refresh-old',
                expires: Date.now() + (expired ? -1000 : 3600000)
            })
        )
        await store.activateProviderAccount(id, 1)
        await store.finishProviderAccount(id)
        return id
    }
    return {
        store,
        secrets,
        calls,
        control,
        seed,
        get accounts() {
            return installed.accounts
        },
        get runtime() {
            return installed.runtime
        },
        restart: async () => {
            await installed.runtime.dispose()
            installed = await boot()
        }
    }
}

it.each(['github', 'gitlab'] as const)(
    'honors %s polling intervals and installs verified identity without exporting credentials',
    async (provider) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const f = await fixture(),
            start = await run(f.accounts.begin(provider))
        expect(start.code).toBe('ABCD-EFGH')
        expect(await run(f.accounts.complete(start.id))).toEqual({ pending: true, interval: 5 })
        f.control.oauthError = 'authorization_pending'
        vi.setSystemTime(Date.now() + 5000)
        expect(await run(f.accounts.complete(start.id))).toEqual({ pending: true, interval: 5 })
        f.control.oauthError = ''
        vi.setSystemTime(Date.now() + 5000)
        await run(f.accounts.complete(start.id))
        expect(f.accounts.accounts()[0]).toMatchObject({ userId: '42', provider, emails: ['work@example.test'] })
        expect(await f.store.export()).not.toContain('authorized')
        expect(f.calls.filter((c) => c.body).every((c) => !c.body?.client_secret)).toBe(true)
    }
)
it('backs off slow_down, expires attempts, and explains disabled sign-in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const f = await fixture(),
        start = await run(f.accounts.begin('github'))
    f.control.oauthError = 'slow_down'
    vi.setSystemTime(Date.now() + 5000)
    expect(await run(f.accounts.complete(start.id))).toEqual({ pending: true, interval: 10 })
    vi.setSystemTime(Date.now() + 60000)
    await expect(run(f.accounts.complete(start.id))).rejects.toThrow(/expired/i)
    expect(f.accounts.accounts()).toHaveLength(0)
    f.control.oauthError = 'device_flow_disabled'
    await expect(run(f.accounts.begin('github'))).rejects.toThrow(/unavailable/i)
})
it('renews once after restart for parallel reads and retains the replacement pair', async () => {
    const f = await fixture(),
        id = await f.seed()
    await f.restart()
    expect(await Promise.all([run(f.accounts.token(id)), run(f.accounts.token(id))])).toEqual(['renewed', 'renewed'])
    expect(f.control.rotations).toBe(1)
    await f.restart()
    expect(await run(f.accounts.token(id))).toBe('renewed')
    expect(f.control.rotations).toBe(1)
})
it('renews an early 401 for both metadata and text diff reads', async () => {
    const f = await fixture(),
        id = await f.seed(false)
    f.control.rejectOld = true
    expect(await run(f.accounts.request(id, 'https://api.github.com/repos/team/work'))).toEqual({ ok: true })
    expect(
        await run(
            f.accounts.request<string>(
                id,
                'https://api.github.com/repos/team/work/pulls/1',
                false,
                { headers: { Accept: 'application/vnd.github.diff' } },
                'text'
            )
        )
    ).toContain('diff --git')
    expect(f.control.rotations).toBe(1)
})
it('keeps the prior pair on a declared temporary renewal failure and permits explicit retry', async () => {
    const f = await fixture(),
        id = await f.seed()
    f.control.failRenewal = true
    await expect(run(f.accounts.token(id))).rejects.toThrow()
    expect(f.accounts.accounts()[0]?.status).toBe('connected')
    f.control.failRenewal = false
    expect(await run(f.accounts.token(id))).toBe('renewed')
})
it('does not reinstall credentials after disconnect wins an in-flight rotation', async () => {
    const f = await fixture(),
        id = await f.seed()
    let release!: () => void
    f.control.renewal = () =>
        new Promise<void>((done) => {
            release = done
        })
    const pending = run(f.accounts.token(id))
    const rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(f.control.rotations).toBe(1))
    await run(f.accounts.disconnect(id))
    release()
    await rejected
    expect(f.accounts.accounts()[0]?.status).toBe('disconnected')
    expect(f.secrets.size).toBe(0)
})
it('keeps a rotation alive after its reader cancels and does not block another account', async () => {
    const f = await fixture(),
        first = await f.seed(),
        other = await f.seed(false)
    let release!: () => void
    f.control.renewal = () =>
        new Promise<void>((done) => {
            release = done
        })
    const fiber = Effect.runFork(f.accounts.token(first))
    await vi.waitFor(() => expect(f.control.rotations).toBe(1))
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber))
    expect(await run(f.accounts.token(other))).toBe('old')
    release()
    await interrupted
    expect(await run(f.accounts.token(first))).toBe('renewed')
    expect(f.control.rotations).toBe(1)
})
it('settles accepted rotation before disposal and aborts ordinary owned device reads', async () => {
    const f = await fixture(),
        id = await f.seed()
    let release!: () => void
    f.control.renewal = () =>
        new Promise<void>((done) => {
            release = done
        })
    const pending = Effect.runPromiseExit(f.accounts.token(id))
    await vi.waitFor(() => expect(f.control.rotations).toBe(1))
    let disposed = false
    const closing = f.runtime.dispose().then(() => {
        disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release()
    await closing
    await pending
    expect([...f.secrets.values()].some((s) => s.includes('renewed'))).toBe(true)
    await f.restart()
    f.control.device = (signal) =>
        new Promise<void>((_, reject) =>
            signal.addEventListener(
                'abort',
                () => reject(new Error('Device request aborted', { cause: signal.reason })),
                { once: true }
            )
        )
    const begin = Effect.runPromiseExit(f.accounts.begin('github'))
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith('/device/code'))).toBe(true))
    await f.runtime.dispose()
    await begin
    await expect(run(f.accounts.begin('github'))).rejects.toThrow(/closed/i)
})
it('reports malformed saved credentials through the recoverable failure channel', async () => {
    const f = await fixture(),
        id = await f.seed(false),
        key = f.store.config.accounts[0].credentialKey!
    f.secrets.set(key, '{invalid')
    await expect(run(f.accounts.token(id))).rejects.toThrow(/credentials|reconnect/i)
})

it('serializes simultaneous sign-ins for the same provider identity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const f = await fixture()
    const first = await run(f.accounts.begin('github')),
        second = await run(f.accounts.begin('github'))
    vi.setSystemTime(Date.now() + 5000)
    await Promise.all([run(f.accounts.complete(first.id)), run(f.accounts.complete(second.id))])
    expect(f.accounts.accounts()).toHaveLength(1)
    expect(f.accounts.accounts()[0]?.generation).toBe(2)
    expect(f.secrets.size).toBe(1)
    await f.restart()
    expect(await run(f.accounts.token(f.accounts.accounts()[0].id))).toBe('authorized')
})

it('settles a live token rotation before installing a reconnect without orphaning either pair', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const f = await fixture(),
        id = await f.seed()
    f.control.user = 42
    let release!: () => void
    f.control.renewal = () =>
        new Promise<void>((done) => {
            release = done
        })
    const rotation = run(f.accounts.token(id))
    await vi.waitFor(() => expect(f.control.rotations).toBe(1))
    const start = await run(f.accounts.begin('github', id))
    vi.setSystemTime(Date.now() + 5000)
    const reconnect = run(f.accounts.complete(start.id))
    await vi.waitFor(() => expect(f.calls.some((c) => c.url.endsWith('/user/emails'))).toBe(true))
    release()
    await Promise.all([rotation, reconnect])
    expect(f.accounts.accounts()).toHaveLength(1)
    expect(f.accounts.accounts()[0]?.generation).toBe(2)
    expect(f.secrets.size).toBe(1)
    expect(await run(f.accounts.token(id))).toBe('authorized')
})
