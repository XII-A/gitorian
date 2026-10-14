import { describe, expect, it, vi } from 'vitest'

import { hasCachedDetails, unchangedStateReply } from '../src/renderer/activity-cache'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Reply } from '../src/shared/model'
import { initialState, localDate } from '../src/shared/model'
import { required } from '../src/shared/required'

describe('ui-performance', () => {
    it('reuses formatters while preserving timezone and daylight-saving date boundaries', () => {
        const constructor = vi.spyOn(Intl, 'DateTimeFormat')
        try {
            expect([
                Object.is(localDate(new Date('2026-03-08T06:30:00Z'), 'America/Detroit'), '2026-03-08'),
                Object.is(localDate(new Date('2026-03-08T07:30:00Z'), 'America/Detroit'), '2026-03-08'),
                Object.is(localDate(new Date('2026-03-08T04:30:00Z'), 'America/Detroit'), '2026-03-07'),
                Object.is(localDate(new Date('2026-03-08T23:30:00Z'), 'Asia/Tokyo'), '2026-03-09'),
                constructor.mock.calls.length
            ]).toStrictEqual([true, true, true, true, 2])
        } finally {
            constructor.mockRestore()
        }
    })

    it('skips equal-version state polls but accepts account changes, new snapshots and restores', () => {
        const current: Reply = {
            connections: { github: false, notion: false, protectedStorage: true },
            state: { ...initialState(), restoreId: 'one', snapshotVersion: 2 }
        }
        const equal = structuredClone(current)
        expect([
            Boolean(unchangedStateReply(current, equal, { type: 'state' })),
            Boolean(
                unchangedStateReply(
                    current,
                    { ...equal, connections: { ...equal.connections, github: true } },
                    { type: 'state' }
                )
            ),
            Boolean(
                unchangedStateReply(
                    current,
                    { ...equal, state: { ...equal.state, snapshotVersion: 3 } },
                    { type: 'state' }
                )
            ),
            Boolean(
                unchangedStateReply(
                    current,
                    { ...equal, state: { ...equal.state, restoreId: 'two' } },
                    { type: 'state' }
                )
            ),
            Boolean(unchangedStateReply(undefined, equal, { type: 'state' }))
        ]).toStrictEqual([true, false, false, false, false])
    })

    it('does not discard detail payloads or trust unversioned state as unchanged', () => {
        const state = initialState()
        const current: Reply = { connections: { github: false, notion: false, protectedStorage: true }, state }
        expect(unchangedStateReply(current, structuredClone(current), { type: 'state' })).toBeFalsy()
        state.snapshotVersion = 1
        expect(
            unchangedStateReply(current, { ...current, diff: 'new patch' }, { activityId: 'pr', type: 'details' })
        ).toBeFalsy()
    })

    it('only skips detail loading for matching PR revisions or explicitly loaded metadata', () => {
        const state = sampleState('2026-10-05')
        const activity = required(state.activities.find((item) => item.kind === 'pr'))
        state.diffs[activity.id] = 'cached patch'
        activity.revision = 'new'
        activity.diffRevision = 'old'
        expect(hasCachedDetails(state, activity)).toBeFalsy()
        activity.diffRevision = 'new'
        expect(hasCachedDetails(state, activity)).toBeTruthy()
        activity.filesLoaded = false
        expect(hasCachedDetails(state, activity, 'files')).toBeFalsy()
        activity.filesLoaded = true
        expect(hasCachedDetails(state, activity, 'files')).toBeTruthy()
        state.diffs = {}
        expect(hasCachedDetails(state, activity)).toBeFalsy()
    })
})
