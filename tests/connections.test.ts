import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'

const json = (value: unknown) => Response.json(value)

describe('connections', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('respects GitHub device polling intervals and discovers identities after authorization', async () => {
        vi.useFakeTimers()
        let token = ''
        let authorized = false
        let attempts = 0
        const transport: typeof fetch = (input) =>
            Promise.resolve(
                Promise.resolve().then(() => {
                    const url = input instanceof Request ? input.url : String(input)

                    if (url.endsWith('/device/code')) {
                        return json({
                            device_code: 'private-device-code',
                            expires_in: 900,
                            interval: 5,
                            user_code: 'ABCD-EFGH',
                            verification_uri: 'https://github.com/login/device'
                        })
                    }
                    if (url.endsWith('/oauth/access_token')) {
                        attempts += 1
                        return json(authorized ? { access_token: 'private-token' } : { error: 'authorization_pending' })
                    }
                    if (url.endsWith('/user/emails')) {
                        return json([{ email: 'one@example.com' }, { email: 'two@example.com' }])
                    }
                    return json({ login: 'journal-author' })
                })
            )
        vi.stubGlobal('fetch', transport)
        const github = new GitHub(
            new Http(transport),
            () => token,
            (value) => {
                token = value
            }
        )
        const device = await github.start('public-client-id')
        expect(device).toStrictEqual({ code: 'ABCD-EFGH', interval: 5, url: 'https://github.com/login/device' })
        expect(JSON.stringify(device)).not.toContain('private-device-code')
        await expect(github.poll()).resolves.toStrictEqual({ interval: 5, pending: true })
        expect(attempts).toBe(0)
        vi.advanceTimersByTime(5000)
        await expect(github.poll()).resolves.toStrictEqual({ interval: 5, pending: true })
        authorized = true
        vi.advanceTimersByTime(5000)
        await expect(github.poll()).resolves.toStrictEqual({
            emails: ['one@example.com', 'two@example.com'],
            login: 'journal-author'
        })
        expect(token).toBe('private-token')
    })

    it('backs off after a rate limit without issuing repeated requests', async () => {
        vi.useFakeTimers()
        let attempts = 0
        const transport: typeof fetch = () =>
            Promise.resolve(
                Promise.resolve().then(() => {
                    attempts += 1
                    return new Response('{}', { headers: { 'retry-after': '30' }, status: 429 })
                })
            )
        const http = new Http(transport)
        await expect(http.request('https://api.notion.com/v1/users/me', 'private-token')).rejects.toThrow('429')
        await expect(http.request('https://api.notion.com/v1/users/me', 'private-token')).rejects.toThrow('rate limit')
        expect(attempts).toBe(1)
        vi.advanceTimersByTime(30_000)
        await expect(http.request('https://api.notion.com/v1/users/me', 'private-token')).rejects.toThrow('429')
        expect(attempts).toBe(2)
    })

    it('keeps polling GitHub after slow_down and reports expiry without connecting', async () => {
        vi.useFakeTimers()
        let attempts = 0
        const setToken = vi.fn<(...args: unknown[]) => void>()
        const transport: typeof fetch = (input) =>
            Promise.resolve(
                Promise.resolve().then(() => {
                    const url = input instanceof Request ? input.url : String(input)
                    return Response.json(
                        (() => {
                            if (url.endsWith('/device/code')) {
                                return {
                                    device_code: 'test-device',
                                    expires_in: 900,
                                    interval: 5,
                                    user_code: 'ABCD-EFGH',
                                    verification_uri: 'https://github.com/login/device'
                                }
                            }
                            attempts += 1
                            if (attempts === 1) {
                                return { error: 'slow_down' }
                            }
                            return { error: 'expired_token' }
                        })()
                    )
                })
            )
        vi.stubGlobal('fetch', transport)
        const github = new GitHub(new Http(transport), () => '', setToken)
        await github.start('test-client')
        vi.advanceTimersByTime(5000)
        await expect(github.poll()).resolves.toStrictEqual({ interval: 10, pending: true })
        vi.advanceTimersByTime(5000)
        await expect(github.poll()).resolves.toStrictEqual({ interval: 5, pending: true })
        expect(attempts).toBe(1)
        vi.advanceTimersByTime(5000)
        await expect(github.poll()).rejects.toThrow('expired')
        expect(setToken).not.toHaveBeenCalled()
    })

    it('explains disabled GitHub device flow before attempting browser authorization', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ error: 'device_flow_disabled' })))
        const github = new GitHub(new Http(), () => '', vi.fn<(...args: unknown[]) => void>())
        await expect(github.start('test-client')).rejects.toThrow('Enable device flow')
    })
})
