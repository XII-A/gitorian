// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ToastStack, ToastStackProvider } from '../src/renderer/components/arc/toast-stack/toast-stack'
import { useActivityRefresh } from '../src/renderer/use-activity-refresh'
import { useWeekHistory } from '../src/renderer/use-week-history'
import { AcquisitionStatus } from '../src/renderer/AcquisitionStatus'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Reply, State } from '../src/shared/model'
import { gitConfiguration } from '../src/shared/activity-history'

// Happy DOM's partial WAAPI rejects cancelled animations. Use Motion's JS path.
Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true })

it('renders the real empty-result toast after the refresh button completes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const state = sampleState('2026-10-05')
    state.activities = []
    state.acquisition = {}
    let finish!: (value: Reply) => void
    const run = vi.fn(
        () =>
            new Promise<Reply>((resolve) => {
                finish = resolve
            })
    )
    function Harness() {
        const { refresh, refreshing } = useActivityRefresh(run, '2026-10-05', '2026-10-11')
        return createElement('button', { onClick: refresh, 'aria-busy': refreshing }, 'Refresh activity')
    }
    try {
        await act(async () => {
            await Promise.resolve()
            root.render(createElement(ToastStackProvider, null, createElement(Harness), createElement(ToastStack)))
        })
        expect(host.textContent).not.toContain('No activity found')
        expect(host.querySelector('button')?.getAttribute('aria-busy')).toBe('false')
        await act(async () => {
            host.querySelector('button')!.click()
            await Promise.resolve()
        })
        expect(host.querySelector('button')?.getAttribute('aria-busy')).toBe('true')
        await act(async () => {
            await Promise.resolve()
            host.querySelector('button')!.click()
        })
        expect(host.textContent).not.toContain('No activity found')
        expect(run).toHaveBeenCalledExactlyOnceWith({ type: 'refresh', since: '2026-10-05' })
        await act(async () => {
            await Promise.resolve()
            finish({ state, connections: { github: false, notion: false, protectedStorage: false } })
            await new Promise((resolve) => setTimeout(resolve, 50))
        })
        expect(host.textContent).toContain('No activity found')
        expect(host.textContent).toContain('2026-10-05 to 2026-10-11')
        expect(host.querySelector('[aria-live="polite"]')).not.toBeNull()
        expect(host.querySelector('button')?.getAttribute('aria-busy')).toBe('false')
    } finally {
        await act(async () => {
            await Promise.resolve()
            root.unmount()
        })
        host.remove()
    }
})

it('loads missing weeks silently, keeps cached weeks immediate and does not reload on polling', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    const root = createRoot(host)
    const run = vi.fn(() => Promise.resolve(undefined))
    const state = sampleState('2026-10-05')
    state.settings.githubLogin = ''
    state.acquisition = {}
    for (const repository of state.repositories)
        state.acquisition[`git:${repository.id}`] = {
            status: 'idle',
            historySince: '2026-10-05',
            historyTimezone: state.settings.timezone,
            configuration: gitConfiguration(repository, state)
        }
    function Harness({ value, since }: { value: State; since: string }) {
        useWeekHistory(value, run, since)
        return null
    }
    const render = (value: State, since: string) =>
        act(async () => {
            await Promise.resolve()
            root.render(createElement(Harness, { value, since }))
        })
    try {
        await render(state, '2026-10-05')
        expect(run).not.toHaveBeenCalled()
        await render(state, '2026-09-28')
        expect(run).toHaveBeenCalledExactlyOnceWith({ type: 'loadWeek', since: '2026-09-28' })
        await render({ ...state, snapshotVersion: 2 }, '2026-09-28')
        expect(run).toHaveBeenCalledTimes(1)
    } finally {
        await act(async () => {
            await Promise.resolve()
            root.unmount()
        })
    }
})

it('shows only source failures and closes the dialog when they clear', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const state = sampleState('2026-10-05')
    const repository = state.repositories[0]
    state.acquisition = {
        [`git:${repository.id}`]: { status: 'running' },
        [`github:${repository.id}`]: { status: 'error', error: 'HTTP 401' },
        [`git:${state.repositories[1].id}`]: { status: 'cancelled', error: 'Paused by you', windowEnd: '2026-10-10' },
        'git:removed': { status: 'error', error: 'Removed repository' }
    }
    const onOpenChange = vi.fn()
    const onSettings = vi.fn()
    const run = vi.fn()
    const render = () =>
        act(async () => {
            await Promise.resolve()
            root.render(createElement(AcquisitionStatus, { state, run, open: true, onOpenChange, onSettings }))
        })
    try {
        await render()
        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.textContent).toContain('GitHub')
        expect(dialog.textContent).not.toContain('Local Git')
        expect(dialog.textContent).not.toContain('Pause')
        expect(dialog.textContent).not.toContain('Refreshing')
        expect(dialog.textContent).not.toContain('Paused by you')
        expect(dialog.textContent).not.toContain('Removed repository')
        const settings = [...dialog.querySelectorAll('button')].find(
            (button) => button.textContent === 'Open settings'
        )!
        await act(async () => {
            await Promise.resolve()
            settings.click()
        })
        expect(onSettings).toHaveBeenCalledTimes(1)
        state.acquisition[`github:${repository.id}`] = { status: 'idle' }
        await render()
        expect(onOpenChange).toHaveBeenCalledWith(false)
    } finally {
        await act(async () => {
            await Promise.resolve()
            root.unmount()
        })
        host.remove()
    }
})
