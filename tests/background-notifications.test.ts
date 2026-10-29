// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { sampleState } from '../src/renderer/workspace-sample'
import { BackgroundNotifications } from '../src/renderer/BackgroundNotifications'

const notifications = vi.hoisted(() => ({
    toast: vi.fn<(options: unknown) => string>(() => 'import-toast'),
    update: vi.fn(),
    dismiss: vi.fn()
}))
vi.mock('../src/renderer/components/arc/toast-stack/toast-stack', () => ({ useToastStack: () => notifications }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.clearAllMocks()
    localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})
afterEach(async () => {
    await act(async () => {
        await Promise.resolve()
        root.unmount()
    })
    container.remove()
})

it('shows import progress only after leaving Settings and updates it into one acknowledged result', async () => {
    const state = sampleState('2026-10-05')
    state.repositoryImport = { id: 'job-1', status: 'running', completed: 2, total: 5 }
    const render = async (settingsOpen: boolean) => {
        await act(async () => {
            await Promise.resolve()
            root.render(
                createElement(BackgroundNotifications, { state, settingsOpen, run: vi.fn(), onSources: vi.fn() })
            )
        })
    }
    await render(false)
    expect(notifications.toast).not.toHaveBeenCalled()
    await render(true)
    expect(notifications.toast).not.toHaveBeenCalled()
    await render(false)
    expect(notifications.toast).toHaveBeenCalledTimes(1)
    expect(notifications.toast.mock.calls[0]?.[0]).toMatchObject({
        type: 'loading',
        title: 'Importing repositories: 2 of 5'
    })
    state.repositoryImport = {
        id: 'job-1',
        status: 'done',
        completed: 5,
        total: 5,
        skipped: 1,
        message: 'Added 4 repositories. 1 folder skipped.'
    }
    await render(false)
    expect(notifications.update).toHaveBeenCalledWith(
        'import-toast',
        expect.objectContaining({ type: 'warning', action: expect.objectContaining({ label: 'View results' }) })
    )
    expect(localStorage.getItem('journal:last-import-notification')).toBe('job-1')
    await act(async () => {
        await Promise.resolve()
        root.unmount()
    })
    root = createRoot(container)
    await render(false)
    expect(notifications.toast).toHaveBeenCalledTimes(1)
})

it('does not repeat source warnings on polling or count user-paused sources', async () => {
    const state = sampleState('2026-10-05')
    const repo = state.repositories[0]
    state.acquisition = {
        [`git:${repo.id}`]: { status: 'cancelled', error: 'Paused by you' },
        [`remote:${repo.id}`]: { status: 'error', error: 'HTTP 401' }
    }
    const render = async () => {
        await act(async () => {
            await Promise.resolve()
            root.render(
                createElement(BackgroundNotifications, {
                    state: structuredClone(state),
                    settingsOpen: false,
                    run: vi.fn(),
                    onSources: vi.fn()
                })
            )
        })
    }
    await render()
    await render()
    expect(notifications.toast).toHaveBeenCalledTimes(1)
    expect(notifications.toast.mock.calls[0]?.[0]).toMatchObject({ title: '1 source failed to refresh' })
})
