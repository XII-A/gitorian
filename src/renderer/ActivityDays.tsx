import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Ellipsis } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/motion-tokens'
import type { Activity } from '../shared/model'
import { localDate } from '../shared/model'
import { offsetDay } from './hub-model'
import { formatDay } from './workspace-model'
import { Accordion } from './components/arc/accordion/accordion'
import { MorphSelect } from './components/arc/morph-select/morph-select'
import './activity-row.css'

/** Filters and disclosures belong to the current week, and survive day/project filtering. */
export function useActivityDays(week: string) {
    const [scope, setScope] = useState({ week, day: 'all', expanded: new Set<string>() })
    if (scope.week !== week) setScope({ week, day: 'all', expanded: new Set() })
    return useMemo(
        () => ({
            day: scope.week === week ? scope.day : 'all',
            setDay: (day: string) => setScope((current) => ({ ...current, day })),
            expanded: scope.expanded,
            toggle: (day: string, open: boolean) =>
                setScope((current) => {
                    const expanded = new Set(current.expanded)
                    if (open) expanded.add(day)
                    else expanded.delete(day)
                    return { ...current, expanded }
                })
        }),
        [scope, week]
    )
}

export function ActivityDayFilter({
    week,
    value,
    onValueChange
}: {
    week: string
    value: string
    onValueChange: (day: string) => void
}) {
    return (
        <div className="activity-day-filter">
            <MorphSelect
                portal
                label="Activity day"
                hideLabel
                variant="ghost"
                size="sm"
                value={value}
                onValueChange={onValueChange}
                searchable={false}
                animateTriggerWidth={false}
                panelWidth={240}
                title={
                    value === 'all' ? 'All days' : formatDay(value, { weekday: 'long', month: 'short', day: 'numeric' })
                }
                items={[
                    { value: 'all', label: 'All days' },
                    ...Array.from({ length: 7 }, (_, index) => {
                        const day = offsetDay(week, index)
                        return {
                            value: day,
                            label: formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })
                        }
                    })
                ]}
            />
        </div>
    )
}

export function groupActivityDays(activities: Activity[], timezone: string, selectedDay: string) {
    const days = new Map<string, Activity[]>()
    for (const item of activities) {
        const day = localDate(new Date(item.date), timezone)
        if (selectedDay !== 'all' && day !== selectedDay) continue
        const group = days.get(day) ?? []
        group.push(item)
        days.set(day, group)
    }
    return [...days]
}

/** The same five-row preview and final timeline node in both activity surfaces. */
export function ActivityDayRows({
    day,
    items,
    expanded,
    onExpandedChange,
    focused,
    renderRow
}: {
    day: string
    items: Activity[]
    expanded: boolean
    onExpandedChange: (open: boolean) => void
    focused: boolean
    renderRow: (item: Activity, connected: boolean) => ReactNode
}) {
    const root = useRef<HTMLDivElement>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const scroll = useRef<{
        viewport: HTMLElement
        height: number
        from: number
        to: number
        anchor: string
    } | null>(null)
    const keyboard = useRef(false)
    const [visited, setVisited] = useState(expanded)
    const [instant, setInstant] = useState(false)
    const reduced = useReducedMotion()
    const releaseScroll = useCallback(() => {
        const closing = scroll.current
        if (closing) closing.viewport.style.overflowAnchor = closing.anchor
        scroll.current = null
    }, [])
    const more = !focused && items.length > 5
    useEffect(() => releaseScroll, [more, releaseScroll])
    const remaining = items.length - 5
    const accessibleLabel = expanded
        ? 'Show fewer activities'
        : `Show ${remaining} more ${remaining === 1 ? 'activity' : 'activities'}`
    const rows = (list: Activity[], followed: boolean) => (
        <ul className="activity-row-list">
            {list.map((item, index) => (
                <li key={item.id}>{renderRow(item, followed || index < list.length - 1)}</li>
            ))}
        </ul>
    )
    return (
        <div className="activity-day-rows" ref={root}>
            {rows(more ? items.slice(0, 5) : items, more)}
            {more && (
                <Accordion
                    variant="plain"
                    triggerPosition="after"
                    showIcon={false}
                    instant={instant}
                    value={expanded ? '0' : ''}
                    onPanelHeightChange={(height) => {
                        const closing = scroll.current
                        if (!closing) return
                        const progress = Math.min(1, Math.max(0, height / closing.height))
                        closing.viewport.scrollTop = closing.to + (closing.from - closing.to) * progress
                        if (height === 0) releaseScroll()
                    }}
                    onValueChange={(next) => {
                        releaseScroll()
                        if (next) setVisited(true)
                        else {
                            // Height is the single clock. A separate scroll animation starts
                            // before Motion finishes measuring auto height and causes a jump.
                            const bounds = root.current?.getBoundingClientRect()
                            const viewport = root.current?.closest<HTMLElement>('[role="region"]')
                            const top = viewport?.getBoundingClientRect().top ?? 0
                            const panelId = trigger.current?.getAttribute('aria-controls')
                            const height = panelId
                                ? document.getElementById(panelId)?.getBoundingClientRect().height
                                : 0
                            if (viewport && bounds && bounds.top < top && height) {
                                const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight - height)
                                const target = Math.min(max, Math.max(0, viewport.scrollTop + bounds.top - top))
                                if (reduced || keyboard.current) viewport.scrollTop = target
                                else {
                                    scroll.current = {
                                        viewport,
                                        height,
                                        from: viewport.scrollTop,
                                        to: target,
                                        anchor: viewport.style.overflowAnchor
                                    }
                                    // Browser scroll anchoring must not compete with the disclosure.
                                    viewport.style.overflowAnchor = 'none'
                                }
                            }
                            trigger.current?.focus({ preventScroll: true })
                        }
                        onExpandedChange(!!next)
                    }}
                    triggerProps={{
                        className: 'activity-row activity-day-toggle',
                        'aria-label': `${accessibleLabel} for ${formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })}`,
                        onClick: (event) => {
                            trigger.current = event.currentTarget
                            keyboard.current = event.detail === 0
                            setInstant(event.detail === 0)
                        }
                    }}
                    items={[
                        {
                            title: (
                                <>
                                    <span className="activity-row-node" aria-hidden="true">
                                        <Ellipsis size={14} />
                                    </span>
                                    <span className="activity-day-toggle-label" aria-hidden="true">
                                        {[`Show ${items.length - 5} more`, 'Show fewer'].map((text, index) => (
                                            <motion.span
                                                key={index}
                                                initial={false}
                                                animate={{
                                                    opacity: expanded === !!index ? 1 : 0,
                                                    transform:
                                                        reduced || instant
                                                            ? 'none'
                                                            : `translateY(${expanded === !!index ? 0 : index ? 4 : -4}px)`
                                                }}
                                                transition={{
                                                    duration: instant ? 0 : motionTokens.duration.fast,
                                                    ease: [...motionTokens.ease.standard]
                                                }}
                                            >
                                                {text}
                                            </motion.span>
                                        ))}
                                    </span>
                                </>
                            ),
                            content: visited || expanded ? rows(items.slice(5), true) : null
                        }
                    ]}
                />
            )}
        </div>
    )
}
