import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GitBranch } from 'lucide-react'
import type { Activity } from '../shared/model'
import { ActivityRow } from './ActivityRow'
import { ActivityHover } from './ActivityHover'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { EmptyState } from './components/arc/empty-state/empty-state'

export function RelatedActivities({
    activities,
    repositoryName,
    onInspect
}: {
    activities: Activity[]
    repositoryName: string
    onInspect?: (activity: Activity) => void
}) {
    const viewport = useRef<HTMLDivElement>(null)
    const list = useRef<HTMLUListElement>(null)
    const pendingFocus = useRef<number | undefined>(undefined)
    const virtualizer = useVirtualizer({
        count: activities.length,
        getScrollElement: () => viewport.current,
        getItemKey: (index) => activities[index].id,
        estimateSize: () => 100,
        overscan: 4,
        paddingStart: 12,
        paddingEnd: 12,
        initialRect: { width: 400, height: 600 }
    })
    const rows = virtualizer.getVirtualItems()
    useLayoutEffect(() => {
        const index = pendingFocus.current
        if (index === undefined) return
        const button = list.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"] button`)
        if (button) {
            button.focus({ preventScroll: true })
            pendingFocus.current = undefined
        }
    }, [rows])
    const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const next =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? activities.length - 1
                  : event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)
                    ? index + 1
                    : event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)
                      ? index - 1
                      : undefined
        if (next === undefined || next < 0 || next >= activities.length) return
        event.preventDefault()
        pendingFocus.current = next
        virtualizer.scrollToIndex(next, { align: 'auto' })
        // Adjacent rows are normally already in the overscan window.
        const button = list.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"] button`)
        if (button) {
            button.focus({ preventScroll: true })
            pendingFocus.current = undefined
        }
    }
    return (
        <ScrollArea
            className="ws-inspector-scroll"
            viewportClassName={activities.length ? undefined : 'ws-related-empty-viewport'}
            viewportRef={viewport}
            label="Related activity"
            fade={activities.length ? 16 : 0}
        >
            {activities.length ? (
                <div className="ws-related-space" style={{ height: virtualizer.getTotalSize() }}>
                    <div className="ws-related-window" style={{ transform: `translateY(${rows[0]?.start ?? 0}px)` }}>
                        <ActivityHover>
                            <ul
                                ref={list}
                                className="ws-related-list activity-row-list"
                                aria-label="Related activities"
                            >
                                {rows.map((row) => (
                                    <li
                                        key={row.key}
                                        ref={virtualizer.measureElement}
                                        data-index={row.index}
                                        aria-posinset={row.index + 1}
                                        aria-setsize={activities.length}
                                    >
                                        <ActivityRow
                                            activity={activities[row.index]}
                                            repositoryName={repositoryName}
                                            connected={row.index < activities.length - 1}
                                            className="ws-activity-row"
                                            onKeyDown={(event) => navigate(event, row.index)}
                                            onClick={() => onInspect?.(activities[row.index])}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </ActivityHover>
                    </div>
                </div>
            ) : (
                <EmptyState
                    iconVariant="plain"
                    icon={<GitBranch size={32} strokeWidth={1.5} aria-hidden="true" />}
                    title="No related activity"
                    description="No other captured activity shares this branch or request."
                />
            )}
        </ScrollArea>
    )
}
