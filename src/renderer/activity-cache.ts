import type { Activity, Command, Reply, State } from '../shared/model'
import { isCombinedDiff } from '../shared/diff-format'

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
