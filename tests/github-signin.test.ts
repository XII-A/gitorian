// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type * as MotionReact from 'motion/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { Settings } from '../src/renderer/Settings'
import { initialState, type Command, type Reply } from '../src/shared/model'

vi.mock('motion/react', async (original) => ({
    ...(await original<typeof MotionReact>()),
    useReducedMotion: () => true
}))

// Exercise Motion's JavaScript fallback: happy-dom's incomplete WAAPI rejects canceled animations.
const nativeAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
beforeAll(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
})
afterAll(() => {
    if (nativeAnimate) Object.defineProperty(Element.prototype, 'animate', nativeAnimate)
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

async function update(task: () => unknown) {
    await act(async () => {
        await task()
    })
}

function button(name: string) {
    const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) =>
            !item.closest('[inert]') && (item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
    )
    if (!node) throw new Error(`Missing button: ${name}`)
    return node
}

async function setup() {
    const state = initialState()
    const device = { code: 'ABCD-EFGH', url: 'https://github.com/login/device', interval: 5 }
    const reply = (): Reply => ({
        state,
        connections: { github: !!state.settings.githubLogin, notion: false, protectedStorage: true }
    })
    const poll = vi
        .fn<() => Promise<Reply>>()
        .mockImplementation(() => Promise.resolve({ ...reply(), devicePending: { interval: 5 } }))
    const start = vi.fn<() => Promise<Reply>>().mockImplementation(() => Promise.resolve({ ...reply(), device }))
    const invoke = vi.fn(async (command: Command): Promise<Reply> => {
        if (command.type === 'githubStart') return start()
        if (command.type === 'githubPoll') return poll()
        return reply()
    })
    vi.stubGlobal('journal', { invoke })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const run = vi.fn(async (command: Command) => {
        const result = await invoke(command)
        render(result)
        return result
    })
    const render = (result: Reply) =>
        root.render(
            createElement(Settings, {
                state: result.state,
                connections: result.connections,
                remotes: {},
                run,
                close: vi.fn()
            })
        )
    await update(() => {
        render(reply())
    })
    await update(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === 'Connections')!
        tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    })
    return {
        state,
        device,
        reply,
        invoke,
        start,
        poll,
        run,
        cleanup: async () => {
            await update(() => {
                root.unmount()
            })
            host.remove()
        }
    }
}

it('replaces the sign-in action with a selectable code and copies the exact code with in-place feedback', async () => {
    const app = await setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    try {
        await update(() => {
            button('Connect GitHub').click()
        })
        expect(document.querySelector('.settings')?.textContent).not.toContain('OAuth client ID')
        expect(document.querySelector('.settings')?.textContent).not.toContain('Set up OAuth app')
        expect(app.invoke.mock.calls.some(([command]) => command.type === 'settings')).toBe(false)
        const surface = document.querySelector('.github-signin-surface')!
        expect(surface.getAttribute('data-expanded')).toBe('true')
        expect(surface.querySelector('code')?.textContent).toBe('ABCD-EFGH')
        expect([...surface.querySelectorAll('button')].filter((b) => !b.closest('[inert]'))).toHaveLength(3)
        expect(surface.closest('.settings-section-heading')).not.toBeNull()
        expect(surface.querySelector('[data-copy-state]')?.getAttribute('aria-label')).toBe('Copy code')
        expect(surface.querySelector('[data-copy-state]')?.textContent).not.toContain('Copy code')
        expect(document.querySelector('.settings-device')).toBeNull()
        await update(() => {
            button('Copy code').click()
        })
        expect(write).toHaveBeenCalledWith('ABCD-EFGH')
        expect(button('Copy code').getAttribute('data-copy-state')).toBe('copied')
        expect(surface.querySelector('[role="status"]')?.textContent).toContain('Copied')
        await update(() => vi.advanceTimersByTimeAsync(400))
    } finally {
        await app.cleanup()
    }
})

