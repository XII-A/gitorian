import type { Activity, Command, Reply, State } from '../shared/model'
import { isCombinedDiff } from '../shared/diff-format'

// IPC snapshots are new objects even when most records have not changed. Share
// equal subtrees so a draft acknowledgement cannot invalidate the activity UI.
function shareSnapshot<T>(previous: T, next: T): T {
    if (Object.is(previous, next)) return previous
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next
    if (Array.isArray(next)) {
        if (!Array.isArray(previous)) return next
        const shared = next.map((value: unknown, index) => shareSnapshot(previous[index] as unknown, value))
        return (
            shared.length === previous.length && shared.every((value, index) => value === previous[index])
                ? previous
                : shared
        ) as T
    }
    if (Array.isArray(previous)) return next
    const before = previous as Record<string, unknown>
    const after = next as Record<string, unknown>
    const entries = Object.entries(after).map(([key, value]) => [key, shareSnapshot(before[key], value)] as const)
    return (
        entries.length === Object.keys(before).length &&
        entries.every(([key, value]) => Object.hasOwn(before, key) && before[key] === value)
            ? previous
            : Object.fromEntries(entries)
    ) as T
}

export function reconcileReply(current: Reply | undefined, result: Reply, command: Command): Reply {
    if (unchangedStateReply(current, result, command)) return current!
    const sameStore = !!current && current.state.restoreId === result.state.restoreId
    if (sameStore && (current.state.snapshotVersion ?? 0) > (result.state.snapshotVersion ?? 0)) return current
    const diffs = sameStore ? { ...current.state.diffs } : {}
    if (command.type === 'details' && result.diff !== undefined) diffs[command.activityId] = result.diff
    const next = { ...result, state: { ...result.state, diffs: { ...diffs, ...result.state.diffs } } }
    return sameStore ? shareSnapshot(current, next) : next
}

export function unchangedStateReply(current: Reply | undefined, result: Reply, command: Command): boolean {
    return (
        command.type === 'state' &&
        !!current &&
        result.state.snapshotVersion !== undefined &&
        current.state.restoreId === result.state.restoreId &&
        current.state.snapshotVersion === result.state.snapshotVersion &&
        current.connections.github === result.connections.github &&
        current.connections.notion === result.connections.notion &&
        current.connections.protectedStorage === result.connections.protectedStorage
    )
}

export function hasCachedDetails(state: State, activity: Activity, content: 'files' | 'diff' = 'diff'): boolean {
    if (content === 'files') return !!activity.filesLoaded
    return (
        state.diffs[activity.id] !== undefined &&
        !isCombinedDiff(state.diffs[activity.id]) &&
        (activity.kind !== 'pr' || (!!activity.revision && activity.diffRevision === activity.revision))
    )
}
