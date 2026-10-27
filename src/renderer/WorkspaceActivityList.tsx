import { memo, useMemo } from 'react'
import type { Activity, Repository } from '../shared/model'
import { ActivityDayRows, groupActivityDays } from './ActivityDays'
import type { useActivityDays } from './ActivityDays'
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
                event.dataTransfer.setData('application/x-gitorian-activity', activity.id)
                event.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onInspect(activity)}
        />
    )
})

export const WorkspaceActivityList = memo(function WorkspaceActivityList({
    activities,
    dayFilter,
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
    dayFilter: ReturnType<typeof useActivityDays>
    repositories: Repository[]
    timezone: string
    selectedId?: string
    canCite: boolean
    onInspect: (activity: Activity) => void
    hasActivity: boolean
    onEmptyAction: () => void
    refreshing?: boolean
}) {
    const groups = useMemo(
        () => groupActivityDays(activities, timezone, dayFilter.day),
        [activities, timezone, dayFilter.day]
    )
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
                        <ActivityDayRows
                            day={day}
                            items={items}
                            focused={dayFilter.day !== 'all'}
                            expanded={dayFilter.expanded.has(day)}
                            onExpandedChange={(open) => dayFilter.toggle(day, open)}
                            renderRow={(activity, connected) => (
                                <WorkspaceActivityRow
                                    activity={activity}
                                    repositoryName={names.get(activity.repositoryId) ?? 'Repository'}
                                    connected={connected}
                                    selected={selectedId === activity.id}
                                    canCite={canCite}
                                    onInspect={onInspect}
                                />
                            )}
                        />
                    </section>
                ))
            ) : dayFilter.day !== 'all' ? (
                <div className="ws-activity-empty">
                    <h3>No matching activity for {formatDay(dayFilter.day, { weekday: 'long' })}</h3>
                    <p>Choose another day or adjust the activity filters.</p>
                    <Button variant="secondary" size="sm" onClick={() => dayFilter.setDay('all')}>
                        Show all days
                    </Button>
                </div>
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
