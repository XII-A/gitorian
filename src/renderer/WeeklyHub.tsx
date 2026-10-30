import { summarizeRepositoryActivity } from './repository-markers'
import { RepositoryActivity } from './RepositoryActivity'
import { ActivityFilterStrip } from './ActivityFilterStrip'
import { AppUpdateButton } from './AppUpdates'
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import { Alert } from './components/arc/alert/alert'
import { readableError } from './background-work'
import { actionableSources } from './background-work'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { BookOpen, Check, GitCommitHorizontal, ListChecks, RefreshCw, Settings2 } from 'lucide-react'
import { AnimatePresence, motion, stagger, useIsPresent, usePresenceData } from 'motion/react'
import type { Variants } from 'motion/react'
import { motionTokens } from './components/arc/motion-tokens'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { GettingStarted, type SetupSection } from './GettingStarted'
import { OnboardingSetupLayout } from './OnboardingSetupLayout'
import type { useOnboarding } from './use-onboarding'
import { localDate, shiftWeek, weekOf } from '../shared/model'
import type { Activity, Command, Reply, State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { AnimatedCounter } from './components/arc/animated-counter/animated-counter'
import { DateRangePicker } from './components/arc/date-range-picker/date-range-picker'
import { ProjectFilter } from './ProjectFilter'
import { ActivityChart } from './ActivityChart'
import { ActivityRow } from './ActivityRow'
import { ActivityHover } from './ActivityHover'
import { ActivityDayFilter, ActivityDayRows, groupActivityDays, useActivityDays } from './ActivityDays'
import { HubActivityDialog, type HubActivityDialogHandle } from './HubActivityDialog'
import { HeaderAtmosphere } from './HeaderAtmosphere'
import './hub.css'
import { offsetDay, rangeActivities, journalWeek } from './hub-model'
import { Tooltip } from './components/arc/tooltip/tooltip'
import { EntryHistory } from './EntryHistory'
import { useActivityRefresh } from './use-activity-refresh'
import { useWeekHistory } from './use-week-history'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Skeleton } from './components/arc/skeleton/skeleton'

const overviewReveal = (reduced: boolean, instant: boolean): Variants => ({
    hidden: { opacity: 0, transform: reduced || instant ? 'none' : 'translateY(8px)' },
    visible: {
        opacity: 1,
        transform: 'none',
        transition: {
            duration: instant ? 0 : reduced ? motionTokens.duration.fast : motionTokens.duration.standard,
            ease: [...motionTokens.ease.enter]
        }
    }
})

function SetupPanel({ children, reduced }: { children: ReactNode; reduced: boolean }) {
    const present = useIsPresent()
    // Presence data reaches an exiting child after the dismissing render removes its props.
    const instant = usePresenceData() === true
    return (
        <motion.div
            className="hub-onboarding-panel"
            inert={!present}
            aria-hidden={!present || undefined}
            initial={false}
            animate={{ opacity: 1, transform: 'none' }}
            exit={{ opacity: 0, transform: reduced || instant ? 'none' : 'translateY(-4px)' }}
            transition={{ duration: instant ? 0 : motionTokens.duration.instant, ease: [...motionTokens.ease.enter] }}
        >
            {children}
        </motion.div>
    )
}

/** Observe the original flow position, never the moving sticky surface. */
function HubFilterDock({ children }: { children: ReactNode }) {
    const sentinel = useRef<HTMLDivElement>(null)
    const dock = useRef<HTMLDivElement>(null)
    const [stuck, setStuck] = useState(false)
    useEffect(() => {
        const marker = sentinel.current
        const surface = dock.current
        const viewport = marker?.closest('.hub-scroll')?.firstElementChild
        if (!marker || !surface || !viewport) return
        const inset = parseFloat(getComputedStyle(surface).top)
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry) setStuck(entry.boundingClientRect.top <= (entry.rootBounds?.top ?? 0))
            },
            { root: viewport, rootMargin: `-${inset}px 0px 0px 0px`, threshold: [0, 1] }
        )
        observer.observe(marker)
        return () => observer.disconnect()
    }, [])
    return (
        <>
            <div ref={sentinel} className="hub-filter-sentinel" aria-hidden="true" />
            <div ref={dock} className="hub-filter-dock" data-stuck={stuck || undefined}>
                {children}
            </div>
        </>
    )
}

