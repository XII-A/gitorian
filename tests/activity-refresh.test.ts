// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useActivityRefresh } from '../src/renderer/use-activity-refresh'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Command, Reply } from '../src/shared/model'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/components/arc/toast-stack/toast-stack', () => ({ useToastStack: () => ({ toast }) }))
let root: Root
let container: HTMLDivElement
let controls: ReturnType<typeof useActivityRefresh>
const state = () => {
    const value = sampleState('2026-10-05')
    value.activities = []
    value.acquisition = {}
    return value
}
const reply = (value = state()): Reply => ({
    state: value,
    connections: { github: true, notion: false, protectedStorage: false }
})
function Harness({ run, start }: { run: (command: Command) => Promise<Reply | undefined>; start: string }) {
    controls = useActivityRefresh(run, start, start === '2026-10-05' ? '2026-10-11' : '2026-10-18')
    return null
}
async function render(run: (command: Command) => Promise<Reply | undefined>, start = '2026-10-05') {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        root.render(createElement(Harness, { run, start }))
    })
}
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    toast.mockClear()
    container = document.createElement('div')
    root = createRoot(container)
})
afterEach(async () => {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        root.unmount()
    })
})

it('stays silent until a manual refresh finishes and coalesces repeated clicks', async () => {
    let finish!: (value: Reply) => void
    const run = vi.fn(
        () =>
            new Promise<Reply>((resolve) => {
                finish = resolve
            })
    )
    await render(run)
    expect(toast).not.toHaveBeenCalled()
    let pending!: Promise<void>
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        pending = controls.refresh()
    })
    expect(controls.refreshing).toBe(true)
    expect(toast).not.toHaveBeenCalled()
    await act(async () => controls.refresh())
    expect(run).toHaveBeenCalledExactlyOnceWith({ type: 'refresh', since: '2026-10-05' })
    await act(async () => {
        await Promise.resolve()
        finish(reply())
        await pending
    })
    expect(controls.refreshing).toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'info', title: 'No activity found' }))
})

it('does not announce an empty result when the selected week has activity', async () => {
    await render(() => Promise.resolve(reply(sampleState('2026-10-05'))))
    await act(async () => controls.refresh())
    expect(toast).not.toHaveBeenCalled()
})

it('shows an empty-result toast even when other weeks contain activity', async () => {
    await render(() => Promise.resolve(reply(sampleState('2026-10-12'))))
    await act(async () => controls.refresh())
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'No activity found' }))
})

it.each(['error', 'paused', 'cancelled', 'running', 'backlog'] as const)(
    'does not claim no activity when fetching is %s',
    async (status) => {
        const value = state()
        value.acquisition = {
            [`git:${value.repositories[0].id}`]: {
                status: status === 'backlog' ? 'idle' : status,
                windowEnd: status === 'backlog' ? '2026-10-18T00:00:00Z' : undefined
            }
        }
        await render(() => Promise.resolve(reply(value)))
        await act(async () => controls.refresh())
        expect(toast).not.toHaveBeenCalled()
    }
)

it('clears loading after a failed command without announcing an empty result', async () => {
    await render(() => Promise.resolve(undefined))
    await act(async () => controls.refresh())
    expect(controls.refreshing).toBe(false)
    expect(toast).not.toHaveBeenCalled()
})

it('does not show an empty-result toast for a week the user has left', async () => {
    let finish!: (value: Reply) => void
    const run = vi.fn(
        () =>
            new Promise<Reply>((resolve) => {
                finish = resolve
            })
    )
    await render(run)
    let pending!: Promise<void>
    await act(async () => {
        await Promise.resolve()
        pending = controls.refresh()
    })
    await render(run, '2026-10-12')
    expect(controls.refreshing).toBe(false)
    await act(async () => {
        await Promise.resolve()
        finish(reply())
        await pending
    })
    expect(toast).not.toHaveBeenCalled()
})

it('allows a refresh in the new week and does not let the old request clear its loading state', async () => {
    const finishes: ((value: Reply) => void)[] = []
    const run = vi.fn(
        () =>
            new Promise<Reply>((resolve) => {
                finishes.push(resolve)
            })
    )
    await render(run)
    let first!: Promise<void>
    await act(async () => {
        first = controls.refresh()
        await Promise.resolve()
    })
    await render(run, '2026-10-12')
    expect(controls.refreshing).toBe(false)
    let second!: Promise<void>
    await act(async () => {
        second = controls.refresh()
        await Promise.resolve()
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(controls.refreshing).toBe(true)
    await act(async () => {
        finishes[0](reply())
        await first
    })
    expect(controls.refreshing).toBe(true)
    expect(toast).not.toHaveBeenCalled()
    await act(async () => {
        finishes[1](reply())
        await second
    })
    expect(controls.refreshing).toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ description: expect.stringContaining('2026-10-12 to 2026-10-18') })
    )
})

it('does not revive an abandoned refresh or its toast when navigating back', async () => {
    let finish!: (value: Reply) => void
    const run = vi.fn(
        () =>
            new Promise<Reply>((resolve) => {
                finish = resolve
            })
    )
    await render(run)
    let pending!: Promise<void>
    await act(async () => {
        pending = controls.refresh()
        await Promise.resolve()
    })
    await render(run, '2026-10-12')
    await render(run)
    expect(controls.refreshing).toBe(false)
    await act(async () => {
        finish(reply())
        await pending
    })
    expect(toast).not.toHaveBeenCalled()
})
