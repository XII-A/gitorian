import type { Activity, Command, Reply, State } from '../shared/model'
import { isCombinedDiff } from '../shared/diff-format'
import { shareSnapshot } from '../shared/snapshot'
import { hasFileStatistics } from '../shared/change-statistics'

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
        current.connections.remote === result.connections.remote &&
        current.connections.notion === result.connections.notion &&
        current.connections.protectedStorage === result.connections.protectedStorage
    )
}

export function hasCachedDetails(state: State, activity: Activity, content: 'files' | 'diff' = 'diff'): boolean {
    if (content === 'files') return hasFileStatistics(activity)
    return (
        state.diffs[activity.id] !== undefined &&
        !isCombinedDiff(state.diffs[activity.id]) &&
        (activity.kind !== 'change-request' || (!!activity.revision && activity.diffRevision === activity.revision))
    )
}
