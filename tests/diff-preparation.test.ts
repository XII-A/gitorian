import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialState, type Command } from '../src/shared/model'
import { state as fixture } from './diff-viewer-fixture'
import { journal } from './fixtures'
import { run } from './effect-fixtures'

async function observeDetails() {
    const app = await journal()
    const commands: Command[] = []
    const read = (command: Command) => {
        commands.push(command)
        return run(app.service.handle(command))
    }
    return { commands, read, close: app.close }
}

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
        const { commands, read, close } = await observeDetails()
        try {
            scheduleDiffPreparation(state, activity, read, true)
            await vi.advanceTimersByTimeAsync(120)
            expect(commands).toEqual([
                {
                    type: 'details',
                    activityId: activity.id,
                    content: 'diff',
                    cachedOnly: false
                }
            ])
        } finally {
            await close()
        }
    }
)

it('cancels abandoned intent and limits speculative reads to local evidence', async () => {
    const { scheduleDiffPreparation } = await import('../src/renderer/diff-preparation')
    const state = initialState()
    const activity = fixture.activities[0]
    const { commands, read, close } = await observeDetails()
    try {
        const cancel = scheduleDiffPreparation(state, activity, read)
        cancel()
        await vi.advanceTimersByTimeAsync(200)
        expect(commands).toEqual([])
        scheduleDiffPreparation(state, activity, read)
        await vi.advanceTimersByTimeAsync(100)
        expect(commands).toEqual([{ type: 'details', activityId: activity.id, content: 'diff', cachedOnly: true }])
    } finally {
        await close()
    }
})
