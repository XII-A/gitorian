import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Activity, Command, Reply, State } from '../shared/model'
import { localDate, shiftWeek, stateSchema, weekOf } from '../shared/model'
import { hasCachedDetails } from './activity-cache'
import { ActivityChart } from './activity-chart'
import { ActivityHover } from './activity-hover'
import { ActivityRow } from './activity-row'
import landscape from './assets/week-landscape.jpg'
import { actionableSources, activityUpdating, readableError } from './background-work'
import { Alert } from './components/arc/alert/alert'
import { Breadcrumb } from './components/arc/breadcrumb/breadcrumb'
import { Button } from './components/arc/button/button'
import { Combobox } from './components/arc/combobox/combobox'
import { DateRangePicker } from './components/arc/date-range-picker/date-range-picker'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ExpandingSearch } from './components/arc/expanding-search/expanding-search'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { TagInput } from './components/arc/tag-input/tag-input'
import { WorkspaceIcon } from './components/workspace-icon'
import { journalWeek, offsetDay, rangeActivities } from './hub-model'
import { ProjectFilter } from './project-filter'
import type { Citation } from './workspace-draft'
import { WorkspaceDraft } from './workspace-draft'
import { WorkspaceInspector } from './workspace-inspector'
import { activityLink, dateKey, dateValue, filterWorkspaceActivity, formatDay } from './workspace-model'
import { sampleState } from './workspace-sample'

import './workspace.css'

const BrowseHistoryIcon = () => <WorkspaceIcon name="branch" width="14" height="14" />

const ClearHistoryIcon = () => <WorkspaceIcon name="close" width="14" height="14" />

