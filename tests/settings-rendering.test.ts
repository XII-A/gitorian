// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ExpandableCard } from '../src/renderer/components/arc/expandable-card/expandable-card'
import type * as MotionReact from 'motion/react'

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
