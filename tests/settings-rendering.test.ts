// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ExpandableCard } from '../src/renderer/components/arc/expandable-card/expandable-card'
import type * as MotionReact from 'motion/react'
import { Settings } from '../src/renderer/Settings'
import { initialState, type Command, type Reply } from '../src/shared/model'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

async function renderUpdate(update: () => void) {
    await act(async () => {
        update()
        await Promise.resolve()
    })
}

it('keeps destination test failures and retry feedback in the secondary control without changing the footer', async () => {
    const state = initialState()
    state.settings.destination = { kind: 'page', id: 'destination', titleProperty: 'Name', dateProperty: '' }
    const reply: Reply = { state, connections: { github: true, notion: true, protectedStorage: true } }
    const failure = 'Error invoking remote method: Page could not be reached'
    let reachable = false
    let finish!: () => void
    const invoke = vi.fn((command: Command): Promise<Reply> => {
        if (command.type === 'notionTestDestination' && !reachable) return Promise.reject(new Error(failure))
        if (command.type === 'notionTestDestination')
            return new Promise((resolve) => {
                finish = () => resolve(reply)
            })
        return Promise.resolve(reply)
    })
    const previousJournal = window.journal
    window.journal = { invoke }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await renderUpdate(() =>
            root.render(
                createElement(Settings, {
                    state,
                    connections: reply.connections,
                    remotes: {},
                    run: () => Promise.resolve(reply),
                    close: vi.fn()
                })
            )
        )
        const connections = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
            (tab) => tab.textContent === 'Connections'
        )!
        await renderUpdate(() => connections.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
        const footer = document.querySelector('footer')!
        const footerBefore = footer.textContent
        const controls = [...document.querySelectorAll<HTMLElement>('[data-mode="hold"]')]
        expect(controls).toHaveLength(2)
        expect(controls.every((control) => control.dataset.variant === 'secondary')).toBe(true)
        const test = document.querySelector<HTMLElement>('[data-mode="immediate"]')!
        expect(test.dataset.variant).toBe('secondary')
        await renderUpdate(() => test.querySelector<HTMLButtonElement>('button')!.click())
        expect(test.dataset.state).toBe('error')
        expect(test.textContent).toContain('Unreachable')
        expect(footer.textContent).toBe(footerBefore)
        expect(footer.querySelector('[role="alert"]')).toBeNull()
        expect(document.body.textContent).not.toContain(failure)
        reachable = true
        const retry = [...test.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
        await renderUpdate(() => retry.click())
        expect(test.dataset.state).toBe('pending')
        expect(invoke.mock.calls.filter(([command]) => command.type === 'notionTestDestination')).toHaveLength(2)
        await renderUpdate(() => finish())
        expect(test.dataset.state).toBe('done')
        expect(test.textContent).toContain('Reachable')
        expect(footer.textContent).toBe(footerBefore)
    } finally {
        await renderUpdate(() => root.unmount())
        host.remove()
        window.journal = previousJournal
    }
})

it('defers fields for 24 closed repository cards and keeps them mounted after first expansion', async () => {
    const fields = vi.fn(() => createElement('input', { defaultValue: 'author@example.com' }))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
        await renderUpdate(() => {
            root.render(
                createElement(
                    'div',
                    {},
                    Array.from({ length: 24 }, (_, index) =>
                        createElement(ExpandableCard, {
                            key: index,
                            title: `Repository ${index}`,
                            description: `C:/projects/repository-${index}`,
                            children: fields
                        })
                    )
                )
            )
        })
        expect(fields).not.toHaveBeenCalled()
        expect(host.querySelectorAll('input')).toHaveLength(0)
        const trigger = host.querySelector('button')!
        await renderUpdate(() => {
            trigger.click()
        })
        expect(host.querySelectorAll('input')).toHaveLength(1)
        const input = host.querySelector('input')!
        input.value = 'edited@example.com'
        await renderUpdate(() => {
            trigger.click()
        })
        expect(host.querySelector('input')).toBe(input)
        expect(input.value).toBe('edited@example.com')
    } finally {
        await renderUpdate(() => {
            root.unmount()
        })
        host.remove()
    }
})
