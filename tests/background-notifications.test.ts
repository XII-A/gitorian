// @vitest-environment happy-dom
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackgroundNotifications } from '../src/renderer/background-notifications'
import { sampleState } from '../src/renderer/workspace-sample'

const notifications = vi.hoisted(() => ({
    dismiss: vi.fn<(...args: unknown[]) => void>(),
    toast: vi.fn<(options: unknown) => string>(() => 'import-toast'),
    update: vi.fn<(...args: unknown[]) => void>()
}))

vi.mock(import('../src/renderer/components/arc/toast-stack/toast-stack'), () => ({
    useToastStack: () => ({ ...notifications, count: 0 })
}))

describe('background-notifications', () => {
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
        state.repositoryImport = { completed: 2, id: 'job-1', status: 'running', total: 5 }
        const render = async (settingsOpen: boolean) => {
            await act(async () => {
                await Promise.resolve()
                root.render(
                    createElement(BackgroundNotifications, {
                        onSources: vi.fn<(...args: unknown[]) => void>(),
                        run: vi.fn<(...args: unknown[]) => Promise<undefined>>(),
                        settingsOpen,
                        state
                    })
                )
            })
        }
        await render(false)
        expect(notifications.toast).not.toHaveBeenCalled()
        await render(true)
        expect(notifications.toast).not.toHaveBeenCalled()
        await render(false)
        expect([notifications.toast.mock.calls.length, notifications.toast.mock.calls[0]?.[0]]).toStrictEqual([
            1,
            expect.objectContaining({
                title: 'Importing repositories: 2 of 5',
                type: 'loading'
            })
        ])
        state.repositoryImport = {
            completed: 5,
            id: 'job-1',
            message: 'Added 4 repositories. 1 folder skipped.',
            skipped: 1,
            status: 'done',
            total: 5
        }
        await render(false)
        expect(notifications.update).toHaveBeenCalledWith(
            'import-toast',
            expect.objectContaining({ action: expect.objectContaining({ label: 'View results' }), type: 'warning' })
        )
        expect(localStorage.getItem('journal:last-import-notification')).toBe('job-1')
        await act(async () => {
            await Promise.resolve()
            root.unmount()
        })
        root = createRoot(container)
        await render(false)
        expect(notifications.toast).toHaveBeenCalledOnce()
    })

    it('does not repeat source warnings on polling or count user-paused sources', async () => {
        const state = sampleState('2026-10-05')
        const [repo] = state.repositories
        state.acquisition = {
            [`git:${repo.id}`]: { error: 'Paused by you', status: 'cancelled' },
            [`github:${repo.id}`]: { error: 'HTTP 401', status: 'error' }
        }
        const render = async () => {
            await act(async () => {
                await Promise.resolve()
                root.render(
                    createElement(BackgroundNotifications, {
                        onSources: vi.fn<(...args: unknown[]) => void>(),
                        run: vi.fn<(...args: unknown[]) => Promise<undefined>>(),
                        settingsOpen: false,
                        state: structuredClone(state)
                    })
                )
            })
        }
        await render()
        await render()
        expect([notifications.toast.mock.calls.length, notifications.toast.mock.calls[0]?.[0]]).toStrictEqual([
            1,
            expect.objectContaining({ title: '1 source failed to refresh' })
        ])
    })
})
