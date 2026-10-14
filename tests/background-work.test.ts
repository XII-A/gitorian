import { describe, expect, it } from 'vitest'

import { actionableSources, activityUpdating, sourceProblems } from '../src/renderer/background-work'
import { sampleState } from '../src/renderer/workspace-sample'

describe('background-work', () => {
    it('keeps voluntary pauses actionable without reporting them as problems or ongoing work', () => {
        const state = sampleState('2026-10-05')
        const [repo] = state.repositories
        state.acquisition = {
            [`git:${repo.id}`]: { error: 'Paused by you', status: 'cancelled', windowEnd: '2026-10-10' },
            notion: { status: 'idle' }
        }
        expect([
            actionableSources(state).map(([key]) => key),
            sourceProblems(state)?.length,
            Boolean(activityUpdating(state))
        ]).toStrictEqual([[`git:${repo.id}`], 0, false])
    })

    it('includes queued and failed sources but omits healthy and removed sources', () => {
        const state = sampleState('2026-10-05')
        const [repo] = state.repositories
        state.acquisition = {
            [`git:${repo.id}`]: { status: 'idle', windowEnd: '2026-10-10' },
            [`github:${repo.id}`]: { error: 'HTTP 401', status: 'error' },
            notion: { status: 'idle' },
            'git:removed': { status: 'running' }
        }
        expect([
            actionableSources(state)?.length,
            sourceProblems(state)?.length,
            Boolean(activityUpdating(state))
        ]).toStrictEqual([2, 1, true])
        state.acquisition[`git:${repo.id}`].status = 'paused'
        state.acquisition[`git:${repo.id}`].retryAt = '2026-10-11T00:00:00Z'
        expect(activityUpdating(state)).toBeFalsy()
    })
})
