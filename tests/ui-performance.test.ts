import { expect, it, vi } from 'vitest'
import { initialState, localDate } from '../src/shared/model'
import type { Reply } from '../src/shared/model'
import { sampleState } from '../src/renderer/workspace-sample'
import { hasCachedDetails, unchangedStateReply } from '../src/renderer/activity-cache'
import { formatDay } from '../src/renderer/workspace-model'

it('reuses a date formatter across activity search entries while retaining per-call options', () => {
    const constructor = vi.spyOn(Intl, 'DateTimeFormat')
    try {
        const options = { month: 'long', day: '2-digit', year: 'numeric' } as const
        for (let index = 0; index < 600; index++) expect(formatDay('2026-10-16', options)).toBe('October 16, 2026')
        expect(constructor).toHaveBeenCalledTimes(1)
        expect(formatDay('2026-10-16', { weekday: 'long' })).toBe('Friday')
        expect(constructor).toHaveBeenCalledTimes(2)
    } finally {
        constructor.mockRestore()
    }
})

it('reuses formatters while preserving timezone and daylight-saving date boundaries', () => {
    const constructor = vi.spyOn(Intl, 'DateTimeFormat')
    try {
        expect(localDate(new Date('2026-03-08T06:30:00Z'), 'America/Detroit')).toBe('2026-03-08')
        expect(localDate(new Date('2026-03-08T07:30:00Z'), 'America/Detroit')).toBe('2026-03-08')
        expect(localDate(new Date('2026-03-08T04:30:00Z'), 'America/Detroit')).toBe('2026-03-07')
        expect(localDate(new Date('2026-03-08T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-03-09')
        expect(constructor).toHaveBeenCalledTimes(2)
    } finally {
        constructor.mockRestore()
    }
})

it('skips equal-version state polls but accepts account changes, new snapshots and restores', () => {
    const current: Reply = {
        state: { ...initialState(), snapshotVersion: 2, restoreId: 'one' },
        connections: { github: false, notion: false, protectedStorage: true }
    }
    const equal = structuredClone(current)
    expect(unchangedStateReply(current, equal, { type: 'state' })).toBe(true)
    expect(
        unchangedStateReply(
            current,
            { ...equal, connections: { ...equal.connections, github: true } },
            { type: 'state' }
        )
    ).toBe(false)
    expect(
        unchangedStateReply(current, { ...equal, state: { ...equal.state, snapshotVersion: 3 } }, { type: 'state' })
    ).toBe(false)
    expect(
        unchangedStateReply(current, { ...equal, state: { ...equal.state, restoreId: 'two' } }, { type: 'state' })
    ).toBe(false)
    expect(unchangedStateReply(undefined, equal, { type: 'state' })).toBe(false)
})

it('does not discard detail payloads or trust unversioned state as unchanged', () => {
    const state = initialState()
    const current: Reply = { state, connections: { github: false, notion: false, protectedStorage: true } }
    expect(unchangedStateReply(current, structuredClone(current), { type: 'state' })).toBe(false)
    state.snapshotVersion = 1
    expect(unchangedStateReply(current, { ...current, diff: 'new patch' }, { type: 'details', activityId: 'pr' })).toBe(
        false
    )
})

it('only skips detail loading for matching PR revisions or explicitly loaded metadata', () => {
    const state = sampleState('2026-10-05')
    const activity = state.activities.find((item) => item.kind === 'pr')!
    state.diffs[activity.id] = 'cached patch'
    activity.revision = 'new'
    activity.diffRevision = 'old'
    expect(hasCachedDetails(state, activity)).toBe(false)
    activity.diffRevision = 'new'
    expect(hasCachedDetails(state, activity)).toBe(true)
    activity.filesLoaded = false
    expect(hasCachedDetails(state, activity, 'files')).toBe(false)
    activity.filesLoaded = true
    expect(hasCachedDetails(state, activity, 'files')).toBe(true)
    state.diffs = {}
    expect(hasCachedDetails(state, activity)).toBe(false)
})
