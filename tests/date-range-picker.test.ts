// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { DateRangePicker } from '../src/renderer/components/arc/date-range-picker/date-range-picker'

// Exercise Motion's JavaScript fallback; happy-dom rejects canceled native animations.
const nativeAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
beforeAll(() => {
    Reflect.deleteProperty(Element.prototype, 'animate')
})
afterAll(() => {
    if (nativeAnimate) Object.defineProperty(Element.prototype, 'animate', nativeAnimate)
})

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
    for (const dispose of cleanup.splice(0)) await dispose()
    vi.unstubAllGlobals()
})

async function update(task: () => unknown) {
    await act(async () => {
        await task()
    })
}

async function picker() {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', undefined)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    cleanup.push(async () => {
        await update(() => root.unmount())
        host.remove()
    })
    const onChange = vi.fn()
    await update(() => {
        root.render(
            createElement(DateRangePicker, {
                defaultValue: { start: new Date(2026, 9, 5), end: new Date(2026, 9, 11) },
                months: 1,
                fixedRangeDays: 7,
                weekStartsOn: 1,
                normalizeStart: (day: Date) =>
                    new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7)),
                onChange
            })
        )
    })
    await update(() => host.querySelector<HTMLButtonElement>('button')!.click())
    return { host, onChange }
}

it('keeps a single current calendar and the focused date through rapid keyboard month reversals', async () => {
    const { host } = await picker()
    for (const [key, expected] of [
        ['PageDown', '2026-11-05'],
        ['PageDown', '2026-12-05'],
        ['PageUp', '2026-11-05'],
        ['PageUp', '2026-10-05']
    ]) {
        await update(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
        expect(host.querySelectorAll('[role="grid"]')).toHaveLength(1)
        expect(document.activeElement?.getAttribute('data-date')).toBe(expected)
        expect(host.querySelectorAll('[data-current]')).toHaveLength(1)
    }
})

it('shows exactly the selected week and matching endpoints immediately after successive picks', async () => {
    const { host, onChange } = await picker()
    for (const [date, start, end] of [
        ['2026-10-14', '2026-10-12', '2026-10-18'],
        ['2026-10-07', '2026-10-05', '2026-10-11']
    ]) {
        await update(() => host.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!.click())
        const selected = [...host.querySelectorAll('[role="gridcell"][aria-selected="true"] button')]
        expect(selected).toHaveLength(7)
        expect(selected[0].getAttribute('data-date')).toBe(start)
        expect(selected[6].getAttribute('data-date')).toBe(end)
        expect([...host.querySelectorAll('[data-edge]')].map((node) => node.getAttribute('data-date'))).toEqual([
            start,
            end
        ])
    }
    await update(() =>
        [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === 'Apply')!.click()
    )
    expect(onChange).toHaveBeenCalledWith({ start: new Date(2026, 9, 5), end: new Date(2026, 9, 11) })
})