interface Props {
    state: State
    notionConnected: boolean
    run: (command: Command) => Promise<Reply | undefined>
    error: string
    initialWeek: string
    initialActivity?: string
    onBack: (week: string) => void
    onSources: () => void
    onSettings: () => void
}
export const Workspace = ({
    state: realState,
    notionConnected,
    run: realRun,
    error,
    initialWeek,
    initialActivity,
    onBack,
    onSources,
    onSettings
}: Props) => {
    const [week, setWeek] = useState(initialWeek)
    const [sample, setSample] = useState(false)
    const [example, setExample] = useState<State>()
    const examples = useRef(new Map<string, State>())
    const [project, setProject] = useState('all')
    const [branch, setBranch] = useState('all')
    const [kind, setKind] = useState('all')
    const [authors, setAuthors] = useState<string[]>([])
    const activityViewport = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        // A new result set starts at the top before paint. Background refreshes keep their position.
        activityViewport.current?.scrollTo({ behavior: 'instant', top: 0 })
    }, [week, project, branch, kind, authors])
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [inspectionTab, setInspectionTab] = useState<'diff' | 'details'>('diff')
    const [publishTarget, setPublishTarget] = useState<HTMLElement | null>(null)
    const [selectedId, setSelectedId] = useState(initialActivity)
    const [detailBusy, setDetailBusy] = useState(false)
    const [detailError, setDetailError] = useState('')
    const [refreshing, setRefreshing] = useState(false)
    const [focus, setFocus] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const historyButton = useRef<HTMLButtonElement>(null)
    const [historyMode, setHistoryMode] = useState('introduced')
    const [historyError, setHistoryError] = useState('')
    const [historyBusy, setHistoryBusy] = useState(false)
    const [canCite, setCanCite] = useState(false)
    const [citation, setCitation] = useState<Citation>()
    const [notice, setNotice] = useState('')
    const [detached, setDetached] = useState<string>()
    const channel = useRef<BroadcastChannel | undefined | null>(null)
    const requestId = useRef(0)
    const getSample = useCallback((sampleWeek: string) => {
        let value = examples.current.get(sampleWeek)
        if (!value) {
            value = sampleState(sampleWeek)
            try {
                const raw = localStorage.getItem(`weekly-j:sample-state:${sampleWeek}`)
                const cached = raw ? stateSchema.safeParse(JSON.parse(raw)) : undefined
                if (
                    cached?.success &&
                    cached.data.activities.every((item) => item.id.startsWith(`sample:${sampleWeek}:`))
                ) {
                    value = cached.data
                }
            } catch {
                /* Sample data can still be used without browser storage. */
            }
            examples.current.set(sampleWeek, value)
        }
        return value
    }, [])
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('data') !== 'sample') {
            return
        }
        setExample(getSample(initialWeek))
        setSample(true)
    }, [getSample, initialWeek])
    useEffect(() => {
        if (!sample) {
            return
        }
        const value = getSample(week)
        setExample(value)
        setSelectedId(value.activities[0]?.id)
    }, [sample, week, getSample])
    const state = sample ? (example ?? sampleState(week)) : realState
    const run = useCallback(
        async (command: Command): Promise<Reply | undefined> => {
            if (!sample) {
                return await realRun(command)
            }
            const current = examples.current.get(week)
            if (!current) {
                return undefined
            }
            const next = structuredClone(current)
            switch (command.type) {
                case 'draft': {
                    const index = next.drafts.findIndex((draft) => draft.id === command.draft.id)
                    if (index !== -1) {
                        next.drafts[index] = command.draft
                    }
                    break
                }
                case 'newDraft': {
                    next.drafts.push({
                        body: { content: [{ type: 'paragraph' }], type: 'doc' },
                        id: `sample-draft-${crypto.randomUUID()}`,
                        selections: [],
                        title: '',
                        updatedAt: new Date().toISOString(),
                        week: command.week
                    })
                    break
                }
                case 'publish': {
                    const draft = next.drafts.find((item) => item.id === command.draftId)
                    if (draft) {
                        draft.publishedEntryId = `sample-entry-${draft.id}`
                        next.entries.push({
                            body: draft.body,
                            date: draft.week,
                            id: draft.publishedEntryId,
                            refreshedAt: new Date().toISOString(),
                            title: draft.title,
                            url: 'https://notion.so/example'
                        })
                    }
                    break
                }
                case 'open': {
                    setNotice('Sample links are examples and cannot open real activity.')
                    break
                }
                default: {
                    break
                }
            }
            examples.current.set(week, next)
            try {
                localStorage.setItem(`weekly-j:sample-state:${week}`, JSON.stringify(next))
            } catch {
                setNotice('Sample changes are kept for this session. Local storage is unavailable.')
            }
            setExample(next)
            return { connections: { github: false, notion: false, protectedStorage: false }, state: next }
        },
        [realRun, sample, week]
    )
    const inspect = useCallback(
        async (item: Activity, tab: 'diff' | 'details' = 'diff') => {
            const id = (requestId.current += 1)
            setSelectedId(item.id)
            setInspectionTab(tab)
            setDetailError('')
            if (sample || hasCachedDetails(realState, item, tab === 'details' ? 'files' : 'diff')) {
                setDetailBusy(false)
                return
            }
            setDetailBusy(true)
            const reply = await realRun({
                activityId: item.id,
                content: tab === 'details' ? 'files' : 'diff',
                type: 'details'
            })
            if (requestId.current !== id) {
                return
            }
            if (!reply || reply.detailError) {
                setDetailError(reply?.detailError ?? 'Could not load these changes. Retry loading the activity.')
            }
            setDetailBusy(false)
        },
        [sample, realRun, realState]
    )
    const initialInspected = useRef(false)
    useEffect(() => {
        if (!initialActivity || initialInspected.current) {
            return
        }
        const activity = realState.activities.find((item) => item.id === initialActivity)
        if (activity) {
            initialInspected.current = true
            void inspect(activity)
        }
    }, [initialActivity, realState.activities, inspect])
    const selected = state.activities.find((item) => item.id === selectedId)
    const items = useMemo(() => rangeActivities(state, week, offsetDay(week, 6)), [state, week])
    const visible = useMemo(
        () => filterWorkspaceActivity(state, week, { authors, branch, kind, project, search: '' }),
        [state, week, project, branch, kind, authors]
    )
    const currentWeek = weekOf(new Date(), state.settings)
    const cite = useCallback(
        (activity: Activity) => {
            if (!canCite) {
                setNotice('Open or create an editable draft to add a citation.')
                return
            }
            setCitation({ id: Date.now(), title: activity.title, url: activityLink(activity, state) })
        },
        [canCite, state]
    )
    useEffect(() => {
        const bus = new BroadcastChannel('weekly-j-workspace-reference')
        channel.current = bus
        bus.onmessage = (event: MessageEvent<unknown>) => {
            const { data } = event
            if (!data || typeof data !== 'object' || !('activityId' in data) || typeof data.activityId !== 'string') {
                return
            }
            const activity = state.activities.find((item) => item.id === data.activityId)
            if (!activity || !('type' in data)) {
                return
            }
            if (data.type === 'cite') {
                const accepted =
                    canCite && rangeActivities(state, week, offsetDay(week, 6)).some((item) => item.id === activity.id)
                if (accepted) {
                    cite(activity)
                }
                bus.postMessage({ accepted, activityId: activity.id, type: 'citation-result' })
            }
            if (data.type === 'dock') {
                setDetached(undefined)
                setSelectedId(activity.id)
            }
        }
        return () => {
            bus.close()
            channel.current = undefined
        }
    }, [state, week, cite, canCite])
    const changeWeek = (value: string) => {
        if (sample) {
            setExample(getSample(value))
        }
        setWeek(value)
        setSelectedId(undefined)
        setDetached(undefined)
        setDetailError('')
        setNotice('')
        setCitation(undefined)
        const url = new URL(window.location.href)
        url.searchParams.set('week', value)
        window.history.replaceState({}, '', url)
    }
    const popout = async () => {
        if (!selected) {
            return
        }
        if (navigator.userAgent.includes('Electron/')) {
            const reply = await realRun({ id: selected.id, kind: 'activity', type: 'popout' })
            if (reply) {
                setDetached(selected.id)
            }
        } else {
            const url = new URL(window.location.href)
            url.search = ''
            url.searchParams.set('reference', 'activity')
            url.searchParams.set('id', selected.id)
            const popup = window.open(url, `weekly-j-${selected.id}`, 'popup,width=1400,height=900')
            if (popup) {
                setDetached(selected.id)
            } else {
                setNotice('The browser blocked the window. Allow pop-ups for this app and try again.')
            }
        }
    }
    const refresh = async () => {
        setRefreshing(true)
        await run({ type: 'refresh' })
        setRefreshing(false)
    }
    const browse = async () => {
        if (project === 'all' || branch === 'all') {
            return
        }
        setHistoryBusy(true)
        setHistoryError('')
        const result = await run({
            author: authors,
            branch,
            repositoryId: project,
            since: week,
            type: 'history',
            view: historyMode === 'history' ? 'history' : 'introduced'
        })
        if (!result) {
            setHistoryError('Could not load branch history. Check the repository and try again.')
        }
        setHistoryBusy(false)
        if (result) {
            setHistoryOpen(false)
        }
    }
    const inspector =
        selected && detached !== selected.id ? (
            <WorkspaceInspector
                state={state}
                activity={selected}
                run={run}
                loading={detailBusy}
                error={detailError}
                canCite={canCite}
                initialTab={inspectionTab}
                onCite={() => {
                    cite(selected)
                }}
                onInspect={(item, tab) => {
                    inspect(item, tab)
                }}
                onPopout={popout}
                onClose={() => {
                    setSelectedId(undefined)
                }}
            />
        ) : undefined
    return (
        <main aria-label="Writing workspace" className="writing-workspace" data-layout="three-panes" data-focus={focus}>
            <div className="ws-atmosphere" aria-hidden="true">
                <img src={landscape} alt="" />
            </div>
            <header className="ws-topbar" aria-label="Date range and journal controls">
                <div className="ws-heading">
                    <Breadcrumb
                        ariaLabel="Journal breadcrumb"
                        items={[
                            {
                                label: 'Hub',
                                onClick: () => {
                                    onBack(week)
                                }
                            },
                            { label: 'Weekly entry' }
                        ]}
                    />
                </div>
                <div className="ws-date">
                    <DateRangePicker
                        label="Week"
                        weekStartsOn={state.settings.weekStart}
                        value={{ end: dateValue(offsetDay(week, 6)), start: dateValue(week) }}
                        fixedRangeDays={7}
                        normalizeStart={(date) => dateValue(journalWeek(dateKey(date), state.settings.weekStart))}
                        onChange={(range) => {
                            changeWeek(dateKey(range.start))
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
                <div className="ws-utilities">
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
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={refresh}
                        loading={refreshing || activityUpdating(state)}
                        aria-label="Refresh activity"
                        title="Refresh activity"
                    >
                        <WorkspaceIcon name="refresh" width={16} height={16} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setFocus((value) => !value)
                        }}
                        aria-label={focus ? 'Show activity panels' : 'Focus on writing'}
                        aria-pressed={focus}
                        title={focus ? 'Show activity panels' : 'Focus on writing'}
                    >
                        <WorkspaceIcon name="focus" width={17} height={17} />
                    </Button>
                    <div className="ws-publish" ref={setPublishTarget} />
                </div>
            </header>
            {notice && (
                <output className="ws-action-notice" style={{ display: 'block' }}>
                    <span>{notice}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Dismiss notification"
                        onClick={() => {
                            setNotice('')
                        }}
                    >
                        <WorkspaceIcon name="close" />
                    </Button>
                </output>
            )}
            {!sample && error && (
                <Alert tone="danger" title="Activity could not be refreshed">
                    <p>{readableError(error)}</p>
                    <Button variant="secondary" size="sm" onClick={refresh}>
                        Retry refresh
                    </Button>
                </Alert>
            )}
            <div className="ws-frame" data-inspecting={!!inspector}>
                <aside className="ws-activity" aria-label="Weekly activity">
                    <div className="ws-activity-intro" data-searching={searchExpanded}>
                        <div className="ws-activity-label">
                            <h2>Activity</h2>
                            <span>
                                {items.length} events · {new Set(items.map((item) => item.repositoryId)).size} projects
                            </span>
                        </div>
                        <ExpandingSearch
                            className="ws-activity-search"
                            label="Search activity"
                            placeholder="Find a change…"
                            expandedWidth="container"
                            onExpandedChange={setSearchExpanded}
                            items={items.map((item) => ({
                                group: state.repositories.find((repo) => repo.id === item.repositoryId)?.name,
                                icon: <WorkspaceIcon name={item.kind === 'commit' ? 'commit' : 'pr'} />,
                                id: item.id,
                                keywords: [item.sha ?? '', item.description, ...item.branches],
                                meta: `${formatDay(localDate(new Date(item.date), state.settings.timezone))} · ${item.sha?.slice(0, 7) ?? item.kind}`,
                                title: item.title
                            }))}
                            suggestions={items.slice(0, 4).map((item) => ({
                                id: item.id,
                                meta: state.repositories.find((repo) => repo.id === item.repositoryId)?.name,
                                title: item.title
                            }))}
                            suggestionsLabel="This week"
                            onSelect={(result) => {
                                const item = items.find((activity) => activity.id === result.id)
                                if (item) {
                                    void inspect(item, 'details')
                                }
                            }}
                        />
                    </div>
                    <ActivityChart
                        activities={items}
                        timezone={state.settings.timezone}
                        week={week}
                        className="ws-week-chart"
                    />
                    <fieldset className="ws-activity-filters" aria-label="Filter activity">
                        {(['all', 'commit', 'pr'] as const).map((value) => (
                            <Button
                                key={value}
                                variant="ghost"
                                size="sm"
                                className="ws-filter-chip"
                                animateContent={false}
                                aria-pressed={kind === value}
                                onClick={() => {
                                    setKind(value)
                                }}
                            >
                                {(() => {
                                    if (value === 'all') {
                                        return 'All'
                                    }
                                    if (value === 'commit') {
                                        return 'Commits'
                                    }
                                    return 'PRs & reviews'
                                })()}
                                <span>
                                    {
                                        items.filter(
                                            (item) =>
                                                (project === 'all' || item.repositoryId === project) &&
                                                (value === 'all' ||
                                                    (value === 'commit'
                                                        ? item.kind === 'commit'
                                                        : item.kind !== 'commit'))
                                        ).length
                                    }
                                </span>
                            </Button>
                        ))}
                        <ProjectFilter
                            repositories={state.repositories}
                            value={project}
                            onValueChange={(value) => {
                                setProject(value)
                                setBranch('all')
                            }}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            className="ws-filter-chip ws-history-chip"
                            animateContent={false}
                            ref={historyButton}
                            onClick={() => {
                                if (branch !== 'all' || authors.length > 0) {
                                    setProject('all')
                                    setBranch('all')
                                    setAuthors([])
                                    setHistoryMode('introduced')
                                    setHistoryError('')
                                } else {
                                    setHistoryError('')
                                    setHistoryOpen(true)
                                }
                            }}
                            aria-label={(() => {
                                if (branch !== 'all' || authors.length > 0) {
                                    if (branch === 'all') {
                                        return 'Clear branch history filters'
                                    }
                                    return `Clear ${branch} history filters`
                                }
                                return 'Browse branch history'
                            })()}
                            title={(() => {
                                if (branch !== 'all' || authors.length > 0) {
                                    if (branch === 'all') {
                                        return 'Clear branch history filters'
                                    }
                                    return `Clear ${branch} history filters`
                                }
                                return 'Browse branch history'
                            })()}
                            aria-pressed={branch !== 'all' || authors.length > 0}
                        >
                            {branch !== 'all' || authors.length > 0 ? (
                                <>
                                    {branch === 'all' ? 'History filters' : branch}
                                    <ClearHistoryIcon />
                                </>
                            ) : (
                                <BrowseHistoryIcon />
                            )}
                        </Button>
                    </fieldset>
                    <ScrollArea
                        className="ws-activity-scroll"
                        viewportClassName="ws-activity-viewport"
                        viewportRef={activityViewport}
                        label="Weekly activity list"
                        fade={16}
                    >
                        <ActivityHover>
                            {visible.length ? (
                                [
                                    ...new Set(
                                        visible.map((item) => localDate(new Date(item.date), state.settings.timezone))
                                    )
                                ].map((day) => (
                                    <section className="ws-day-group" key={day}>
                                        <header>
                                            <h3>{formatDay(day, { weekday: 'long' })}</h3>
                                            <span>{formatDay(day)}</span>
                                        </header>
                                        <ul className="activity-row-list">
                                            {visible
                                                .filter(
                                                    (item) =>
                                                        localDate(new Date(item.date), state.settings.timezone) === day
                                                )
                                                .map((item, index, dayItems) => (
                                                    <li key={item.id}>
                                                        <ActivityRow
                                                            activity={item}
                                                            repositoryName={
                                                                state.repositories.find(
                                                                    (repo) => repo.id === item.repositoryId
                                                                )?.name ?? 'Repository'
                                                            }
                                                            connected={index < dayItems.length - 1}
                                                            className="ws-activity-row"
                                                            aria-pressed={selectedId === item.id}
                                                            draggable={canCite}
                                                            onDragStart={(event) => {
                                                                event.dataTransfer.setData(
                                                                    'application/x-weekly-j-activity',
                                                                    item.id
                                                                )
                                                                event.dataTransfer.effectAllowed = 'copy'
                                                            }}
                                                            onClick={() => {
                                                                inspect(item)
                                                            }}
                                                        />
                                                    </li>
                                                ))}
                                        </ul>
                                    </section>
                                ))
                            ) : (
                                <div className="ws-activity-empty">
                                    <h3>{items.length ? 'No matching changes' : 'A quiet week so far.'}</h3>
                                    <p>
                                        {items.length
                                            ? 'Choose another project or clear the activity filters.'
                                            : 'Choose another week or refresh your repositories. You can write at any time.'}
                                    </p>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => {
                                            setProject('all')
                                            setBranch('all')
                                            setKind('all')
                                            if (!items.length) {
                                                void refresh()
                                            }
                                        }}
                                    >
                                        {items.length ? 'Clear activity filters' : 'Refresh activity'}
                                    </Button>
                                </div>
                            )}
                        </ActivityHover>
                    </ScrollArea>
                    {detached && (
                        <div className="ws-detached-status">
                            <WorkspaceIcon name="popout" />
                            <span>Diff open in another window.</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    channel.current?.postMessage({ activityId: detached, type: 'close' })
                                    setDetached(undefined)
                                }}
                            >
                                Dock back
                            </Button>
                        </div>
                    )}
                </aside>
                <div
                    className="ws-draft-host"
                    onDragOver={(event) => {
                        if (canCite && event.dataTransfer.types.includes('application/x-weekly-j-activity')) {
                            event.preventDefault()
                        }
                    }}
                    onDrop={(event) => {
                        const item = state.activities.find(
                            (activity) => activity.id === event.dataTransfer.getData('application/x-weekly-j-activity')
                        )
                        if (item && canCite) {
                            event.preventDefault()
                            cite(item)
                        }
                    }}
                >
                    <WorkspaceDraft
                        key={`${sample ? 'sample' : 'real'}:${week}`}
                        state={state}
                        week={week}
                        sample={sample}
                        notionConnected={notionConnected}
                        run={run}
                        citation={citation}
                        publishTarget={publishTarget}
                        onReady={setCanCite}
                        onSettings={onSettings}
                    />
                </div>
                {inspector}
            </div>
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                <DialogContent
                    title="Browse branch history"
                    description="Bring branch work into view. The activity list keeps the selected week."
                    className="ws-dialog"
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        historyButton.current?.focus()
                    }}
                >
                    <ScrollArea className="ws-dialog-fields" label="Branch history filters" fade={16}>
                        <Combobox
                            label="Project"
                            placeholder="Choose a project"
                            emptyMessage="No projects found"
                            value={project === 'all' ? '' : project}
                            onValueChange={(value) => {
                                setProject(value || 'all')
                                setBranch('all')
                            }}
                            options={state.repositories
                                .filter((repo) => !repo.removed)
                                .map((repo) => ({ keywords: [repo.path], label: repo.name, value: repo.id }))}
                        />
                        <Combobox
                            label="Branch"
                            placeholder="Choose a branch"
                            emptyMessage="No branches found. Refresh activity to update branches."
                            disabled={project === 'all'}
                            description={project === 'all' ? 'Choose a project first.' : undefined}
                            value={branch === 'all' ? '' : branch}
                            onValueChange={(value) => {
                                setBranch(value || 'all')
                            }}
                            options={(state.repositories.find((repo) => repo.id === project)?.branches ?? []).map(
                                (name) => ({
                                    label: name,
                                    value: name
                                })
                            )}
                        />
                        <SegmentedControl
                            label="Branch view"
                            fullWidth
                            value={historyMode}
                            onValueChange={setHistoryMode}
                            options={[
                                { label: 'Introduced on branch', value: 'introduced' },
                                { label: 'Full history', value: 'history' }
                            ]}
                        />
                        <TagInput
                            label="Authors"
                            placeholder="All authors"
                            value={authors}
                            onValueChange={setAuthors}
                            description="Add author names or emails. Press Enter or comma to add each author."
                        />
                        {historyError && (
                            <Alert tone="danger" title="Branch history could not be loaded">
                                {historyError}
                            </Alert>
                        )}
                        <Button loading={historyBusy} disabled={project === 'all' || branch === 'all'} onClick={browse}>
                            Load branch history
                        </Button>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </main>
    )
}
