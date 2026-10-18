// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ActivityHover } from '../src/renderer/ActivityHover'
import type * as MotionReact from 'motion/react'

vi.mock('motion/react', async (original) => ({
    ...(await original<typeof MotionReact>()),
    useReducedMotion: () => true
}))

it('reads connector styles only for visible rows, skips unchanged renders, and refreshes paths on scroll', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement
    ) {
        const scroll = host.querySelector<HTMLElement>('[role="region"]')?.scrollTop ?? 0
        if (this.getAttribute('role') === 'region') return new DOMRect(0, 0, 200, 80)
        const row = this.closest<HTMLElement>('.activity-row')
        if (row)
            return new DOMRect(
                0,
                Number(row.dataset.index) * 40 - scroll,
                this.classList.contains('activity-row') ? 200 : 14,
                this.classList.contains('activity-row') ? 40 : 14
            )
        return new DOMRect(0, -scroll, 200, 400)
    })
    const styles = vi.spyOn(window, 'getComputedStyle')
    const rowsRead = () =>
        styles.mock.calls
            .filter(([element, pseudo]) => element.classList.contains('activity-row') && !!pseudo)
            .map(([element]) => Number((element as HTMLElement).dataset.index))
    const render = () =>
        createElement(
            'div',
            { role: 'region' },
            createElement(
                ActivityHover,
                null,
                createElement(
                    'ul',
                    { className: 'activity-row-list' },
                    ...Array.from({ length: 10 }, (_, index) =>
                        createElement(
                            'li',
                            { key: index },
                            createElement(
                                'button',
                                { className: 'activity-row', 'data-index': index },
                                createElement('span', { className: 'activity-row-node' }),
                                `Activity ${index}`
                            )
                        )
                    )
                )
            )
        )
    try {
        await act(async () => {
            root.render(render())
            await new Promise((resolve) => setTimeout(resolve, 40))
        })
        expect(rowsRead().length).toBeGreaterThan(0)
        expect(rowsRead().every((index) => index <= 2)).toBe(true)
        styles.mockClear()
        await act(async () => {
            root.render(render())
            await new Promise((resolve) => setTimeout(resolve, 40))
        })
        expect(rowsRead()).toEqual([])
        const viewport = host.querySelector<HTMLElement>('[role="region"]')!
        await act(async () => {
            viewport.scrollTop = 160
            viewport.dispatchEvent(new Event('scroll'))
            await new Promise((resolve) => setTimeout(resolve, 40))
        })
        expect(rowsRead().some((index) => index >= 4)).toBe(true)
        expect(rowsRead()).not.toContain(0)
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        styles.mockRestore()
        bounds.mockRestore()
        host.remove()
    }
})
