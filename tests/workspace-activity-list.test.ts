// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { WorkspaceActivityList } from '../src/renderer/WorkspaceActivityList'
import type * as MotionReact from 'motion/react'

vi.mock('motion/react', async (original) => ({
    ...(await original<typeof MotionReact>()),
    useReducedMotion: () => true
}))

it.each([true, false])(
    'retains the empty-state action after extracting the memoized list (has activity: %s)',
    async (hasActivity) => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
        const host = document.createElement('div')
        document.body.append(host)
        const root = createRoot(host)
        const onEmptyAction = vi.fn()
        try {
            await act(async () => {
                root.render(
                    createElement(WorkspaceActivityList, {
                        activities: [],
                        dayFilter: { day: 'all', setDay: vi.fn(), expanded: new Set<string>(), toggle: vi.fn() },
                        repositories: [],
                        timezone: 'UTC',
                        canCite: false,
                        onInspect: vi.fn(),
                        onEmptyAction,
                        hasActivity
                    })
                )
                await Promise.resolve()
            })
            const label = hasActivity ? 'Clear activity filters' : 'Refresh activity'
            const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label)!
            expect(button).toBeDefined()
            button.click()
            expect(onEmptyAction).toHaveBeenCalledTimes(1)
        } finally {
            await act(async () => {
                root.unmount()
                await Promise.resolve()
            })
            host.remove()
        }
    }
)
