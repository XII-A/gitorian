// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useWeekHistory } from '../src/renderer/use-week-history'
import { sampleState } from '../src/renderer/workspace-sample'
import { gitConfiguration } from '../src/shared/activity-history'
import type { State } from '../src/shared/model'

it('scopes the button to unfinished sources needed for the selected week across four repositories', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    const root = createRoot(host)
    const run = vi.fn(() => Promise.resolve(undefined))
    const state = sampleState('2026-10-05')
    state.settings.githubLogin = ''
    state.repositories = Array.from({ length: 4 }, (_, index) => ({ ...state.repositories[0], id: `repo-${index}` }))
    state.acquisition = {}
    for (const repository of state.repositories) {
        state.acquisition[`git:${repository.id}`] = {
            status: 'idle',
            historySince: '2026-10-05',
            configuration: gitConfiguration(repository, state)
        }
    }
    let loading = false
    function Harness({ value, since }: { value: State; since: string }) {
        loading = useWeekHistory(value, run, since)
        return null
    }
    const render = (since = '2026-10-05') =>
        act(async () => {
            root.render(createElement(Harness, { value: state, since }))
            await Promise.resolve()
        })
    try {
        // Three repositories have finished; the last is still acquiring this week.
        state.acquisition['git:repo-3'] = { status: 'running' }
        await render()
        expect(loading).toBe(true)
        // Its results cover this week even though more background work is running.
        state.acquisition['git:repo-3'] = {
            status: 'running',
            historySince: '2026-10-05',
            configuration: gitConfiguration(state.repositories[3], state)
        }
        await render()
        expect(loading).toBe(false)
        // A failed missing source and an unrelated active source must not combine
        // into a perpetual week-loading indicator.
        state.acquisition['git:repo-3'] = { status: 'error', error: 'Unavailable' }
        state.acquisition['git:repo-0'].status = 'running'
        await render()
        expect(loading).toBe(false)
        state.acquisition.notion = { status: 'running' }
        await render()
        expect(loading).toBe(false)
        state.acquisition['git:repo-3'] = { status: 'idle', windowEnd: '2026-10-19' }
        await render()
        expect(loading).toBe(true)
        // Navigation to a covered week releases the previous week's indicator.
        state.acquisition['git:repo-3'].historySince = '2026-10-12'
        state.acquisition['git:repo-3'].configuration = gitConfiguration(state.repositories[3], state)
        await render('2026-10-12')
        expect(loading).toBe(false)
        for (const status of ['error', 'paused', 'cancelled', 'idle'] as const) {
            state.acquisition['git:repo-3'] = { status }
            await render()
            expect(loading).toBe(false)
        }
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
    }
})
