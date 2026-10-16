// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ExpandableCard } from '../src/renderer/components/arc/expandable-card/expandable-card'
import type * as MotionReact from 'motion/react'
import { Button } from '../src/renderer/components/arc/button/button'
import { ImportProgressLabel } from '../src/renderer/ImportProgressLabel'
import { ConfirmMorph } from '../src/renderer/components/arc/confirm-morph/confirm-morph'
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
    const invoke = vi.fn((command: Command): Promise<Reply> => {
        if (command.type === 'notionTestDestination' && !reachable) return Promise.reject(new Error(failure))
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
        expect(test.dataset.state).toBe('done')
        expect(test.textContent).toContain('Reachable')
        expect(footer.textContent).toBe(footerBefore)
    } finally {
        await renderUpdate(() => root.unmount())
        host.remove()
        window.journal = previousJournal
    }
})

it('runs immediate morph actions on one press, shows failures, and retries through pending to success', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let finish: (() => void) | undefined
    const onConfirm = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('Not reachable'))
        .mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve
                })
        )
    try {
        await renderUpdate(() =>
            root.render(
                createElement(ConfirmMorph, {
                    label: 'Test destination',
                    confirmMode: 'immediate',
                    pendingLabel: 'Testing',
                    doneLabel: 'Reachable',
                    errorLabel: 'Unreachable',
                    resultTimeout: 0,
                    onConfirm
                })
            )
        )
        await renderUpdate(() => host.querySelector<HTMLButtonElement>('button')!.click())
        expect(onConfirm).toHaveBeenCalledTimes(1)
        expect(host.querySelector('[data-state="error"]')).not.toBeNull()
        expect(host.textContent).toContain('Unreachable')
        const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
        await renderUpdate(() => retry.click())
        expect(onConfirm).toHaveBeenCalledTimes(2)
        expect(host.querySelector('[data-state="pending"]')).not.toBeNull()
        await renderUpdate(() => finish!())
        expect(host.querySelector('[data-state="done"]')).not.toBeNull()
        expect(host.textContent).toContain('Reachable')
    } finally {
        await renderUpdate(() => root.unmount())
        host.remove()
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

it('keeps the import button sentence mounted when only its progress numbers change', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const render = (completed: number) =>
        root.render(
            createElement(
                Button,
                {},
                createElement(ImportProgressLabel, {
                    progress: { stage: 'processing', completed, total: 24 }
                })
            )
        )
    try {
        await renderUpdate(() => {
            render(1)
        })
        const sentence = host.querySelector('[aria-live="polite"]')!
        const labelPhase = sentence.parentElement
        await renderUpdate(() => {
            render(2)
        })
        expect(host.querySelector('[aria-live="polite"]')).toBe(sentence)
        expect(sentence.parentElement).toBe(labelPhase)
        expect(host.querySelector('.settings-progress-number .settings-sr-only')?.textContent).toBe('2')
        expect(sentence.textContent).toContain('Processing repositories')
    } finally {
        await renderUpdate(() => {
            root.unmount()
        })
        host.remove()
    }
})
