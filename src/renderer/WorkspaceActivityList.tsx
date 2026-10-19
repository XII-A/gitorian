import { memo, useMemo } from 'react'
import type { Activity, Repository } from '../shared/model'
import { localDate } from '../shared/model'
import { formatDay } from './workspace-model'
import { ActivityRow } from './ActivityRow'
import { ActivityHover } from './ActivityHover'
import { Button } from './components/arc/button/button'

const WorkspaceActivityRow = memo(function WorkspaceActivityRow({
    activity,
    repositoryName,
    connected,
    selected,
    canCite,
    onInspect
}: {
    activity: Activity
    repositoryName: string
    connected: boolean
    selected: boolean
    canCite: boolean
    onInspect: (activity: Activity) => void
}) {
    return (
        <ActivityRow
            activity={activity}
            repositoryName={repositoryName}
            connected={connected}
            className="ws-activity-row"
            aria-pressed={selected}
            draggable={canCite}
            onDragStart={(event) => {
                event.dataTransfer.setData('application/x-weekly-j-activity', activity.id)
                event.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onInspect(activity)}
        />
    )
})

export const WorkspaceActivityList = memo(function WorkspaceActivityList({
    activities,
    repositories,
    timezone,
    selectedId,
    canCite,
    onInspect,
    hasActivity,
    onEmptyAction,
    refreshing = false
}: {
    activities: Activity[]
    repositories: Repository[]
    timezone: string
    selectedId?: string
    canCite: boolean
    onInspect: (activity: Activity) => void
    hasActivity: boolean
    onEmptyAction: () => void
    refreshing?: boolean
}) {
    const groups = useMemo(() => {
        const days = new Map<string, Activity[]>()
        for (const activity of activities) {
            const day = localDate(new Date(activity.date), timezone)
            const group = days.get(day) ?? []
            group.push(activity)
            days.set(day, group)
        }
        return [...days]
    }, [activities, timezone])
    const names = useMemo(
        () => new Map(repositories.map((repository) => [repository.id, repository.name])),
        [repositories]
    )
    return (
        <ActivityHover>
            {groups.length ? (
                groups.map(([day, items]) => (
                    <section className="ws-day-group" key={day}>
                        <header>
                            <h3>{formatDay(day, { weekday: 'long' })}</h3>
                            <span>{formatDay(day)}</span>
                        </header>
                        <ul className="activity-row-list">
                            {items.map((activity, index) => (
                                <li key={activity.id}>
                                    <WorkspaceActivityRow
                                        activity={activity}
                                        repositoryName={names.get(activity.repositoryId) ?? 'Repository'}
                                        connected={index < items.length - 1}
                                        selected={selectedId === activity.id}
                                        canCite={canCite}
                                        onInspect={onInspect}
                                    />
                                </li>
                            ))}
                        </ul>
                    </section>
                ))
            ) : (
                <div className="ws-activity-empty">
                    <h3>
                        {hasActivity
                            ? 'No matching changes'
                            : refreshing
                              ? 'Loading activity for this week'
                              : 'No activity loaded for this week'}
                    </h3>
                    <p>
                        {hasActivity
                            ? 'Choose another project or clear the activity filters.'
                            : refreshing
                              ? 'Activity will appear here as your repositories finish loading. You can write at any time.'
                              : 'Choose another week or refresh your repositories. You can write at any time.'}
                    </p>
                    <Button variant="secondary" size="sm" onClick={onEmptyAction} loading={!hasActivity && refreshing}>
                        {hasActivity ? 'Clear activity filters' : 'Refresh activity'}
                    </Button>
                </div>
            )}
        </ActivityHover>
    )
})
