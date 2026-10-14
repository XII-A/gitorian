import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import { BookOpen, Check, GitBranch, GitCommitHorizontal, RefreshCw, Settings2 } from 'lucide-react'
import { useRef, useState } from 'react'

import type { Activity, Command, Reply, State } from '../shared/model'
import { localDate, shiftWeek, weekOf } from '../shared/model'
import { ActivityChart } from './activity-chart'
import { ActivityHover } from './activity-hover'
import { ActivityRow } from './activity-row'
import landscape from './assets/week-landscape.jpg'
import { actionableSources, activityUpdating, readableError } from './background-work'
import { Alert } from './components/arc/alert/alert'
import { Button } from './components/arc/button/button'
import { DateRangePicker } from './components/arc/date-range-picker/date-range-picker'
import type { HubActivityDialogHandle } from './hub-activity-dialog'
import { HubActivityDialog } from './hub-activity-dialog'
import { journalWeek, offsetDay, rangeActivities } from './hub-model'

import './hub.css'
import { ProjectFilter } from './project-filter'

const dateValue = (value: string) => new Date(`${value}T12:00:00`)
const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const formatDate = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
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
}

export const WeeklyHub = ({ state, run, error, onWrite, onSettings, onSources, onActivity, initialWeek }: Props) => {
    const currentWeek = weekOf(new Date(), state.settings)
    const [start, setStart] = useState(initialWeek || currentWeek)
    const end = offsetDay(start, 6)
    const [project, setProject] = useState('all')
    const [tab, setTab] = useState<'all' | 'commit' | 'pr'>('all')
    const detailDialog = useRef<HubActivityDialogHandle>(null)
    const [busy, setBusy] = useState(false)
    const items = rangeActivities(state, start, end)
    const commits = items.filter((item) => item.kind === 'commit')
    const prs = items.filter((item) => item.kind !== 'commit')
    const repos = state.repositories.filter((repo) => items.some((item) => item.repositoryId === repo.id))
    const days = [...new Set(items.map((item) => localDate(new Date(item.date), state.settings.timezone)))]
    const projectItems = project === 'all' ? items : items.filter((item) => item.repositoryId === project)
    const visible = projectItems.filter(
        (item) => tab === 'all' || (tab === 'commit' ? item.kind === 'commit' : item.kind !== 'commit')
    )
    const period = `${formatDate(start)} – ${formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    const row = (item: Activity, index: number, dayItems: Activity[]) => (
        <ActivityRow
            activity={item}
            repositoryName={state.repositories.find((repo) => repo.id === item.repositoryId)?.name ?? 'Repository'}
            connected={index < dayItems.length - 1}
            className={`hub-activity hub-kind-${item.kind}`}
            key={item.id}
            onClick={() => detailDialog.current?.open(item)}
        />
    )
    const filters = (
        <div className="hub-filters" role="group" aria-label="Filter activity">
            {(['all', 'commit', 'pr'] as const).map((value) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="hub-filter-chip"
                    key={value}
                    aria-pressed={tab === value}
                    onClick={() => {
                        setTab(value)
                    }}
                >
                    {(() => {
                        if (value === 'all') {
                            return 'All activity'
                        }
                        if (value === 'commit') {
                            return 'Commits'
                        }
                        return 'Pull requests & reviews'
                    })()}
                    <span>
                        {
                            projectItems.filter(
                                (item) =>
                                    value === 'all' ||
                                    (value === 'commit' ? item.kind === 'commit' : item.kind !== 'commit')
                            ).length
                        }
                    </span>
                </Button>
            ))}
            <ProjectFilter repositories={state.repositories} value={project} onValueChange={setProject} />
        </div>
    )
    const empty = (
        <div className="hub-empty">
            <GitCommitHorizontal size={26} aria-hidden="true" />
            <h3>{items.length ? 'No matching activity' : 'Room for a fresh start.'}</h3>
            <p>
                {(() => {
                    if (items.length) {
                        return 'Choose another activity filter to see your work.'
                    }
                    if (state.repositories.some((repo) => !repo.removed)) {
                        return 'No activity in this date range. Refresh your repositories or choose another range.'
                    }
                    return 'Connect a repository to gather your commits and pull requests here.'
                })()}
            </p>
            <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                    ;(() => {
                        if (items.length) {
                            return (() => {
                                setTab('all')
                                setProject('all')
                            })()
                        }
                        if (state.repositories.some((repo) => !repo.removed)) {
                            return
                        }
                        return onSettings()
                    })()
                }}
            >
                {(() => {
                    if (items.length) {
                        return 'Show all activity'
                    }
                    if (state.repositories.some((repo) => !repo.removed)) {
                        return 'Refresh activity'
                    }
                    return 'Connect a repository'
                })()}
            </Button>
        </div>
    )
    const refresh = async () => {
        setBusy(true)
        try {
            await run({ type: 'refresh' })
        } finally {
            setBusy(false)
        }
    }
    const chart = (
        <ActivityChart activities={items} week={start} timezone={state.settings.timezone} className="hub-chart" />
    )
    const stats = (
        <div className="hub-stats">
            <div>
                <strong>{commits.length}</strong>
                <span>commits</span>
            </div>
            <div>
                <strong>{prs.length}</strong>
                <span>PRs & reviews</span>
            </div>
            <div>
                <strong>{repos.length}</strong>
                <span>repositories</span>
            </div>
            <div>
                <strong>{days.length}</strong>
                <span>active days</span>
            </div>
        </div>
    )
    return (
        <main className="weekly-hub hub-thread">
            <a className="hub-skip" href="#hub-content">
                Skip to weekly overview
            </a>
            <div className="hub-atmosphere" aria-hidden="true">
                <img src={landscape} alt="" />
            </div>
            <nav className="hub-topbar" aria-label="Date range and journal controls">
                <div className="hub-date-controls">
                    <DateRangePicker
                        label="Week"
                        weekStartsOn={state.settings.weekStart}
                        value={{ end: dateValue(end), start: dateValue(start) }}
                        fixedRangeDays={7}
                        normalizeStart={(date) => dateValue(journalWeek(dateKey(date), state.settings.weekStart))}
                        onChange={(range) => {
                            setStart(dateKey(range.start))
                        }}
                        presets={[0, 1, 2, 3, 4].map((weeksAgo) => ({
                            label: (() => {
                                if (weeksAgo === 0) {
                                    return 'This week'
                                }
                                if (weeksAgo === 1) {
                                    return 'Last week'
                                }
                                return `${weeksAgo} weeks ago`
                            })(),
                            range: () => ({
                                end: dateValue(offsetDay(shiftWeek(currentWeek, -weeksAgo), 6)),
                                start: dateValue(shiftWeek(currentWeek, -weeksAgo))
                            })
                        }))}
                    />
                </div>
                <div className="hub-utilities">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            onWrite(start)
                        }}
                        aria-label="Open journal"
                        title="Open journal"
                    >
                        <BookOpen size={17} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        loading={busy || activityUpdating(state)}
                        onClick={() => {
                            refresh()
                        }}
                        aria-label="Refresh activity"
                        title="Refresh activity"
                    >
                        <RefreshCw size={16} />
                    </Button>
                    {actionableSources(state).length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            data-source-status
                            onClick={onSources}
                            aria-label="Activity sources"
                            title="Activity sources"
                        >
                            <StackIcon size={18} weight="bold" aria-hidden="true" />
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={onSettings} aria-label="Open settings" title="Settings">
                        <Settings2 size={17} />
                    </Button>
                </div>
            </nav>
            <div className="hub-content" id="hub-content">
                {error && (
                    <Alert tone="danger" title="Activity could not be refreshed">
                        <p>{readableError(error)}</p>
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={busy || activityUpdating(state)}
                            onClick={() => {
                                refresh()
                            }}
                        >
                            Refresh activity
                        </Button>
                    </Alert>
                )}
                <header className="hub-hero">
                    <p className="hub-period">{period}</p>
                    <h1>What mattered this week?</h1>
                    <p className="hub-hero-description">
                        Review your activity, then capture progress, decisions, and anything you want to follow up on.
                    </p>
                    <div className="hub-hero-action">
                        <Button
                            onClick={() => {
                                onWrite(start)
                            }}
                        >
                            Write this week’s entry →
                        </Button>
                    </div>
                </header>

                <div className="hub-thread-summary">
                    {stats}
                    {chart}
                </div>
                <div className="hub-thread-layout">
                    <section id="hub-activity" className="hub-timeline">
                        <div className="hub-section-heading">
                            <h2>The days behind the work</h2>
                        </div>
                        {filters}
                        {visible.length ? (
                            <ActivityHover>
                                {[
                                    ...new Set(
                                        visible.map((item) => localDate(new Date(item.date), state.settings.timezone))
                                    )
                                ].map((day) => (
                                    <section className="hub-day" key={day}>
                                        <div className="hub-day-date">
                                            <strong>{formatDate(day, { weekday: 'long' })}</strong>
                                            <span>{formatDate(day)}</span>
                                        </div>
                                        <div className="hub-day-work activity-row-list">
                                            {visible
                                                .filter(
                                                    (item) =>
                                                        localDate(new Date(item.date), state.settings.timezone) === day
                                                )
                                                .map(row)}
                                        </div>
                                    </section>
                                ))}
                            </ActivityHover>
                        ) : (
                            empty
                        )}
                    </section>
                    <aside>
                        <section className="hub-project-summary">
                            <h2>Across your projects</h2>
                            {repos.length ? (
                                repos.map((repo) => (
                                    <div className="hub-project-line" key={repo.id}>
                                        <GitBranch size={15} aria-hidden="true" />
                                        <span>{repo.name}</span>
                                        <strong>{items.filter((item) => item.repositoryId === repo.id).length}</strong>
                                    </div>
                                ))
                            ) : (
                                <p>Projects will appear as you work.</p>
                            )}
                        </section>
                    </aside>
                </div>
                <footer className="hub-footer">
                    <span>
                        <Check size={13} aria-hidden="true" />
                        {state.lastRefreshed
                            ? `Updated ${new Date(state.lastRefreshed).toLocaleTimeString('en-US', { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short' })}`
                            : 'Your local journal'}
                    </span>
                    <span>No rush. It’s your story.</span>
                </footer>
            </div>
            <div className="hub-sr-only" role="status">
                {visible.length} activities from {period}
            </div>
            <HubActivityDialog ref={detailDialog} state={state} onActivity={onActivity} />
        </main>
    )
}
