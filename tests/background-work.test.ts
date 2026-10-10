import { expect, it } from 'vitest'
import { sampleState } from '../src/renderer/workspace-sample'
import { actionableSources, activityUpdating, sourceProblems } from '../src/renderer/background-work'

it('keeps voluntary pauses actionable without reporting them as problems or ongoing work', () => {
    const state = sampleState('2026-10-05')
    const repo = state.repositories[0]
    state.acquisition = {
        [`git:${repo.id}`]: { status: 'cancelled', error: 'Paused by you', windowEnd: '2026-10-10' },
        notion: { status: 'idle' }
    }
    expect(actionableSources(state).map(([key]) => key)).toEqual([`git:${repo.id}`])
    expect(sourceProblems(state)).toHaveLength(0)
    expect(activityUpdating(state)).toBe(false)
})

it('includes queued and failed sources but omits healthy and removed sources', () => {
    const state = sampleState('2026-10-05')
    const repo = state.repositories[0]
    state.acquisition = {
        [`git:${repo.id}`]: { status: 'idle', windowEnd: '2026-10-10' },
        [`github:${repo.id}`]: { status: 'error', error: 'HTTP 401' },
        notion: { status: 'idle' },
        'git:removed': { status: 'running' }
    }
    expect(actionableSources(state)).toHaveLength(2)
    expect(sourceProblems(state)).toHaveLength(1)
    expect(activityUpdating(state)).toBe(true)
    state.acquisition[`git:${repo.id}`].status = 'paused'
    state.acquisition[`git:${repo.id}`].retryAt = '2026-10-11T00:00:00Z'
    expect(activityUpdating(state)).toBe(false)
})
