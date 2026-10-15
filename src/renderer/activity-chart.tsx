import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { Activity } from '../shared/model'
import { localDate } from '../shared/model'

import './activity-chart.css'
import type { BarChartDatum } from './components/arc/bar-chart/bar-chart'
import { BarChart } from './components/arc/bar-chart/bar-chart'
import { motionTokens } from './components/arc/lib/motion-tokens'
import { Popover, PopoverAnchor, PopoverContent } from './components/arc/popover/popover'
import { offsetDay } from './hub-model'
import { formatDay } from './workspace-model'

export const ActivityChart = ({
    activities,
    timezone,
    className,
    week
}: {
    activities: Activity[]
    timezone: string
    className?: string
    week: string
}) => {
    const [day, setDay] = useState<string>()
    const [open, setOpen] = useState(false)
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const summaryId = useId()
    const pointer = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined | null>(null)
    const chart = useRef<HTMLDivElement>(null)
    const buckets = useMemo(() => {
        const result = new Map<string, { commits: number; prs: number; reviews: number }>()
        for (const activity of activities) {
            const date = localDate(new Date(activity.date), timezone)
            const counts = result.get(date) ?? { commits: 0, prs: 0, reviews: 0 }
            if (activity.kind === 'commit') {
                counts.commits += 1
            } else if (activity.kind === 'review') {
                counts.reviews += 1
            } else {
                counts.prs += 1
            }
            result.set(date, counts)
        }
        return result
    }, [activities, timezone])
    const data = useMemo(
        () =>
            Array.from({ length: 7 }, (_, index) => {
                const date = offsetDay(week, index)
                return {
                    axisLabel: formatDay(date, { weekday: 'short' }),
                    key: date,
                    label: formatDay(date, { day: 'numeric', month: 'long', weekday: 'long' }),
                    value: Object.values(buckets.get(date) ?? {}).reduce((sum, count) => sum + count, 0)
                }
            }),
        [buckets, week]
    )
    const closeSoon = useCallback(() => {
        clearTimeout(timer.current ?? undefined)
        timer.current = setTimeout(() => {
            setOpen(false)
        }, motionTokens.duration.fast * 1000)
    }, [])
    const preview = useCallback(
        (datum: BarChartDatum | null) => {
            clearTimeout(timer.current ?? undefined)
            if (!datum) {
                closeSoon()
                return
            }
            if (!pointer.current) {
                const width = chart.current?.clientWidth ?? 0
                const index = data.findIndex((item) => item.key === datum.key)
                setPosition({ x: 24 + ((width - 48) * (index + 0.5)) / 7, y: 28 })
            }
            setDay(datum.key)
            setOpen(true)
        },
        [closeSoon, data]
    )
    useEffect(
        () => () => {
            clearTimeout(timer.current ?? undefined)
        },
        []
    )
    useEffect(() => {
        clearTimeout(timer.current ?? undefined)
        setOpen(false)
    }, [week])
    const counts = (day && buckets.get(day)) || { commits: 0, prs: 0, reviews: 0 }
    const total = counts.commits + counts.prs + counts.reviews
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <div
                className={['activity-chart', className].filter(Boolean).join(' ')}
                ref={chart}
                onPointerMoveCapture={(event) => {
                    pointer.current = true
                    const rect = event.currentTarget.getBoundingClientRect()
                    setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top })
                }}
                onPointerDownCapture={(event) => {
                    pointer.current = true
                    const rect = event.currentTarget.getBoundingClientRect()
                    setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top })
                }}
                onKeyDownCapture={() => {
                    pointer.current = false
                }}
                onFocusCapture={() => {
                    pointer.current = false
                }}
            >
                <PopoverAnchor asChild>
                    <span
                        className="activity-day-anchor"
                        aria-hidden="true"
                        style={{ left: position.x, top: position.y }}
                    />
                </PopoverAnchor>
                <BarChart
                    data={data}
                    label="Daily activity"
                    period={`${formatDay(week)} to ${formatDay(offsetDay(week, 6))}`}
                    height={40}
                    unit="events"
                    compact
                    showAverage={false}
                    onActiveChange={preview}
                    onDatumSelect={preview}
                    aria-describedby={open ? summaryId : undefined}
                />
            </div>
            <PopoverContent
                asChild
                role={undefined}
                className="activity-day-popover"

                id={summaryId}
                align="start"
                sideOffset={12}
                updatePositionStrategy="always"
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                }}
            >
                <section aria-label={day ? `Activity on ${formatDay(day)}` : 'Daily activity counts'}>
                    <div className="activity-day-summary-heading">
                        <h3>{day && formatDay(day, { day: 'numeric', month: 'short', weekday: 'short' })}</h3>
                        <span>
                            {total} {total === 1 ? 'event' : 'events'}
                        </span>
                    </div>
                    <dl>
                        <div>
                            <dt>Commits</dt>
                            <dd>{counts.commits}</dd>
                        </div>
                        <div>
                            <dt>PRs</dt>
                            <dd>{counts.prs}</dd>
                        </div>
                        <div>
                            <dt>Reviews</dt>
                            <dd>{counts.reviews}</dd>
                        </div>
                    </dl>
                </section>
            </PopoverContent>
        </Popover>
    )
}
