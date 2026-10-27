import { providerHttp } from './transport-fixtures'
import { afterEach, expect, it, vi } from 'vitest'
import { GitHub } from '../src/main/github'
import { sampleState } from '../src/renderer/workspace-sample'
// Failure modes: discarded refresh credentials, simultaneous repository refreshes,
// rotation after a restart, and a disconnect while rotation is in flight.
it('renews an expired device credential after restart for multiple repositories without reconnecting', async () => {
    vi.useFakeTimers()
    let stored = ''
    let rotations = 0
    const transport: typeof fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url.endsWith('/device/code'))
            return Promise.resolve(
                Response.json({
                    device_code: 'device',
                    user_code: 'CODE',
                    verification_uri: 'https://github.com/login/device',
                    interval: 1,
                    expires_in: 600
                })
            )
        if (url.endsWith('/oauth/access_token')) {
            if (typeof init?.body !== 'string') throw new Error('Expected a JSON exchange body')
            const body = JSON.parse(init.body) as Record<string, string>
            if (body.grant_type === 'refresh_token') {
                rotations++
                expect(body.refresh_token).toBe(`refresh-${rotations - 1}`)
                expect(body.client_secret).toBeUndefined()
            }
            return Promise.resolve(
                Response.json({
                    access_token: `access-${rotations}`,
                    refresh_token: `refresh-${rotations}`,
                    expires_in: 28800
                })
            )
        }
        if (url.endsWith('/user')) return Promise.resolve(Response.json({ login: 'author' }))
        if (url.endsWith('/user/emails')) return Promise.resolve(Response.json([]))
        const expected = rotations > 0 ? `access-${rotations}` : 'expired'
        return Promise.resolve(
            new Headers(init?.headers).get('Authorization') === `Bearer ${expected}`
                ? Response.json([])
                : new Response('{}', { status: 401 })
        )
    }
    vi.stubGlobal('fetch', transport)
    const create = () =>
        new GitHub(
            providerHttp(transport),
            () => stored,
            (value) => {
                stored = value
            }
        )
    const signin = create()
    await signin.start()
    vi.advanceTimersByTime(1000)
    await signin.poll()
    vi.advanceTimersByTime(9 * 60 * 60 * 1000)
    const state = sampleState('2026-10-05')
    const reopened = create()
    await expect(
        Promise.all(state.repositories.slice(0, 2).map((repo) => reopened.files(repo, state.activities[8])))
    ).resolves.toEqual([[], []])
    expect(rotations).toBe(1)
    vi.advanceTimersByTime(9 * 60 * 60 * 1000)
    await expect(create().files(state.repositories[0], state.activities[8])).resolves.toEqual([])
    expect(rotations).toBe(2)
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})
it('respects GitHub device polling intervals and discovers identities after authorization', async () => {
    vi.useFakeTimers()
    let token = ''
    let authorized = false
    let attempts = 0
    const requests: {
        url: string
        body: Record<string, string>
    }[] = []
    const transport: typeof fetch = (input, init) =>
        Promise.resolve().then(() => {
            const url = input instanceof Request ? input.url : String(input)
            if (typeof init?.body === 'string') requests.push({ url, body: JSON.parse(init.body) })
            const json = (value: unknown) => new Response(JSON.stringify(value))
            if (url.endsWith('/device/code'))
                return json({
                    device_code: 'private-device-code',
                    user_code: 'ABCD-EFGH',
                    verification_uri: 'https://github.com/login/device',
                    interval: 5,
                    expires_in: 900
                })
            if (url.endsWith('/oauth/access_token')) {
                attempts++
                return json(authorized ? { access_token: 'private-token' } : { error: 'authorization_pending' })
            }
            if (url.endsWith('/user/emails')) return json([{ email: 'one@example.com' }, { email: 'two@example.com' }])
            return json({ login: 'journal-author' })
        })
    vi.stubGlobal('fetch', transport)
    const github = new GitHub(
        providerHttp(transport),
        () => token,
        (value) => {
            token = value
        }
    )
    const device = await github.start()
    expect(device).toEqual({ code: 'ABCD-EFGH', url: 'https://github.com/login/device', interval: 5 })
    expect(JSON.stringify(device)).not.toContain('private-device-code')
    expect(await github.poll()).toEqual({ pending: true, interval: 5 })
    expect(attempts).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(await github.poll()).toEqual({ pending: true, interval: 5 })
    authorized = true
    vi.advanceTimersByTime(5000)
    expect(await github.poll()).toEqual({ login: 'journal-author', emails: ['one@example.com', 'two@example.com'] })
    expect(token).toBe('private-token')
    expect(
        requests
            .filter(({ url }) => url.includes('github.com/login/'))
            .every(({ body }) => body.client_id === 'Ov23li9PFMAWRrbZQ6Xy' && !('client_secret' in body))
    ).toBe(true)
})
it('renews once on an early 401, including a diff request, while preserving legacy tokens', async () => {
    let stored = JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires: Date.now() + 3600000 })
    let rotations = 0
    const transport: typeof fetch = (input, init) => {
        if ((input instanceof Request ? input.url : input.toString()).includes('/oauth/access_token')) {
            rotations++
            return Promise.resolve(Response.json({ access_token: 'new', refresh_token: 'next', expires_in: 28800 }))
        }
        if (
            new Headers(init?.headers).get('Authorization') === 'Bearer old' &&
            new Headers(init?.headers).get('Accept') === 'application/vnd.github.diff'
        )
            return Promise.resolve(new Response('{}', { status: 401 }))
        return Promise.resolve(
            new Headers(init?.headers).get('Accept') === 'application/vnd.github.diff'
                ? new Response('fixture diff')
                : Response.json({ files: [] })
        )
    }
    vi.stubGlobal('fetch', transport)
    const github = new GitHub(
        providerHttp(transport),
        () => stored,
        (value) => {
            stored = value
        }
    )
    const repo = sampleState('2026-10-05').repositories[0]
    expect((await github.commitDetails(repo, 'a'.repeat(40))).diff).toBe('fixture diff')
    expect(rotations).toBe(1)
    stored = 'legacy-token'
    await github.commitDetails(repo, 'b'.repeat(40))
    expect(rotations).toBe(1)
})
it('keeps credentials on a temporary renewal failure and permits retry', async () => {
    let stored = JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires: 1 })
    const original = stored
    const exchange = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(Response.json({ access_token: 'new', refresh_token: 'next', expires_in: 28800 }))
    vi.stubGlobal('fetch', exchange)
    const github = new GitHub(
        providerHttp(() => Promise.resolve(Response.json([]))),
        () => stored,
        (value) => {
            stored = value
        }
    )
    const state = sampleState('2026-10-05')
    await expect(github.files(state.repositories[0], state.activities[8])).rejects.toThrow('fetch failed')
    expect(stored).toBe(original)
    await expect(github.files(state.repositories[0], state.activities[8])).resolves.toEqual([])
    expect(exchange).toHaveBeenCalledTimes(2)
})
it('does not restore a disconnected credential when a renewal completes late', async () => {
    let stored = JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires: 1 })
    let finish!: (response: Response) => void
    vi.stubGlobal(
        'fetch',
        () =>
            new Promise<Response>((resolve) => {
                finish = resolve
            })
    )
    const api = vi.fn<typeof fetch>()
    const github = new GitHub(
        providerHttp(api),
        () => stored,
        (value) => {
            stored = value
        }
    )
    const state = sampleState('2026-10-05')
    const pending = github.files(state.repositories[0], state.activities[8])
    stored = ''
    finish(Response.json({ access_token: 'new', refresh_token: 'next', expires_in: 28800 }))
    await expect(pending).rejects.toThrow('connection changed')
    expect(stored).toBe('')
    expect(api).not.toHaveBeenCalled()
})
it('backs off after a rate limit without issuing repeated requests', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const transport: typeof fetch = () =>
        Promise.resolve().then(() => {
            attempts++
            return new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
        })
    const http = providerHttp(transport)
    await expect(http.request('https://api.notion.com/v1/users/me', 'private-token')).rejects.toThrow('429')
    await expect(http.request('https://api.notion.com/v1/users/me', 'private-token')).rejects.toThrow('rate limit')
    expect(attempts).toBe(1)
    vi.advanceTimersByTime(30000)
    await expect(http.request('https://api.notion.com/v1/users/me', 'private-token')).rejects.toThrow('429')
    expect(attempts).toBe(2)
})
it('keeps polling GitHub after slow_down and reports expiry without connecting', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const setToken = vi.fn()
    const transport: typeof fetch = (input) =>
        Promise.resolve().then(() => {
            const url = input instanceof Request ? input.url : String(input)
            return new Response(
                JSON.stringify(
                    url.endsWith('/device/code')
                        ? {
                              device_code: 'test-device',
                              user_code: 'ABCD-EFGH',
                              verification_uri: 'https://github.com/login/device',
                              interval: 5,
                              expires_in: 900
                          }
                        : ++attempts === 1
                          ? { error: 'slow_down' }
                          : { error: 'expired_token' }
                )
            )
        })
    vi.stubGlobal('fetch', transport)
    const github = new GitHub(providerHttp(transport), () => '', setToken)
    await github.start()
    vi.advanceTimersByTime(5000)
    expect(await github.poll()).toEqual({ pending: true, interval: 10 })
    vi.advanceTimersByTime(5000)
    expect(await github.poll()).toEqual({ pending: true, interval: 5 })
    expect(attempts).toBe(1)
    vi.advanceTimersByTime(5000)
    await expect(github.poll()).rejects.toThrow('expired')
    expect(setToken).not.toHaveBeenCalled()
})
it('explains disabled GitHub device flow before attempting browser authorization', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ error: 'device_flow_disabled' }))))
    const github = new GitHub(providerHttp(), () => '', vi.fn())
    await expect(github.start()).rejects.toThrow('GitHub sign-in is unavailable')
})
