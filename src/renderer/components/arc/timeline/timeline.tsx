'use client'

import { ChevronDown } from 'lucide-react'
import type { Transition } from 'motion/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore
} from 'react'

import { required } from '../../../../shared/required'
import { motionTokens } from '../lib/motion-tokens'

import styles from './timeline.module.css'

const defaultDefaultExpanded: never[] = []

export interface TimelineEvent {
    id: string
    /** When it happened, as an ISO string or epoch milliseconds. */
    at: string | number
    /** Who did it, shown first in the foreground color. */
    actor?: string
    /** What happened, completing the actor: "merged Checkout redesign into main". */
    title: string
    /** Short context under the title, such as a pull request or a build. */
    meta?: string
    /** Revealed in place when the row is expanded. Rows without detail are not interactive. */
    detail?: ReactNode
    /** Portrait for an event by a person. */
    avatar?: string
    /** Icon for a system event, used when there is no avatar. */
    icon?: ReactNode
    /** Status of a system event. Always say the outcome in the title too, so it never rests on color. */
    tone?: 'neutral' | 'success' | 'danger'
}

/**
 * A vertical activity feed grouped by day, for project history, audit logs, and deploy streams. Use it when order and
 * recency matter; use a table when people need to sort or compare. Day labels stay pinned while their updates scroll,
 * the connecting line draws itself as rows come into view, rows expand in place, and new updates slide in at the top
 * while the rest glide down. Arrow keys move between rows, Enter or Space expands one.
 */
export interface TimelineProps {
    /** Updates in any order; the newest shows first. */
    events: TimelineEvent[]
    /** Reference time for relative labels and day groups, in epoch milliseconds. Pass a ticking clock to keep labels fresh. */
    now: number
    /** Accessible name for the feed. */
    label: string
    /** Time zone for day groups and clock times. Fixed by default so server and client agree. */
    timeZone?: string
    locale?: string
    /** Group updates under day headings. Disable for a continuous lifecycle, with a date beside every time. */
    groupByDay?: boolean
    /** Height of the scrolling area. Without it the feed grows with the page and reveals on page scroll. */
    maxHeight?: number | string
    /** Scroll back to the top when a new update arrives while the feed is scrolled down. */
    scrollToNew?: boolean
    defaultExpanded?: string[]
    /** Heading level for the day labels. */
    headingLevel?: 2 | 3 | 4 | 5 | 6
    className?: string
}

type Row = TimelineEvent & { time: number; day: string }
interface Group {
    day: string
    label: string
    rows: Row[]
}

const HOUR = 3_600_000
const enter = [...motionTokens.ease.enter] as [number, number, number, number]
const standard = [...motionTokens.ease.standard] as [number, number, number, number]
/** Seconds between rows revealed together, so the line reads as drawing downward. */
const STEP = 0.09
const noopSubscribe = () => () => {
    /* empty */
}

/** Reduced motion only after hydration, so the server and the first client render agree. */
const useReducedMotionSafe = () => {
    const hydrated = useSyncExternalStore(
        noopSubscribe,
        () => true,
        () => false
    )
    const reduced = useReducedMotion()
    return hydrated && !!reduced
}

/** Rows reveal against the viewport, which already clips by the scroll area, so they wait until they are visible in both. */
interface Clock {
    schedule: () => number
    reduced: boolean
    fresh: Set<string>
}
const RevealClock = createContext<Clock | null>(null)

/** Text that changes in place: the new value rises in from a soft blur while the old one lifts away a little faster. */
const RiseText = ({ text, reduced, direction = 1 }: { text: string; reduced: boolean; direction?: number }) => (
    <span className={styles.rise} aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.span
                key={text}
                className={styles.riseLine}
                custom={direction}
                variants={{
                    from: (dir: number) =>
                        reduced
                            ? { opacity: 0 }
                            : { filter: `blur(${motionTokens.blur.soft}px)`, opacity: 0, y: `${0.3 * dir}em` },
                    gone: (dir: number) =>
                        reduced
                            ? { opacity: 0, transition: { duration: 0 } }
                            : {
                                  filter: `blur(${motionTokens.blur.subtle}px)`,
                                  opacity: 0,
                                  transition: { duration: motionTokens.duration.fast, ease: standard },
                                  y: `${-0.3 * dir}em`
                              },
                    to: { filter: 'blur(0px)', opacity: 1, y: '0em' }
                }}
                initial="from"
                animate="to"
                exit="gone"
                transition={{
                    duration: reduced ? motionTokens.duration.instant : motionTokens.duration.standard,
                    ease: enter
                }}
            >
                {text}
            </motion.span>
        </AnimatePresence>
    </span>
)

