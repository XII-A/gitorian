// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { ExpandableCard } from '../src/renderer/components/arc/expandable-card/expandable-card'
import type * as MotionReact from 'motion/react'

vi.mock('motion/react', async (original) => ({
    ...(await original<typeof MotionReact>()),
    useReducedMotion: () => true
}))

// Exercise Motion's JavaScript fallback: happy-dom's incomplete WAAPI rejects canceled animations.
const nativeAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
beforeAll(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
})
afterEach(cleanup)
afterAll(() => {
    if (nativeAnimate) Object.defineProperty(Element.prototype, 'animate', nativeAnimate)
})

it('defers fields for 24 closed repository cards and retains edits after collapse and reopen', async () => {
    const user = userEvent.setup()
    const fields = vi.fn(() =>
        createElement('input', { 'aria-label': 'Author email', defaultValue: 'author@example.com' })
    )
    render(
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
    expect(fields).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Author email' })).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: /Repository 0\b/ })
    await user.click(trigger)
    const input = await screen.findByRole('textbox', { name: 'Author email' })
    await user.clear(input)
    await user.type(input, 'edited@example.com')
    await user.click(trigger)
    await user.click(trigger)
    expect(screen.getByRole('textbox', { name: 'Author email' })).toHaveValue('edited@example.com')
})
