import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, State } from '../shared/model'
import { localDate } from '../shared/model'
import { offsetDay } from './hub-model'
import { formatDay } from './workspace-model'
import { BarChart } from './components/arc/bar-chart/bar-chart'
import type { BarChartDatum } from './components/arc/bar-chart/bar-chart'
import { Popover, PopoverAnchor, PopoverContent } from './components/arc/popover/popover'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { motionTokens } from './components/arc/lib/motion-tokens'
import { WorkspaceIcon } from './components/WorkspaceIcon'

export function WorkspaceActivityChart({
    activities,
    state,
    week,
    onInspect
}: {
    activities: Activity[]
    state: State
    week: string
    onInspect: (activity: Activity) => void
}) {
    const [day, setDay] = useState<string>()
    const [open, setOpen] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const pinned = useRef(false)
    const panel = useRef<HTMLDivElement>(null)
    const chart = useRef<HTMLDivElement>(null)
    const data = useMemo(
        () =>
            Array.from({ length: 7 }, (_, index) => {
                const date = offsetDay(week, index)
                return {
                    key: date,
                    label: formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' }),
                    axisLabel: formatDay(date, { weekday: 'short' }),
                    value: activities.filter((item) => localDate(new Date(item.date), state.settings.timezone) === date)
                        .length
                }
            }),
        [activities, week, state.settings.timezone]
    )
    const closeSoon = useCallback(() => {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            if (!pinned.current && !panel.current?.contains(document.activeElement)) setOpen(false)
        }, motionTokens.duration.standard * 1000)
    }, [])
    const preview = useCallback(
        (datum: BarChartDatum | null) => {
            clearTimeout(timer.current)
            if (!datum) {
                closeSoon()
                return
            }
            setDay(datum.key)
            setOpen(true)
        },
        [closeSoon]
    )
    const selectDay = useCallback((datum: BarChartDatum) => {
        clearTimeout(timer.current)
        pinned.current = true
        setDay(datum.key)
        setOpen(true)
        requestAnimationFrame(() =>
            (panel.current?.querySelector<HTMLButtonElement>('button') ?? panel.current)?.focus()
        )
    }, [])
    useEffect(() => () => clearTimeout(timer.current), [])
    useEffect(() => {
        clearTimeout(timer.current)
        pinned.current = false
        setOpen(false)
    }, [week])
    const daily = activities.filter((item) => localDate(new Date(item.date), state.settings.timezone) === day)
    return (
        <Popover
            open={open}
            onOpenChange={(value) => {
                pinned.current = false
                setOpen(value)
            }}
        >
            <PopoverAnchor asChild>
                <div className="ws-week-chart" ref={chart}>
                    <BarChart
                        data={data}
                        label="Daily activity"
                        period={`${formatDay(week)} to ${formatDay(offsetDay(week, 6))}`}
                        height={56}
                        unit="events"
                        compact
                        showAverage={false}
                        onActiveChange={preview}
                        onDatumSelect={selectDay}
                    />
                </div>
            </PopoverAnchor>
            <PopoverContent
                ref={panel}
                className="ws-day-popover"
                align="start"
                aria-label={day ? `Activity on ${formatDay(day)}` : 'Daily activity details'}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onPointerEnter={() => clearTimeout(timer.current)}
                onPointerLeave={closeSoon}
                onEscapeKeyDown={() => {
                    pinned.current = false
                    chart.current?.querySelector<HTMLElement>('[role=slider]')?.focus()
                }}
            >
                <header>
                    <h3>{day && formatDay(day, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
                    <span>
                        {daily.length} {daily.length === 1 ? 'event' : 'events'}
                    </span>
                </header>
                <ScrollArea maxHeight={280} label="Activity for this day" fade={12}>
                    {daily.length ? (
                        <ul>
                            {daily.map((item) => (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            pinned.current = false
                                            setOpen(false)
                                            onInspect(item)
                                            requestAnimationFrame(() =>
                                                document
                                                    .querySelector<HTMLElement>(
                                                        '.ws-inspector [role="tab"][aria-selected="true"]'
                                                    )
                                                    ?.focus()
                                            )
                                        }}
                                    >
                                        <WorkspaceIcon name={item.kind === 'commit' ? 'commit' : 'pr'} />
                                        <span>
                                            {item.title}
                                            <small>
                                                {state.repositories.find((repo) => repo.id === item.repositoryId)?.name}{' '}
                                                ·{' '}
                                                {new Date(item.date).toLocaleTimeString('en-US', {
                                                    timeZone: state.settings.timezone,
                                                    hour: 'numeric',
                                                    minute: '2-digit'
                                                })}
                                            </small>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>No activity on this day.</p>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}
