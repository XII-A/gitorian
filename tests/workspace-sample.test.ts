import { describe, expect, it } from 'vitest'
import { createSampleJournal } from '../src/renderer/workspace-sample'

describe('workspace sample data', () => {
    it('keeps edits isolated and returns snapshots instead of mutable state', async () => {
        const sample = createSampleJournal()
        const other = createSampleJournal()
        const initial = await sample.invoke({ type: 'state' })
        const draft = initial.state.drafts[0]
        const originalTitle = draft.title
        await sample.invoke({ type: 'draft', draft: { ...draft, title: 'My sample edit' } })
        initial.state.drafts[0].title = 'Mutated snapshot'
        expect((await sample.invoke({ type: 'state' })).state.drafts[0].title).toBe('My sample edit')
        expect((await other.invoke({ type: 'state' })).state.drafts[0].title).toBe(originalTitle)
    })

    it('rejects publishing and external actions while allowing work selection', async () => {
        const sample = createSampleJournal()
        const { state } = await sample.invoke({ type: 'state' })
        const draft = state.drafts[0]
        const activity = state.activities.at(-1)!
        const reply = await sample.invoke({
            type: 'select',
            draftId: draft.id,
            activityId: activity.id,
            included: true
        })
        expect(reply.state.drafts[0].selections.some((item) => item.activityId === activity.id)).toBe(true)
        await sample.invoke({ type: 'draft', draft: { ...draft, title: 'Writing after choosing work' } })
        expect(
            (await sample.invoke({ type: 'state' })).state.drafts[0].selections.some(
                (item) => item.activityId === activity.id
            )
        ).toBe(true)
        const excluded = await sample.invoke({
            type: 'select',
            draftId: draft.id,
            activityId: activity.id,
            included: false
        })
        expect(excluded.state.drafts[0].selections.some((item) => item.activityId === activity.id)).toBe(false)
        await expect(sample.invoke({ type: 'publish', draftId: draft.id })).rejects.toThrow('real data')
        await expect(sample.invoke({ type: 'open', url: activity.url! })).rejects.toThrow('real data')
    })
})