const dateValue = (value: string) => new Date(`${value}T12:00:00`)
const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const formatDate = (date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
    dateValue(date).toLocaleDateString('en-US', options)

interface Props {
    initialWeek?: string
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    error: string
    onWrite: (date: string) => void
    onSources: () => void
    onSettings: () => void
    onActivity: (activity: Activity) => void
    onboarding: ReturnType<typeof useOnboarding>
    onSetup: (section: SetupSection) => void
    settingsOpen: boolean
}

export function WeeklyHub({
    state,
    run,
    error,
    onWrite,
    onSettings,
    onSources,
    onActivity,
    initialWeek,
    onboarding,
    onSetup,
    settingsOpen
}: Props) {
    const [setupOpen, setSetupOpen] = useState(false)
    const [reduced, setReduced] = useState(false)
    useEffect(() => {
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
        const sync = () => setReduced(preference.matches)
        sync()
        preference.addEventListener('change', sync)
        return () => preference.removeEventListener('change', sync)
    }, [])
    const [retainSetup, setRetainSetup] = useState(false)
    const hasShownSetup = useRef(false)
    const skipReveal = useRef(false)
    const showSetup = onboarding.visibility === 'active' || retainSetup
    useEffect(() => {
        if (onboarding.visibility === 'active') {
            hasShownSetup.current = true
            setRetainSetup(true)
        } else if (!settingsOpen) setRetainSetup(false)
    }, [onboarding.visibility, settingsOpen])
    const animateReveal = hasShownSetup.current && !skipReveal.current
    const setupTrigger = useRef<HTMLButtonElement>(null)
    const openingSettings = useRef(false)
    const dismissSetup = (event: MouseEvent<HTMLButtonElement>) => {
        skipReveal.current = event.detail === 0
        setRetainSetup(false)
        onboarding.dismiss()
        setSetupOpen(false)
        requestAnimationFrame(() => setupTrigger.current?.focus())
    }
    const setup = (dismissible = false) => (
        <GettingStarted
            completed={onboarding.completed}
            onSettings={(section) => {
                openingSettings.current = true
                setSetupOpen(false)
                onSetup(section)
            }}
            onDismiss={dismissible ? dismissSetup : undefined}
        />
    )
    const currentWeek = weekOf(new Date(), state.settings)
    const [start, setStart] = useState(initialWeek || currentWeek)
    const end = offsetDay(start, 6)
    const dayFilter = useActivityDays(start)
    const [project, setProject] = useState('all')
    const [tab, setTab] = useState<'all' | 'commit' | 'change-request'>('all')
    const detailDialog = useRef<HubActivityDialogHandle>(null)
    const { refresh, refreshing: busy } = useActivityRefresh(run, start, end, state.settings.timezone)
    const loadingWeek = useWeekHistory(state, run, start)
    const repositories = state.repositories
    const items = useMemo(() => rangeActivities(state, start, end), [state, start, end])
    const highlightRules = useRef<HTMLStyleElement>(null)
    const highlightRepository = useCallback((key: string | null) => {
        if (!highlightRules.current) return
        const escaped = key ? CSS.escape(key) : ''
        highlightRules.current.textContent = key
            ? `.hub-timeline .activity-row:not(:focus-visible):not([data-repository-id="${escaped}"]):not([data-repository-group="${escaped}"]) :is(.activity-row-content,.activity-row-node,.activity-row-chevron){opacity:.4}`
            : ''
    }, [])
    const repositorySummary = useMemo(() => summarizeRepositoryActivity(repositories, items), [repositories, items])
    const { commits, prs, days } = useMemo(() => {
        const commits: Activity[] = [],
            prs: Activity[] = [],
            days = new Set<string>()
        for (const item of items) {
            ;(item.kind === 'commit' ? commits : prs).push(item)
            days.add(localDate(new Date(item.date), state.settings.timezone))
        }
        return { commits, prs, days: [...days] }
    }, [items, state.settings.timezone])
    const repositoryCount = repositorySummary.entries.length
    const projectItems = project === 'all' ? items : items.filter((item) => item.repositoryId === project)
    const visible = projectItems.filter(
        (item) => tab === 'all' || (tab === 'commit' ? item.kind === 'commit' : item.kind !== 'commit')
    )
    const dayGroups = groupActivityDays(visible, state.settings.timezone, dayFilter.day)
    const period = `${formatDate(start)} – ${formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' })}`
    const row = (item: Activity, connected: boolean) => (
        <ActivityRow
            activity={item}
            repositoryMarker={repositorySummary.byId.get(item.repositoryId)}
            repositoryGroup={repositorySummary.byId.get(item.repositoryId)?.group}
            repositoryName={repositorySummary.byId.get(item.repositoryId)?.label ?? 'Repository'}
            connected={connected}
            className={`hub-activity hub-kind-${item.kind}`}
            key={item.id}
            onClick={() => detailDialog.current?.open(item)}
        />
    )
    const filters = (
        <HubFilterDock>
            <ActivityFilterStrip className="hub-filters">
                {(['all', 'commit', 'change-request'] as const).map((value) => (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="hub-filter-chip"
                        animateContent={false}
                        key={value}
                        aria-pressed={tab === value}
                        onClick={() => setTab(value)}
                    >
                        {value === 'all' ? 'All activity' : value === 'commit' ? 'Commits' : 'Requests & reviews'}
                        <AnimatedCounter
                            variant="inline"
                            value={
                                projectItems.filter(
                                    (item) =>
                                        value === 'all' ||
                                        (value === 'commit' ? item.kind === 'commit' : item.kind !== 'commit')
                                ).length
                            }
                        />
                    </Button>
                ))}
                <ActivityDayFilter week={start} value={dayFilter.day} onValueChange={dayFilter.setDay} />
                <ProjectFilter repositories={repositories} value={project} onValueChange={setProject} />
            </ActivityFilterStrip>
        </HubFilterDock>
    )
    const empty = (
        <div className="hub-empty">
            <GitCommitHorizontal size={26} aria-hidden="true" />
            <h3>
                {items.length
                    ? 'No matching activity'
                    : loadingWeek
                      ? 'Loading activity for this week'
                      : state.repositories.some((repo) => !repo.removed)
                        ? 'No activity loaded for this week'
                        : 'No repositories connected'}
            </h3>
            <p>
                {items.length
                    ? 'Choose another activity filter to see your work.'
                    : loadingWeek
                      ? 'Activity will appear here as your repositories finish loading.'
                      : state.repositories.some((repo) => !repo.removed)
                        ? 'No activity in this date range. Refresh your repositories or choose another range.'
                        : 'Connect a repository to gather your commits, requests and reviews here.'}
            </p>
            <Button
                variant="secondary"
                size="sm"
                loading={!items.length && (busy || loadingWeek)}
                onClick={() =>
                    items.length
                        ? (() => {
                              setTab('all')
                              setProject('all')
                              dayFilter.setDay('all')
                          })()
                        : state.repositories.some((repo) => !repo.removed)
                          ? void refresh()
                          : onSettings()
                }
            >
                {items.length
                    ? 'Show all activity'
                    : state.repositories.some((repo) => !repo.removed)
                      ? 'Refresh activity'
                      : 'Connect a repository'}
            </Button>
        </div>
    )
    const chart = (
        <ActivityChart activities={items} week={start} timezone={state.settings.timezone} className="hub-chart" />
    )
    const stats = (
        <div className="hub-stats">
            <div>
                <strong>
                    <AnimatedCounter variant="inline" value={commits.length} />
                </strong>
                <span>{commits.length === 1 ? 'commit' : 'commits'}</span>
            </div>
            <div>
                <strong>
                    <AnimatedCounter variant="inline" value={prs.length} />
                </strong>
                <span>Requests & reviews</span>
            </div>
            <div>
                <strong>
                    <AnimatedCounter variant="inline" value={repositoryCount} />
                </strong>
                <span>{repositoryCount === 1 ? 'repository' : 'repositories'}</span>
            </div>
            <div>
                <strong>
                    <AnimatedCounter variant="inline" value={days.length} />
                </strong>
                <span>{days.length === 1 ? 'active day' : 'active days'}</span>
            </div>
        </div>
    )
    return (
        <ScrollArea className="hub-scroll" label="Weekly overview" fade={0}>
            <main className="weekly-hub hub-thread">
                <a className="hub-skip" href="#hub-content">
                    Skip to weekly overview
                </a>
                <HeaderAtmosphere surface="hub" />
                <nav className="hub-topbar" aria-label="Date range and journal controls">
                    <div className="hub-date-controls">
                        <DateRangePicker
                            label="Week"
                            weekStartsOn={state.settings.weekStart}
                            value={{ start: dateValue(start), end: dateValue(end) }}
                            fixedRangeDays={7}
                            normalizeStart={(date) => dateValue(journalWeek(dateKey(date), state.settings.weekStart))}
                            onChange={(range) => setStart(dateKey(range.start))}
                            presets={[0, 1, 2, 3, 4].map((weeksAgo) => ({
                                label:
                                    weeksAgo === 0
                                        ? 'This week'
                                        : weeksAgo === 1
                                          ? 'Last week'
                                          : `${weeksAgo} weeks ago`,
                                range: () => ({
                                    start: dateValue(shiftWeek(currentWeek, -weeksAgo)),
                                    end: dateValue(offsetDay(shiftWeek(currentWeek, -weeksAgo), 6))
                                })
                            }))}
                        />
                    </div>
                    <div className="hub-utilities">
                        {onboarding.visibility === 'dismissed' && (
                            <Popover
                                open={setupOpen}
                                onOpenChange={(open) => {
                                    openingSettings.current = false
                                    setSetupOpen(open)
                                }}
                            >
                                <PopoverTrigger asChild>
                                    <Button ref={setupTrigger} variant="ghost" size="sm" className="hub-setup-trigger">
                                        <ListChecks size={17} aria-hidden="true" />
                                        Continue setup
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    align="end"
                                    className="hub-setup-popover"
                                    aria-label="Journal setup"
                                    onCloseAutoFocus={(event) => {
                                        if (openingSettings.current) event.preventDefault()
                                    }}
                                >
                                    <ScrollArea
                                        label="Journal setup checklist"
                                        maxHeight="min(var(--radix-popover-content-available-height), calc(100dvh - 24px))"
                                        scrollbars="always"
                                        fade={12}
                                    >
                                        {setup()}
                                    </ScrollArea>
                                </PopoverContent>
                            </Popover>
                        )}
                        <div className="hub-utility-icons">
                            <AppUpdateButton />
                            <Tooltip content="Open journal" side="bottom">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onWrite(start)}
                                    aria-label="Open journal"
                                >
                                    <BookOpen size={17} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                            <EntryHistory state={state} run={run} onWrite={(week) => onWrite(week || currentWeek)} />
                            <Tooltip content="Refresh activity" side="bottom">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    loading={busy || loadingWeek}
                                    onClick={() => void refresh()}
                                    aria-label="Refresh activity"
                                >
                                    <RefreshCw size={16} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                            {actionableSources(state).length > 0 && (
                                <Tooltip content="Activity sources" side="bottom">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        data-source-status
                                        onClick={onSources}
                                        aria-label="Activity sources"
                                    >
                                        <StackIcon size={18} weight="bold" aria-hidden="true" />
                                    </Button>
                                </Tooltip>
                            )}
                            <Tooltip content="Open settings" side="bottom">
                                <Button variant="ghost" size="sm" onClick={onSettings} aria-label="Open settings">
                                    <Settings2 size={17} aria-hidden="true" />
                                </Button>
                            </Tooltip>
                        </div>
                    </div>
                </nav>
                <div className="hub-content" id="hub-content">
                    {error && (
                        <Alert tone="danger" title="Activity could not be refreshed">
                            <p>{readableError(error)}</p>
                            <Button
                                variant="secondary"
                                size="sm"
                                loading={busy || loadingWeek}
                                onClick={() => void refresh()}
                            >
                                Refresh activity
                            </Button>
                        </Alert>
                    )}
                    <header className="hub-hero">
                        <p className="hub-period">{period}</p>
                        <h1>Weekly overview</h1>
                        <p className="hub-hero-description">
                            Review your activity, then capture progress, decisions, and anything you want to follow up
                            on.
                        </p>
                        <div className="hub-hero-action">
                            <Button onClick={() => onWrite(start)}>Write this week’s entry →</Button>
                        </div>
                    </header>

                    <div className="hub-onboarding-stage">
                        <AnimatePresence initial={false} custom={skipReveal.current}>
                            {!onboarding.visibility ? (
                                <div key="loading">
                                    <Skeleton label="Loading journal setup" lines={3} />
                                </div>
                            ) : showSetup ? (
                                <SetupPanel key="setup" reduced={!!reduced}>
                                    <OnboardingSetupLayout>{setup(true)}</OnboardingSetupLayout>
                                </SetupPanel>
                            ) : (
                                <motion.div
                                    key="overview"
                                    className="hub-overview-panel"
                                    initial={animateReveal ? 'hidden' : false}
                                    animate="visible"
                                    variants={{
                                        visible: {
                                            transition: {
                                                delayChildren: stagger(
                                                    reduced || !animateReveal ? 0 : motionTokens.stagger.item,
                                                    {
                                                        startDelay: animateReveal ? motionTokens.duration.instant : 0
                                                    }
                                                )
                                            }
                                        }
                                    }}
                                >
                                    <motion.div
                                        className="hub-thread-summary"
                                        data-overview-region="stats"
                                        variants={overviewReveal(!!reduced, !animateReveal)}
                                    >
                                        <div className="hub-summary-content">
                                            {stats}
                                            {chart}
                                        </div>
                                    </motion.div>
                                    <motion.div
                                        data-overview-region="activity"
                                        variants={overviewReveal(!!reduced, !animateReveal)}
                                    >
                                        <div className="hub-thread-layout">
                                            <section id="hub-activity" className="hub-timeline">
                                                <style ref={highlightRules} />
                                                <div className="hub-section-heading">
                                                    <h2>Activity this week</h2>
                                                </div>
                                                {filters}
                                                {dayGroups.length ? (
                                                    <ActivityHover>
                                                        {dayGroups.map(([day, dayItems]) => (
                                                            <section className="hub-day" key={day}>
                                                                <div className="hub-day-date">
                                                                    <strong>
                                                                        {formatDate(day, { weekday: 'long' })}
                                                                    </strong>
                                                                    <span>{formatDate(day)}</span>
                                                                </div>
                                                                <ActivityDayRows
                                                                    day={day}
                                                                    virtualize={items.length > 500}
                                                                    items={dayItems}
                                                                    focused={dayFilter.day !== 'all'}
                                                                    expanded={dayFilter.expanded.has(day)}
                                                                    onExpandedChange={(open) =>
                                                                        dayFilter.toggle(day, open)
                                                                    }
                                                                    renderRow={row}
                                                                />
                                                            </section>
                                                        ))}
                                                    </ActivityHover>
                                                ) : dayFilter.day !== 'all' ? (
                                                    <div className="hub-empty">
                                                        <h3>
                                                            No matching activity for{' '}
                                                            {formatDate(dayFilter.day, { weekday: 'long' })}
                                                        </h3>
                                                        <p>Choose another day or adjust the activity filters.</p>
                                                        <Button
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => dayFilter.setDay('all')}
                                                        >
                                                            Show all days
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    empty
                                                )}
                                            </section>
                                            <aside>
                                                <RepositoryActivity
                                                    onHighlightChange={highlightRepository}
                                                    summary={repositorySummary}
                                                    hasRepositories={state.repositories.some((repo) => !repo.removed)}
                                                />
                                            </aside>
                                        </div>

                                        <footer className="hub-footer">
                                            <span>
                                                <Check size={13} aria-hidden="true" />
                                                {state.lastRefreshed
                                                    ? `Updated ${new Date(state.lastRefreshed).toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                                                    : 'Your local journal'}
                                            </span>
                                        </footer>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
                <div className="hub-sr-only" role="status">
                    {visible.length} activities from {period}
                </div>
                <div className="hub-sr-only" role="status">
                    {onboarding.visibility === 'complete' && !showSetup
                        ? 'Setup complete. Your weekly stats are now available.'
                        : ''}
                </div>
                <HubActivityDialog ref={detailDialog} state={state} onActivity={onActivity} />
            </main>
        </ScrollArea>
    )
}
