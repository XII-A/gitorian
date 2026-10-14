// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { Settings } from '../src/renderer/settings'
import type { Command, Reply } from '../src/shared/model'
import { initialState } from '../src/shared/model'
import { required } from '../src/shared/required'

const update = async (task: () => unknown) => {
    await act(async () => {
        await task()
    })
}

const button = (name: string) => {
    const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name
    )
    if (!node) {
        throw new Error(`Missing button: ${name}`)
    }
    return node
}

let resolvePoll: (reply: Reply) => void = () => {
    throw new Error('Poll has not started')
}

vi.mock(import('motion/react'), async (original) => ({
    ...(await original()),
    useReducedMotion: () => true
}))

describe('github-signin', () => {
    // Exercise Motion's JavaScript fallback: happy-dom's incomplete WAAPI rejects canceled animations.
    const nativeAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
    beforeAll(() => {
        Reflect.deleteProperty(Element.prototype, 'animate')
    })

    afterAll(() => {
        if (nativeAnimate) {
            Object.defineProperty(Element.prototype, 'animate', nativeAnimate)
        }
    })

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    const setup = async () => {
        const state = initialState()
        state.settings.githubClientId = 'public-client-id'
        const device = { code: 'ABCD-EFGH', interval: 5, url: 'https://github.com/login/device' }
        const reply = (): Reply => ({
            connections: { github: !!state.settings.githubLogin, notion: false, protectedStorage: true },
            state
        })
        const poll = vi.fn<() => Promise<Reply>>().mockResolvedValue({
            ...reply(),
            devicePending: { interval: 5 }
        })
        const start = vi.fn<() => Promise<Reply>>().mockResolvedValue({
            ...reply(),
            device
        })
        const invoke = vi.fn<(command: Command) => Promise<Reply>>(async (command: Command): Promise<Reply> => {
            if (command.type === 'githubStart') {
                return await start()
            }
            if (command.type === 'githubPoll') {
                return await poll()
            }
            return reply()
        })
        vi.stubGlobal('journal', { invoke })
        const host = document.createElement('div')
        document.body.append(host)
        const root = createRoot(host)
        const render = (result: Reply) => {
            root.render(
                createElement(Settings, {
                    close: vi.fn<(...args: unknown[]) => void>(),
                    connections: result.connections,
                    remotes: {},
                    run,
                    state: result.state
                })
            )
        }

        const run = vi.fn<(command: Command) => Promise<Reply>>(async (command: Command) => {
            const result = await invoke(command)
            render(result)
            return result
        })

        await update(() => {
            render(reply())
        })
        await update(() => {
            const tab = required(
                [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === 'Connections')
            )
            tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        })
        return {
            cleanup: async () => {
                await update(() => {
                    root.unmount()
                })
                host.remove()
            },
            device,
            invoke,
            poll,
            reply,
            run,
            start,
            state
        }
    }

    it('replaces the sign-in action with a selectable code and copies the exact code with in-place feedback', async () => {
        const app = await setup()
        const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
        try {
            await update(() => {
                button('Sign in with browser').click()
            })
            const surface = required(document.querySelector<HTMLElement>('.github-signin-surface'))
            expect([
                surface.dataset.expanded,
                Object.is(surface.querySelector('code')?.textContent, 'ABCD-EFGH'),
                surface.querySelectorAll('button')?.length,
                document.querySelector('.settings-device') === null
            ]).toStrictEqual(['true', true, 3, true])
            await update(() => {
                button('Copy code').click()
            })
            expect(write).toHaveBeenCalledWith('ABCD-EFGH')
            expect([
                button('Copy code').dataset.copyState,
                surface.querySelector('[role="status"]')?.textContent?.includes('Copied')
            ]).toStrictEqual(['copied', true])
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(400)))
        } finally {
            await app.cleanup()
        }
    })

    it('reports clipboard failure in place and still permits manual use of the code', async () => {
        const app = await setup()
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'))
        try {
            await update(() => {
                button('Sign in with browser').click()
            })
            await update(() => {
                button('Copy code').click()
            })
            expect([
                button('Copy code').dataset.copyState,
                Object.is(document.querySelector('.github-signin-code')?.textContent, 'ABCD-EFGH'),
                document.querySelector('.github-signin-surface')?.textContent?.includes('Could not copy')
            ]).toStrictEqual(['error', true, true])
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(400)))
        } finally {
            await app.cleanup()
        }
    })

    it('cancels polling, returns focus to sign-in, and ignores a late poll response', async () => {
        const app = await setup()

        app.poll.mockReturnValueOnce(
            (() => {
                const { promise, resolve, reject } = Promise.withResolvers<Reply>()
                try {
                    resolvePoll = resolve
                } catch (error) {
                    reject(error)
                }
                return promise
            })()
        )
        try {
            await update(() => {
                button('Sign in with browser').click()
            })
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(5000)))
            expect(app.poll).toHaveBeenCalledOnce()
            await update(() => {
                button('Cancel sign-in').click()
            })
            expect(document.activeElement).toBe(button('Sign in with browser'))
            await update(() => {
                resolvePoll({ ...app.reply(), devicePending: { interval: 5 } })
            })
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(15_000)))
            expect([
                app.poll.mock.calls.length,
                document.querySelector<HTMLElement>('.github-signin-surface')?.dataset.expanded
            ]).toStrictEqual([1, 'false'])
        } finally {
            await app.cleanup()
        }
    })

    it('shows an expired-code retry in the same surface and obtains a fresh code', async () => {
        const app = await setup()
        app.poll.mockRejectedValueOnce(new Error('GitHub sign-in expired; start again'))
        try {
            await update(() => {
                button('Sign in with browser').click()
            })
            const surface = document.querySelector('.github-signin-surface')
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(5000)))
            expect([
                surface?.textContent?.includes('Code expired'),
                surface?.querySelector('code') === null
            ]).toStrictEqual([true, true])
            app.start.mockResolvedValueOnce({ ...app.reply(), device: { ...app.device, code: 'IJKL-MNOP' } })
            await update(() => {
                button('Try sign-in again').click()
            })
            expect([
                Object.is(document.querySelector('.github-signin-surface'), surface),
                Object.is(surface?.querySelector('code')?.textContent, 'IJKL-MNOP')
            ]).toStrictEqual([true, true])
        } finally {
            await app.cleanup()
        }
    })

    it('confirms authorization before revealing the connected account controls', async () => {
        const app = await setup()
        app.poll.mockImplementationOnce(() => {
            app.state.settings.githubLogin = 'journal-author'
            return Promise.resolve(app.reply())
        })
        try {
            await update(() => {
                button('Sign in with browser').click()
            })
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(5000)))
            expect([
                document.querySelector('.github-signin-surface')?.textContent?.includes('Connected as journal-author'),
                document.querySelector('.settings-github-account') === null
            ]).toStrictEqual([true, true])
            await update(() => Promise.resolve(vi.advanceTimersByTimeAsync(900)))
            expect([
                document.querySelector('.github-signin-surface') === null,
                document.querySelector('.settings-github-account')?.textContent?.includes('journal-author')
            ]).toStrictEqual([true, true])
        } finally {
            await app.cleanup()
        }
    })

    it('keeps actionable setup errors beside sign-in and hides raw request diagnostics', async () => {
        const app = await setup()
        app.start.mockRejectedValueOnce(new Error('HTTP 401 internal request payload'))
        try {
            await update(() => {
                button('Sign in with browser').click()
            })
            expect([
                document.querySelector('.github-signin-error')?.textContent?.includes('Check your connection'),
                document.querySelector('.settings')?.textContent?.includes('internal request payload'),
                button('Try sign-in again') !== undefined
            ]).toStrictEqual([true, false, true])
        } finally {
            await app.cleanup()
        }
    })
})
