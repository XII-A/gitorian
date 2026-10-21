import { afterEach, expect, it, vi } from 'vitest'
import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

it('respects GitHub device polling intervals and discovers identities after authorization', async () => {
    vi.useFakeTimers()
    let token = ''
    let authorized = false
    let attempts = 0
    const requests: { url: string; body: Record<string, string> }[] = []
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
        new Http(transport),
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

it('backs off after a rate limit without issuing repeated requests', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const transport: typeof fetch = () =>
        Promise.resolve().then(() => {
            attempts++
            return new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
        })
    const http = new Http(transport)
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
    const github = new GitHub(new Http(transport), () => '', setToken)
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
    const github = new GitHub(new Http(), () => '', vi.fn())
    await expect(github.start()).rejects.toThrow('GitHub sign-in is unavailable')
})
