import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { ActivityFilterStrip } from './ActivityFilterStrip'
import { AppUpdateButton } from './AppUpdates'
import { ActivitySourcesButton } from './ActivitySourcesButton'
import { Alert } from './components/arc/alert/alert'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { localDate, shiftWeek, weekOf } from '../shared/model'
import { offsetDay, journalWeek, rangeActivities } from './hub-model'
import { Button } from './components/arc/button/button'
import { DateRangePicker } from './components/arc/date-range-picker/date-range-picker'
import { Combobox } from './components/arc/combobox/combobox'
import { TagInput } from './components/arc/tag-input/tag-input'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { WorkspaceDraft } from './WorkspaceDraft'
import type { Citation } from './WorkspaceDraft'
import { WorkspaceInspector } from './WorkspaceInspector'
import { activityLink, dateKey, dateValue, filterWorkspaceActivity, formatDay } from './workspace-model'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { ExpandingSearch } from './components/arc/expanding-search/expanding-search'
import { ActivityChart } from './ActivityChart'
import { WorkspaceActivityList } from './WorkspaceActivityList'
import { ActivityDayFilter, useActivityDays } from './ActivityDays'
import { ProjectFilter } from './ProjectFilter'
import { hasCachedDetails } from './activity-cache'
import { Breadcrumb } from './components/arc/breadcrumb/breadcrumb'
import { HeaderAtmosphere } from './HeaderAtmosphere'
import './workspace.css'
import { useActivityRefresh } from './use-activity-refresh'
import { useWeekHistory } from './use-week-history'
import { useWindowHoverExclusion } from './use-window-hover-exclusion'

function BrowseHistoryIcon() {
    return <WorkspaceIcon name="branch" width="14" height="14" />
}

function ClearHistoryIcon() {
    return <WorkspaceIcon name="close" width="14" height="14" />
}