/** The day's update count rolls digit by digit in the direction it moved. */
const RollingCount = ({ value, reduced }: { value: number; reduced: boolean }) => {
    const [state, setState] = useState({ direction: 1, value })
    if (state.value !== value) {
        setState({ direction: value > state.value ? 1 : -1, value })
    }
    const chars = String(value).split('')
    return (
        <span className={styles.rolling} aria-hidden="true">
            {chars.map((char, index) => (
                <span key={chars.length - index} className={styles.place}>
                    <RiseText text={char} reduced={reduced} direction={state.direction} />
                </span>
            ))}
        </span>
    )
}

const dayKey = (time: number, timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        day: '2-digit',
        month: '2-digit',
        timeZone,
        year: 'numeric'
    }).formatToParts(new Date(time))
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
}

const relative = (time: number, now: number) => {
    const minutes = Math.max(0, Math.floor((now - time) / 60_000))
    if (minutes < 1) {
        return { long: 'just now', short: 'Now' }
    }
    if (minutes < 60) {
        return { long: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`, short: `${minutes}m` }
    }
    const hours = Math.floor(minutes / 60)
    return { long: `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`, short: `${hours}h` }
}

/** A day's section. A new day opens from nothing and pushes the older days down; it clips only while it grows. */
const DaySection = ({
    id,
    fresh,
    reduced,
    children
}: {
    id?: string
    fresh: boolean
    reduced: boolean
    children: ReactNode
}) => {
    const [entering, setEntering] = useState(fresh)
    return (
        <motion.section
            className={styles.group}
            aria-labelledby={id}
            data-entering={entering || undefined}
            initial={fresh ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{
                height: 0,
                opacity: 0,
                transition: {
                    duration: reduced ? motionTokens.duration.instant : motionTokens.duration.exit,
                    ease: standard
                }
            }}
            transition={
                reduced
                    ? { duration: 0.15 }
                    : {
                          height: motionTokens.spring.smooth,
                          opacity: { duration: motionTokens.duration.standard, ease: enter }
                      }
            }
            onAnimationComplete={() => {
                setEntering(false)
            }}
        >
            {children}
        </motion.section>
    )
}

const TimelineRow = ({
    row,
    last,
    expanded,
    onToggle,
    timeLabel,
    timeFull
}: {
    row: Row
    last: boolean
    expanded: boolean
    onToggle: () => void
    timeLabel: string
    timeFull: string
}) => {
    const clock = required(useContext(RevealClock))
    const { reduced } = clock
    const detailId = useId()
    // The row reveals once, the first time it scrolls into view: its marker pops, then its line draws toward the next row.
    const [revealDelay, setRevealDelay] = useState<number | null>(null)
    const fresh = clock.fresh.has(row.id)
    const [entering, setEntering] = useState(fresh)
    const shown = revealDelay !== null
    const delay = (revealDelay ?? 0) + (fresh ? 0.12 : 0)
    const pop: Transition = reduced
        ? { duration: 0, opacity: { duration: 0.15 } }
        : {
              ...motionTokens.spring.morph,
              bounce: 0.32,
              delay,
              opacity: { delay, duration: motionTokens.duration.fast, ease: enter },
              visualDuration: 0.36
          }
    const draw: Transition = reduced
        ? { duration: 0 }
        : { ...motionTokens.spring.smooth, delay: delay + 0.1, visualDuration: 0.34 }
    const tone = row.avatar ? undefined : (row.tone ?? 'neutral')
    const Trigger = row.detail ? 'button' : 'div'

    return (
        <motion.li
            className={styles.item}
            data-entering={entering || undefined}
            initial={fresh ? { height: 0 } : false}
            animate={{ height: 'auto' }}
            exit={{
                height: 0,
                opacity: 0,
                transition: reduced
                    ? { duration: 0.1 }
                    : { height: { ...motionTokens.spring.smooth, visualDuration: 0.3 }, opacity: { duration: 0.12 } }
            }}
            transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
            onAnimationComplete={() => {
                setEntering(false)
            }}
            onViewportEnter={() => {
                setRevealDelay((current) => current ?? clock.schedule())
            }}
            viewport={{ amount: 0.2, once: true }}
        >
            <motion.span
                className={styles.marker}
                data-tone={tone}
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.4 }}
                animate={shown ? { opacity: 1, scale: 1 } : undefined}
                transition={pop}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- registry components stay framework agnostic */}
                {row.avatar ? <img src={row.avatar} alt="" width={28} height={28} decoding="async" /> : row.icon}
            </motion.span>
            {!last && (
                <motion.span
                    className={styles.segment}
                    aria-hidden="true"
                    initial={{ scaleY: 0 }}
                    animate={shown ? { scaleY: 1 } : undefined}
                    transition={draw}
                />
            )}
            <motion.div
                className={styles.content}
                initial={(() => {
                    if (fresh) {
                        if (reduced) {
                            return { opacity: 0 }
                        }
                        return { filter: `blur(${motionTokens.blur.soft}px)`, opacity: 0, y: -10 }
                    }
                    return false
                })()}
                animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                transition={
                    reduced
                        ? { duration: 0.15 }
                        : {
                              filter: { delay: 0.05, duration: motionTokens.duration.standard, ease: enter },
                              opacity: { delay: 0.05, duration: motionTokens.duration.standard, ease: enter },
                              y: motionTokens.spring.smooth
                          }
                }
            >
                <Trigger
                    className={styles.trigger}
                    {...(row.detail
                        ? {
                              'aria-controls': expanded ? detailId : undefined,
                              'aria-expanded': expanded,
                              'data-timeline-trigger': '',
                              onClick: onToggle,
                              type: 'button' as const
                          }
                        : {})}
                >
                    <span className={styles.text}>
                        <span className={styles.title}>
                            {row.actor && <span className={styles.actor}>{row.actor}</span>}
                            {row.actor ? ' ' : ''}
                            {row.title}
                        </span>
                        {row.meta && <span className={styles.meta}>{row.meta}</span>}
                    </span>
                    <time className={styles.time} dateTime={new Date(row.time).toISOString()} title={timeFull}>
                        <RiseText text={timeLabel} reduced={reduced} />
                        <span className={styles.srOnly}>{timeFull}</span>
                    </time>
                    {row.detail && (
                        <motion.span
                            className={styles.chevron}
                            aria-hidden="true"
                            initial={false}
                            animate={{ rotate: expanded ? 180 : 0 }}
                            transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                        >
                            <ChevronDown size={16} strokeWidth={1.75} />
                        </motion.span>
                    )}
                </Trigger>
                <AnimatePresence initial={false}>
                    {expanded && row.detail && (
                        <motion.div
                            key="detail"
                            id={detailId}
                            className={styles.detail}
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{
                                height: 0,
                                transition: reduced
                                    ? { duration: 0 }
                                    : { ...motionTokens.spring.smooth, visualDuration: 0.28 }
                            }}
                            transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
                        >
                            <motion.div
                                className={styles.detailInner}
                                initial={
                                    reduced
                                        ? { opacity: 0 }
                                        : { filter: `blur(${motionTokens.blur.soft}px)`, opacity: 0, y: -4 }
                                }
                                animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                                exit={{
                                    opacity: 0,
                                    transition: { duration: motionTokens.duration.instant, ease: standard }
                                }}
                                transition={
                                    reduced
                                        ? { duration: 0.15 }
                                        : { delay: 0.06, duration: motionTokens.duration.standard, ease: enter }
                                }
                            >
                                {row.detail}
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </motion.li>
    )
}

export const Timeline = ({
    events,
    now,
    label,
    timeZone = 'UTC',
    locale = 'en-US',
    groupByDay = true,
    maxHeight,
    scrollToNew = true,
    defaultExpanded = defaultDefaultExpanded,
    headingLevel = 3,
    className
}: TimelineProps) => {
    const reduced = useReducedMotionSafe()
    const id = useId()
    const scrollerRef = useRef<HTMLDivElement>(null)
    const [expanded, setExpanded] = useState(() => new Set(defaultExpanded))

    // Rows added after the first render are fresh: they slide in and the rest glide down. Their titles are announced.
    const ids = events.map((event) => event.id).join('|')
    const [known, setKnown] = useState(() => ({
        announcement: '',
        fresh: new Set<string>(),
        ids,
        set: new Set(events.map((event) => event.id))
    }))
    if (known.ids !== ids) {
        const added = events.filter((event) => !known.set.has(event.id))
        setKnown({
            announcement: added.length
                ? `New update: ${added.map((event) => [event.actor, event.title].filter(Boolean).join(' ')).join('. ')}`
                : known.announcement,
            fresh: new Set([...known.fresh, ...added.map((event) => event.id)]),
            ids,
            set: new Set(events.map((event) => event.id))
        })
    }
    // The bottom edge feathers while more updates wait below, and clears once the end is in view.
    const trackRef = useRef<HTMLDivElement>(null)
    const scrolls = maxHeight !== undefined
    useEffect(() => {
        const scroller = scrollerRef.current
        const track = trackRef.current
        if (!scrolls || !scroller || !track || typeof ResizeObserver === 'undefined') {
            return
        }
        const update = () => {
            if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 2) {
                scroller.dataset.more = ''
            } else {
                delete scroller.dataset.more
            }
        }
        update()
        scroller.addEventListener('scroll', update, { passive: true })
        const observer = new ResizeObserver(update)
        observer.observe(scroller)
        observer.observe(track)
        return () => {
            scroller.removeEventListener('scroll', update)
            observer.disconnect()
        }
    }, [scrolls])

    const newestId = events.reduce<TimelineEvent | null>(
        (latest, event) => (!latest || new Date(event.at).getTime() > new Date(latest.at).getTime() ? event : latest),
        null
    )?.id
    useEffect(() => {
        const scroller = scrollerRef.current
        if (!scrollToNew || !scroller || scroller.scrollTop < 1) {
            return
        }
        scroller.scrollTo({ behavior: reduced ? 'auto' : 'smooth', top: 0 })
    }, [newestId, scrollToNew, reduced])

    const [initialDays] = useState(() => new Set(events.map((event) => dayKey(new Date(event.at).getTime(), timeZone))))
    const groups = useMemo<Group[]>(() => {
        const rows = events
            .map((event) => {
                const time = new Date(event.at).getTime()
                return { ...event, day: dayKey(time, timeZone), time }
            })
            .toSorted((a, b) => b.time - a.time)
        if (!groupByDay) {
            return rows.length ? [{ day: 'lifecycle', label: '', rows }] : []
        }
        const today = dayKey(now, timeZone)
        const yesterday = dayKey(now - 24 * HOUR, timeZone)
        const heading = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone, weekday: 'long' })
        const byDay = new Map<string, Row[]>()
        for (const row of rows) {
            byDay.set(row.day, [...(byDay.get(row.day) ?? []), row])
        }
        return [...byDay].map(([day, rowsValue]) => ({
            day,
            label: (() => {
                if (day === today) {
                    return 'Today'
                }
                if (day === yesterday) {
                    return 'Yesterday'
                }
                return heading.format(new Date(rowsValue[0].time))
            })(),
            rows: rowsValue
        }))
    }, [events, now, timeZone, locale, groupByDay])
    const formats = useMemo(
        () => ({
            clock: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }),
            dateClock: new Intl.DateTimeFormat(locale, {
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                month: 'short',
                timeZone
            }),
            dateClockYear: new Intl.DateTimeFormat(locale, {
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                month: 'short',
                timeZone,
                year: 'numeric'
            }),
            full: new Intl.DateTimeFormat(locale, {
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                month: 'long',
                timeZone,
                weekday: 'long',
                year: 'numeric'
            })
        }),
        [locale, timeZone]
    )

    // Rows that come into view together are spaced a beat apart, so the line reads as drawing down the feed.
    const nextReveal = useRef(0)
    const schedule = useCallback(() => {
        if (reduced) {
            return 0
        }
        const current = performance.now() / 1000
        const start = Math.min(Math.max(current, nextReveal.current), current + 0.45)
        nextReveal.current = start + STEP
        return start - current
    }, [reduced])
    const clock = useMemo<Clock>(() => ({ fresh: known.fresh, reduced, schedule }), [schedule, reduced, known.fresh])

    const toggle = (idValue: string) => {
        setExpanded((current) => {
            const next = new Set(current)
            if (next.has(idValue)) {
                next.delete(idValue)
            } else {
                next.add(idValue)
            }
            return next
        })
    }
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            return
        }
        const triggers = [...(scrollerRef.current?.querySelectorAll<HTMLElement>('[data-timeline-trigger]') ?? [])]
        const index = triggers.indexOf(document.activeElement as HTMLElement)
        if (index === -1) {
            return
        }
        event.preventDefault()
        const next = (() => {
            if (event.key === 'Home') {
                return 0
            }
            if (event.key === 'End') {
                return triggers.length - 1
            }
            return Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), triggers.length - 1)
        })()
        triggers[next]?.focus()
    }

    return (
        <RevealClock.Provider value={clock}>
            <div className={[styles.root, className].filter(Boolean).join(' ')} role="region" aria-label={label}>
                <div
                    ref={scrollerRef}
                    role="presentation"
                    className={styles.scroller}
                    data-scrolls={scrolls || undefined}
                    style={
                        scrolls
                            ? ({
                                  '--timeline-height': typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight
                              } as CSSProperties)
                            : undefined
                    }
                    onKeyDown={onKeyDown}
                >
                    {/* Presence starts enabled so markers keep their hidden first frame; rows and days present at mount opt out of entering themselves. */}
                    <div ref={trackRef}>
                        <AnimatePresence>
                            {groups.map((group) => (
                                <DaySection
                                    key={group.day}
                                    id={groupByDay ? `${id}-${group.day}` : undefined}
                                    fresh={groupByDay && !initialDays.has(group.day)}
                                    reduced={reduced}
                                >
                                    {groupByDay && (
                                        <div
                                            className={styles.day}
                                            role="heading"
                                            aria-level={headingLevel}
                                            id={`${id}-${group.day}`}
                                        >
                                            <span>{group.label}</span>
                                            <span className={styles.count} aria-hidden="true">
                                                <RollingCount value={group.rows.length} reduced={reduced} />{' '}
                                                {group.rows.length === 1 ? 'update' : 'updates'}
                                            </span>
                                            <span
                                                className={styles.srOnly}
                                            >{`, ${group.rows.length} ${group.rows.length === 1 ? 'update' : 'updates'}`}</span>
                                        </div>
                                    )}
                                    <ol className={styles.list}>
                                        <AnimatePresence>
                                            {group.rows.map((row, index) => {
                                                const today =
                                                    groupByDay && group.label === 'Today' && now - row.time < 12 * HOUR
                                                const time = today
                                                    ? relative(row.time, now)
                                                    : {
                                                          long: '',
                                                          short: (() => {
                                                              if (groupByDay) {
                                                                  return formats.clock
                                                              }
                                                              if (
                                                                  row.day.slice(0, 4) ===
                                                                  dayKey(now, timeZone).slice(0, 4)
                                                              ) {
                                                                  return formats.dateClock
                                                              }
                                                              return formats.dateClockYear
                                                          })().format(new Date(row.time))
                                                      }
                                                return (
                                                    <TimelineRow
                                                        key={row.id}
                                                        row={row}
                                                        last={index === group.rows.length - 1}
                                                        expanded={expanded.has(row.id)}
                                                        onToggle={() => {
                                                            toggle(row.id)
                                                        }}
                                                        timeLabel={time.short}
                                                        timeFull={
                                                            today
                                                                ? `${time.long}, ${formats.full.format(new Date(row.time))}`
                                                                : formats.full.format(new Date(row.time))
                                                        }
                                                    />
                                                )
                                            })}
                                        </AnimatePresence>
                                    </ol>
                                </DaySection>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
                <span className={styles.srOnly} role="status">
                    {known.announcement}
                </span>
            </div>
        </RevealClock.Provider>
    )
}

export default Timeline