it('reports clipboard failure in place and still permits manual use of the code', async () => {
    const app = await setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'))
    try {
        await update(() => {
            button('Connect GitHub').click()
        })
        await update(() => {
            button('Copy code').click()
        })
        expect(button('Copy code').getAttribute('data-copy-state')).toBe('error')
        expect(document.querySelector('.github-signin-code')?.textContent).toBe('ABCD-EFGH')
        expect(document.querySelector('.github-signin-surface')?.textContent).toContain('Could not copy')
        await update(() => vi.advanceTimersByTimeAsync(400))
    } finally {
        await app.cleanup()
    }
})

it('cancels polling, returns focus to sign-in, and ignores a late poll response', async () => {
    const app = await setup()
    let resolvePoll: (reply: Reply) => void = () => {
        throw new Error('Poll has not started')
    }
    app.poll.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolvePoll = resolve
            })
    )
    try {
        await update(() => {
            button('Connect GitHub').click()
        })
        await update(() => vi.advanceTimersByTimeAsync(5000))
        expect(app.poll).toHaveBeenCalledTimes(1)
        await update(() => {
            button('Cancel').click()
        })
        await update(() => vi.advanceTimersByTimeAsync(32))
        expect(document.activeElement).toBe(button('Connect GitHub'))
        await update(() => {
            resolvePoll({ ...app.reply(), devicePending: { interval: 5 } })
        })
        await update(() => vi.advanceTimersByTimeAsync(15000))
        expect(app.poll).toHaveBeenCalledTimes(1)
        expect(document.querySelector('.github-signin-surface')?.getAttribute('data-expanded')).toBe('false')
    } finally {
        await app.cleanup()
    }
})

it('shows an expired-code retry in the same surface and obtains a fresh code', async () => {
    const app = await setup()
    app.poll.mockRejectedValueOnce(new Error('GitHub sign-in expired; start again'))
    try {
        await update(() => {
            button('Connect GitHub').click()
        })
        const surface = document.querySelector('.github-signin-surface')
        await update(() => vi.advanceTimersByTimeAsync(5000))
        expect(surface?.textContent).toContain('Code expired')
        expect(surface?.querySelector('[data-face="confirming"]:not([inert]) code')).toBeNull()
        app.start.mockResolvedValueOnce({ ...app.reply(), device: { ...app.device, code: 'IJKL-MNOP' } })
        await update(() => {
            button('Retry').click()
        })
        expect(document.querySelector('.github-signin-surface')).toBe(surface)
        expect(surface?.querySelector('[data-face="confirming"]:not([inert]) code')?.textContent).toBe('IJKL-MNOP')
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
            button('Connect GitHub').click()
        })
        await update(() => vi.advanceTimersByTimeAsync(5000))
        expect(document.querySelector('.github-signin-surface')?.getAttribute('data-phase')).toBe('authorizing')
        await update(() => vi.advanceTimersByTimeAsync(450))
        expect(
            document.querySelector('.github-signin-surface [data-face="done"]:not([role="group"]):not([inert])')
                ?.textContent
        ).toBe('Connected')
        expect(document.querySelector('.connection-identity')?.getAttribute('aria-hidden')).toBe('true')
        await update(() => vi.advanceTimersByTimeAsync(900))
        expect(document.querySelector('.github-signin-surface')?.getAttribute('data-phase')).toBe('connected')
        expect(document.querySelector('.settings-github-account')?.textContent).toContain('journal-author')
    } finally {
        await app.cleanup()
    }
})

it('keeps actionable setup errors beside sign-in and hides raw request diagnostics', async () => {
    const app = await setup()
    app.start.mockRejectedValueOnce(new Error('HTTP 401 internal request payload'))
    try {
        await update(() => {
            button('Connect GitHub').click()
        })
        const error = document.querySelector(
            '.github-signin-surface [data-face="error"]:not([role="group"]):not([inert])'
        )!
        expect(error.textContent).toContain('Could not connect')
        expect(error.querySelector('.settings-hint')).toBeNull()
        expect([...error.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Retry'])
        expect(document.querySelector('.settings')?.textContent).not.toContain('internal request payload')
        expect(button('Retry')).toBeDefined()
    } finally {
        await app.cleanup()
    }
})