interface Props {
    state: State
    notionConnected: boolean
    run: (command: Command) => Promise<Reply | undefined>
    initialWeek: string
    initialActivity?: string
    initialWrite?: boolean
    onBack: (week: string) => void
    onSources: () => void
    onSettings: () => void
}
export function Workspace({
    state,
    notionConnected,
    run,
    initialWeek,
    initialActivity,
    initialWrite = false,
    onBack,
    onSources,
    onSettings
}: Props) {
    const [week, setWeek] = useState(initialWeek)
    const dayFilter = useActivityDays(week)
    const writingWeek = useRef(initialWrite ? initialWeek : undefined)
    useEffect(() => {
        if (week !== initialWeek) writingWeek.current = undefined
    }, [week, initialWeek])
    const breadcrumb = useRef<HTMLDivElement>(null)
    useWindowHoverExclusion(breadcrumb)
    const [project, setProject] = useState('all')
    const [branch, setBranch] = useState('all')
    const [kind, setKind] = useState('all')
    const [authors, setAuthors] = useState<string[]>([])
    const activityViewport = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        // A new result set starts at the top before paint. Background refreshes keep their position.
        activityViewport.current?.scrollTo({ top: 0, behavior: 'instant' })
    }, [week, project, branch, kind, authors, dayFilter.day])
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [inspectionTab, setInspectionTab] = useState<'diff' | 'details'>('details')
    const [publishTarget, setPublishTarget] = useState<HTMLElement | null>(null)
    const [selectedId, setSelectedId] = useState(initialActivity)
    const [detailBusy, setDetailBusy] = useState(false)
    const [detailError, setDetailError] = useState('')
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
    const channel = useRef<BroadcastChannel | undefined>(undefined)
    const requestId = useRef(0)
    const inspectionState = useRef(state)
    inspectionState.current = state
    const inspect = useCallback(
        async (item: Activity, tab: 'diff' | 'details' = 'details') => {
            const id = ++requestId.current
            setSelectedId(item.id)
            setInspectionTab(tab)
            setDetailError('')
            if (hasCachedDetails(inspectionState.current, item, tab === 'details' ? 'files' : 'diff')) {
                setDetailBusy(false)
                return
            }
            setDetailBusy(true)
            const reply = await run({
                type: 'details',
                activityId: item.id,
                content: tab === 'details' ? 'files' : 'diff'
            })
            if (requestId.current !== id) return
            if (!reply || reply.detailError)
                setDetailError(reply?.detailError ?? 'Could not load these changes. Retry loading the activity.')
            setDetailBusy(false)
        },
        [run]
    )
    const initialInspected = useRef(false)
    useEffect(() => {
        if (!initialActivity || initialInspected.current) return
        const activity = state.activities.find((item) => item.id === initialActivity)
        if (activity) {
            dayFilter.setDay(localDate(new Date(activity.date), state.settings.timezone))
            initialInspected.current = true
            void inspect(activity)
        }
    }, [initialActivity, state.activities, inspect, dayFilter, state.settings.timezone])
    const selected = state.activities.find((item) => item.id === selectedId)
    const activityState = useMemo(
        () => ({
            activities: state.activities,
            repositories: state.repositories,
            settings: { timezone: state.settings.timezone }
        }),
        [state.activities, state.repositories, state.settings.timezone]
    )
    const items = useMemo(() => rangeActivities(activityState, week, offsetDay(week, 6)), [activityState, week])
    const allItems = useMemo(
        () => rangeActivities(activityState, week, offsetDay(week, 6), true),
        [activityState, week]
    )
    const searchItems = useMemo(
        () =>
            searchExpanded
                ? items.map((item) => ({
                      id: item.id,
                      title: item.title,
                      group: state.repositories.find((repo) => repo.id === item.repositoryId)?.name,
                      meta: `${formatDay(localDate(new Date(item.date), state.settings.timezone))} · ${item.sha?.slice(0, 7) ?? item.kind}`,
                      keywords: [item.sha ?? '', item.description, ...item.branches],
                      icon: <WorkspaceIcon name={item.kind === 'commit' ? 'commit' : 'change-request'} />
                  }))
                : [],
        [searchExpanded, items, state.repositories, state.settings.timezone]
    )
    const visible = useMemo(
        () => filterWorkspaceActivity(activityState, week, { project, branch, kind, authors, search: '' }),
        [activityState, week, project, branch, kind, authors]
    )
    const currentWeek = weekOf(new Date(), state.settings)
    const cite = useCallback(
        (activity: Activity) => {
            if (!canCite) {
                setNotice('Open or create an editable draft to add a citation.')
                return
            }
            setCitation({
                id: Date.now(),
                title: activity.sha ? `${activity.title} (${activity.sha.slice(0, 7)})` : activity.title,
                url: activityLink(activity, state)
            })
        },
        [canCite, state]
    )
    useEffect(() => {
        const bus = new BroadcastChannel('gitorian-workspace-reference')
        channel.current = bus
        bus.onmessage = (event: MessageEvent<unknown>) => {
            const data = event.data
            if (!data || typeof data !== 'object' || !('activityId' in data) || typeof data.activityId !== 'string')
                return
            const activity = state.activities.find((item) => item.id === data.activityId)
            if (!activity || !('type' in data)) return
            if (data.type === 'cite') {
                const accepted =
                    canCite && rangeActivities(state, week, offsetDay(week, 6)).some((item) => item.id === activity.id)
                if (accepted) cite(activity)
                bus.postMessage({ type: 'citation-result', activityId: activity.id, accepted })
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
        if (!selected) return
        if (navigator.userAgent.includes('Electron/')) {
            const reply = await run({ type: 'popout', kind: 'activity', id: selected.id })
            if (reply) setDetached(selected.id)
        } else {
            const url = new URL(window.location.href)
            url.search = ''
            url.searchParams.set('reference', 'activity')
            url.searchParams.set('id', selected.id)
            const popup = window.open(url, `gitorian-${selected.id}`, 'popup,width=1400,height=900')
            if (popup) setDetached(selected.id)
            else setNotice('The browser blocked the window. Allow pop-ups for this app and try again.')
        }
    }
    const { refresh, refreshing } = useActivityRefresh(run, week, offsetDay(week, 6), state.settings.timezone)
    const loadingWeek = useWeekHistory(state, run, week)
    const emptyActivityAction = useCallback(() => {
        dayFilter.setDay('all')
        setProject('all')
        setBranch('all')
        setKind('all')
        setAuthors([])
        if (!items.length) void refresh()
    }, [items.length, refresh, dayFilter])
    const browse = async () => {
        if (project === 'all' || branch === 'all') return
        setHistoryBusy(true)
        setHistoryError('')
        const result = await run({
            type: 'history',
            repositoryId: project,
            branch,
            view: historyMode === 'history' ? 'history' : 'introduced',
            author: authors,
            since: week
        })
        if (!result) setHistoryError('Could not load branch history. Check the repository and try again.')
        setHistoryBusy(false)
        if (result) setHistoryOpen(false)
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
                onCite={() => cite(selected)}
                onInspect={(item, tab) => void inspect(item, tab)}
                onPopout={popout}
                onClose={() => setSelectedId(undefined)}
            />
        ) : undefined
    return (
        <WorkspaceContextMenu>
            <main
                aria-label="Writing workspace"
                className="writing-workspace"
                data-layout="three-panes"
                data-focus={focus}
            >
                <HeaderAtmosphere surface="workspace" />
                <header className="ws-topbar" aria-label="Date range and journal controls">
                    <div className="ws-heading">
                        <div ref={breadcrumb}>
                            <Breadcrumb
                                ariaLabel="Journal breadcrumb"
                                items={[{ label: 'Hub', onClick: () => onBack(week) }, { label: 'Weekly entry' }]}
                            />
                        </div>
                    </div>
                    <div className="ws-date">
                        <DateRangePicker
                            label="Week"
                            weekStartsOn={state.settings.weekStart}
                            value={{ start: dateValue(week), end: dateValue(offsetDay(week, 6)) }}
                            fixedRangeDays={7}
                            normalizeStart={(date) => dateValue(journalWeek(dateKey(date), state.settings.weekStart))}
                            onChange={(range) => changeWeek(dateKey(range.start))}
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
                    <div className="ws-utilities">
                        <ActivitySourcesButton state={state} onClick={onSources} />
                        <AppUpdateButton />

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={refresh}
                            loading={refreshing || loadingWeek}
                            aria-label="Refresh activity"
                            title="Refresh activity"
                        >
                            <WorkspaceIcon name="refresh" width={16} height={16} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFocus((value) => !value)}
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
                    <div className="ws-action-notice" role="status">
                        <span>{notice}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Dismiss notification"
                            onClick={() => setNotice('')}
                        >
                            <WorkspaceIcon name="close" />
                        </Button>
                    </div>
                )}
                <div className="ws-frame" data-inspecting={!!inspector}>
                    <aside className="ws-activity" aria-label="Weekly activity">
                        <div className="ws-activity-intro" data-searching={searchExpanded}>
                            <div className="ws-activity-label">
                                <h2>Activity</h2>
                                <span>
                                    {items.length} events · {new Set(items.map((item) => item.repositoryId)).size}{' '}
                                    projects
                                </span>
                            </div>
                            <ExpandingSearch
                                className="ws-activity-search"
                                label="Search activity"
                                placeholder="Find a change…"
                                expandedWidth="container"
                                onExpandedChange={setSearchExpanded}
                                items={searchItems}
                                suggestions={items.slice(0, 4).map((item) => ({
                                    id: item.id,
                                    title: item.title,
                                    meta: state.repositories.find((repo) => repo.id === item.repositoryId)?.name
                                }))}
                                suggestionsLabel="This week"
                                onSelect={(result) => {
                                    const item = items.find((activity) => activity.id === result.id)
                                    if (item) {
                                        dayFilter.setDay(localDate(new Date(item.date), state.settings.timezone))
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
                        <ActivityFilterStrip className="ws-activity-filters">
                            {(['all', 'commit', 'change-request'] as const).map((value) => (
                                <Button
                                    key={value}
                                    variant="ghost"
                                    size="sm"
                                    className="ws-filter-chip"
                                    animateContent={false}
                                    aria-pressed={kind === value}
                                    onClick={() => setKind(value)}
                                >
                                    {value === 'all' ? 'All' : value === 'commit' ? 'Commits' : 'Requests & reviews'}
                                    <span>
                                        {
                                            allItems.filter(
                                                (item) =>
                                                    (project === 'all' || item.repositoryId === project) &&
                                                    (dayFilter.day === 'all' ||
                                                        localDate(new Date(item.date), state.settings.timezone) ===
                                                            dayFilter.day) &&
                                                    !item.previousSource &&
                                                    (value === 'all' ||
                                                        (value === 'commit'
                                                            ? item.kind === 'commit'
                                                            : item.kind !== 'commit'))
                                            ).length
                                        }
                                    </span>
                                </Button>
                            ))}
                            <ActivityDayFilter week={week} value={dayFilter.day} onValueChange={dayFilter.setDay} />
                            <div className="ws-filter-scope">
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
                                    contentLayout="stack"
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
                                    aria-label={
                                        branch !== 'all' || authors.length > 0
                                            ? branch !== 'all'
                                                ? `Clear ${branch} history filters`
                                                : 'Clear branch history filters'
                                            : 'Browse branch history'
                                    }
                                    title={
                                        branch !== 'all' || authors.length > 0
                                            ? branch !== 'all'
                                                ? `Clear ${branch} history filters`
                                                : 'Clear branch history filters'
                                            : 'Browse branch history'
                                    }
                                    aria-pressed={branch !== 'all' || authors.length > 0}
                                >
                                    <span className="ws-history-content">
                                        {branch !== 'all' || authors.length > 0 ? (
                                            <>
                                                <span className="ws-history-label">
                                                    {branch !== 'all' ? branch : 'History filters'}
                                                </span>
                                                <ClearHistoryIcon />
                                            </>
                                        ) : (
                                            <BrowseHistoryIcon />
                                        )}
                                    </span>
                                </Button>
                            </div>
                        </ActivityFilterStrip>
                        <ScrollArea
                            className="ws-activity-scroll"
                            viewportClassName="ws-activity-viewport"
                            viewportRef={activityViewport}
                            label="Weekly activity list"
                            fade={16}
                        >
                            <WorkspaceActivityList
                                activities={visible}
                                dayFilter={dayFilter}
                                repositories={state.repositories}
                                timezone={state.settings.timezone}
                                selectedId={selectedId}
                                canCite={canCite}
                                onInspect={inspect}
                                hasActivity={items.length > 0}
                                onEmptyAction={emptyActivityAction}
                                refreshing={refreshing || loadingWeek}
                            />
                        </ScrollArea>
                        {detached && (
                            <div className="ws-detached-status">
                                <WorkspaceIcon name="popout" />
                                <span>Diff open in another window.</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        channel.current?.postMessage({ type: 'close', activityId: detached })
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
                            if (canCite && event.dataTransfer.types.includes('application/x-gitorian-activity'))
                                event.preventDefault()
                        }}
                        onDrop={(event) => {
                            const item = state.activities.find(
                                (activity) =>
                                    activity.id === event.dataTransfer.getData('application/x-gitorian-activity')
                            )
                            if (item && canCite) {
                                event.preventDefault()
                                cite(item)
                            }
                        }}
                    >
                        <WorkspaceDraft
                            key={`${state.restoreId ?? 'local'}:${week}`}
                            state={state}
                            week={week}
                            initialWrite={week === writingWeek.current}
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
                                    .map((repo) => ({ value: repo.id, label: repo.name, keywords: [repo.path] }))}
                            />
                            <Combobox
                                label="Branch"
                                placeholder="Choose a branch"
                                emptyMessage="No branches found. Refresh activity to update branches."
                                disabled={project === 'all'}
                                description={project === 'all' ? 'Choose a project first.' : undefined}
                                value={branch === 'all' ? '' : branch}
                                onValueChange={(value) => setBranch(value || 'all')}
                                options={(state.repositories.find((repo) => repo.id === project)?.branches ?? []).map(
                                    (name) => ({
                                        value: name,
                                        label: name
                                    })
                                )}
                            />
                            <SegmentedControl
                                label="Branch view"
                                fullWidth
                                value={historyMode}
                                onValueChange={setHistoryMode}
                                options={[
                                    { value: 'introduced', label: 'Introduced on branch' },
                                    { value: 'history', label: 'Full history' }
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
                            <Button
                                loading={historyBusy}
                                disabled={project === 'all' || branch === 'all'}
                                onClick={browse}
                            >
                                Load branch history
                            </Button>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>
            </main>
        </WorkspaceContextMenu>
    )
}
