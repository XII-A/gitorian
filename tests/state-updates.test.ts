import { initialState } from '../src/shared/model'
import { hasCachedDetails, unchangedStateReply } from '../src/renderer/activity-cache'
import { expect, it } from 'vitest'
import { ReplyUpdates, expandReply, stateCursor } from '../src/shared/state-updates'
import { shareSnapshot } from '../src/shared/snapshot'
import { sampleState } from '../src/renderer/workspace-sample'
import type { Reply, State } from '../src/shared/model'

function reply(state = sampleState('2026-10-12')): Reply {
    return { state, connections: { remote: false, notion: false, protectedStorage: false } }
}

it('snapshots mutable state without retaining mutable objects and reuses unchanged large branch arrays', () => {
    const source = sampleState('2026-10-12')
    const first = shareSnapshot(undefined, source)
    expect(first).toEqual(source)
    expect(first).not.toBe(source)
    expect(first.activities[0].branches).not.toBe(source.activities[0].branches)
    source.activities[0].branches.push('new-branch')
    const next = shareSnapshot(first, source)
    expect(first.activities[0].branches).not.toContain('new-branch')
    expect(next.activities[1]).toBe(first.activities[1])
    expect(next.activities[0].branches).toContain('new-branch')
    source.activities.splice(0, 1)
    const removed = shareSnapshot(next, source)
    expect(removed.activities).toHaveLength(next.activities.length - 1)
})

it('copies dictionary keys literally without changing object prototypes', () => {
    const dictionary = JSON.parse('{"__proto__":{"flag":true},"constructor":"branch"}') as Record<string, unknown>
    const snapshot = shareSnapshot(undefined, dictionary)
    expect(Object.hasOwn(snapshot, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype)
    expect(snapshot.constructor).toBe('branch')
})

it('sends only changed records for a 13MB state and retains unchanged renderer trees', () => {
    const state = sampleState('2026-10-12')
    state.snapshotVersion = 1
    const branches = Array.from({ length: 76 }, (_, index) => `feature-${index}-${'x'.repeat(20)}`)
    state.activities = Array.from({ length: 4603 }, (_, index) => ({
        ...state.activities[0],
        id: `activity-${index}`,
        branches
    }))
    const server = new ReplyUpdates()
    const original = reply(shareSnapshot(undefined, state))
    const client = expandReply(structuredClone(server.pack(original)))
    state.snapshotVersion++
    state.acquisition = { source: { status: 'running' } }
    state.drafts[0].title = 'New title'
    const next = reply(shareSnapshot(original.state, state))
    const wire = server.pack(next, stateCursor(client.state))
    expect('state' in wire).toBe(false)
    expect(JSON.stringify(wire).length).toBeLessThan(10000)
    const expanded = expandReply(structuredClone(wire), client.state)
    expect(expanded).toEqual(next)
    expect(expanded.state.activities).toBe(client.state.activities)
    expect(expanded.state.drafts[0].title).toBe('New title')
})

it('applies additions, deletions, reordering, removed optional fields and changed connection/command details', () => {
    const state = sampleState('2026-10-12')
    state.snapshotVersion = 1
    state.refreshError = 'Old error'
    const cache = new ReplyUpdates()
    const old = reply(shareSnapshot(undefined, state))
    cache.pack(old)
    const retained = state.activities[1]
    state.activities = [{ ...state.activities[0], id: 'new' }, retained]
    state.activities.reverse()
    state.snapshotVersion++
    delete state.refreshError
    const next = {
        ...reply(shareSnapshot(old.state, state)),
        diff: 'details',
        message: 'Saved',
        connections: { ...old.connections, remote: true }
    }
    const packed = cache.pack(next, stateCursor(old.state))
    expect(expandReply(structuredClone(packed), old.state)).toEqual(next)
    expect(old.state.refreshError).toBe('Old error')
})

it('uses full snapshots after a restore or expired baseline and rejects applying a delta to a different revision', () => {
    const cache = new ReplyUpdates()
    const first = reply({ ...sampleState('2026-10-12'), snapshotVersion: 1 })
    cache.pack(first)
    const next = reply({ ...first.state, snapshotVersion: 2 })
    const patch = cache.pack(next, stateCursor(first.state))
    expect(() => expandReply(patch, next.state)).toThrow('baseline mismatch')
    for (let version = 3; version < 13; version++) cache.pack(reply({ ...first.state, snapshotVersion: version }))
    expect('state' in cache.pack(next, stateCursor(first.state))).toBe(true)
    const restored = reply({ ...first.state, snapshotVersion: 1, restoreId: 'restored' })
    expect('state' in cache.pack(restored, stateCursor(first.state))).toBe(true)
})

it('expands concurrent responses against their own captured baseline without losing later updates', () => {
    const cache = new ReplyUpdates()
    const base = reply({ ...sampleState('2026-10-12'), snapshotVersion: 1 })
    cache.pack(base)
    const secondState = shareSnapshot(base.state, { ...base.state, snapshotVersion: 2, refreshError: 'New error' })
    const second = cache.pack(reply(secondState), stateCursor(base.state))
    const thirdState: State = { ...secondState, snapshotVersion: 3, lastRefreshed: '2026-10-16T12:00:00Z' }
    const third = cache.pack(reply(thirdState), stateCursor(base.state))
    expect(expandReply(second, base.state).state).toEqual(secondState)
    expect(expandReply(third, base.state).state).toEqual(thirdState)
})

it('falls back to complete snapshots if a caller supplies different content under the same version', () => {
    const cache = new ReplyUpdates()
    const first = reply({ ...sampleState('2026-10-12'), snapshotVersion: 1 })
    cache.pack(first)
    const intermediate = shareSnapshot(first.state, {
        ...first.state,
        activities: first.state.activities.map((record, index) =>
            index ? record : { ...record, title: 'Acquired before persist' }
        )
    })
    const second = cache.pack(reply(intermediate))
    const latest = reply({ ...intermediate, snapshotVersion: 2 })
    expect('state' in second).toBe(true)
    const wire = cache.pack(latest, stateCursor(first.state))
    expect('state' in wire).toBe(true)
    expect(expandReply(wire, first.state).state.activities[0].title).toBe('Acquired before persist')
})

it('skips equal-version state polls but accepts account changes, new snapshots and restores', () => {
    const current: Reply = {
        state: { ...initialState(), snapshotVersion: 2, restoreId: 'one' },
        connections: { remote: false, notion: false, protectedStorage: true }
    }
    const equal = structuredClone(current)
    expect(unchangedStateReply(current, equal, { type: 'state' })).toBe(true)
    expect(
        unchangedStateReply(
            current,
            { ...equal, connections: { ...equal.connections, remote: true } },
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
    const current: Reply = { state, connections: { remote: false, notion: false, protectedStorage: true } }
    expect(unchangedStateReply(current, structuredClone(current), { type: 'state' })).toBe(false)
    state.snapshotVersion = 1
    expect(
        unchangedStateReply(
            current,
            { ...current, diff: 'new patch' },
            { type: 'details', activityId: 'change-request' }
        )
    ).toBe(false)
})

it('only skips detail loading for matching PR revisions or explicitly loaded metadata', () => {
    const state = sampleState('2026-10-05')
    const activity = state.activities.find((item) => item.kind === 'change-request')!
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
