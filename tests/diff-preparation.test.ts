import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialState } from '../src/shared/model'
import { state as fixture } from './e2e/support/diff-viewer-fixture'

vi.mock('../src/renderer/code-highlighting', () => ({
    codeLimits: { patch: 2_000_000 },
    loadCodeHighlighting: () => Promise.resolve({ status: 'ready' })
}))
vi.mock('../src/renderer/diff-loader', () => ({ loadDiff: vi.fn(() => Promise.resolve([])) }))
beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it.each([
    { revision: undefined, diffRevision: undefined, patch: fixture.diffs['diff-fixture'] },
    { revision: 'next', diffRevision: 'previous', patch: fixture.diffs['diff-fixture'] },
    { revision: 'same', diffRevision: 'same', patch: 'diff --cc file.ts\ncombined changes' }
])(
    'prepares invalid cached evidence through the normal revision-safe read: $revision / $diffRevision',
    async ({ revision, diffRevision, patch }) => {
        const { scheduleDiffPreparation } = await import('../src/renderer/diff-preparation')
        const state = initialState()
        const activity = { ...fixture.activities[0], revision, diffRevision }
        state.diffs[activity.id] = patch
        const read = vi.fn(() => Promise.resolve(undefined))
        scheduleDiffPreparation(state, activity, read, true)
        await vi.advanceTimersByTimeAsync(120)
        expect(read).toHaveBeenCalledWith({
            type: 'details',
            activityId: activity.id,
            content: 'diff',
            cachedOnly: false
        })
    }
)

it('cancels abandoned intent and limits speculative reads to local evidence', async () => {
    const { scheduleDiffPreparation } = await import('../src/renderer/diff-preparation')
    const state = initialState()
    const activity = fixture.activities[0]
    const read = vi.fn(() => Promise.resolve(undefined))
    const cancel = scheduleDiffPreparation(state, activity, read)
    cancel()
    await vi.advanceTimersByTimeAsync(200)
    expect(read).not.toHaveBeenCalled()
    scheduleDiffPreparation(state, activity, read)
    await vi.advanceTimersByTimeAsync(100)
    expect(read).toHaveBeenCalledWith({ type: 'details', activityId: activity.id, content: 'diff', cachedOnly: true })
})
