import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { localDate, shiftWeek, weekOf, stateSchema } from '../shared/model'
import { offsetDay, journalWeek, rangeActivities } from './hub-model'
import { Button } from './components/arc/button/button'
import { DateRangePicker } from './components/arc/date-range-picker/date-range-picker'
import { Select } from './components/arc/select/select'
import { Input } from './components/arc/input/input'
import { Switch } from './components/arc/switch/switch'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { WorkspaceDraft } from './WorkspaceDraft'
import type { Citation } from './WorkspaceDraft'
import { WorkspaceInspector } from './WorkspaceInspector'
import { sampleState } from './workspace-sample'
import { activityLink, dateKey, dateValue, filterWorkspaceActivity, formatDay } from './workspace-model'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { ExpandingSearch } from './components/arc/expanding-search/expanding-search'
import { WorkspaceActivityChart } from './WorkspaceActivityChart'
import { Breadcrumb } from './components/arc/breadcrumb/breadcrumb'
import landscape from './assets/week-landscape.jpg'
import './workspace.css'

interface Props {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    error: string
    initialWeek: string
    initialActivity?: string
    onBack: (week: string) => void
    onSettings: () => void
}
export function Workspace({
    state: realState,
    run: realRun,
    error,
    initialWeek,
    initialActivity,
    onBack,
    onSettings
}: Props) {
    const [week, setWeek] = useState(initialWeek)
    const [sample, setSample] = useState(false)
    const [example, setExample] = useState<State>()
    const examples = useRef(new Map<string, State>())
    const [project, setProject] = useState('all')
    const [branch, setBranch] = useState('all')
    const [kind, setKind] = useState('all')
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [inspectionTab, setInspectionTab] = useState<'diff' | 'details'>('diff')
    const [publishTarget, setPublishTarget] = useState<HTMLElement | null>(null)
    const [selectedId, setSelectedId] = useState(initialActivity)
    const [detailBusy, setDetailBusy] = useState(false)
    const [detailError, setDetailError] = useState('')
    const [refreshing, setRefreshing] = useState(false)
    const [focus, setFocus] = useState(false)
    const [historyOpen, setHistoryOpen] = useState(false)
    const [historyMode, setHistoryMode] = useState('introduced')
    const [author, setAuthor] = useState('')
    const [historyBusy, setHistoryBusy] = useState(false)
    const [canCite, setCanCite] = useState(false)
    const [citation, setCitation] = useState<Citation>()
    const [notice, setNotice] = useState('')
    const [detached, setDetached] = useState<string>()
    const channel = useRef<BroadcastChannel | undefined>(undefined)
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
                )
                    value = cached.data
            } catch {
                /* Sample data can still be used without browser storage. */
            }
            examples.current.set(sampleWeek, value)
        }
        return value
    }, [])
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('data') !== 'sample') return
        setExample(getSample(initialWeek))
        setSample(true)
    }, [getSample, initialWeek])
    useEffect(() => {
        if (!sample) return
        const value = getSample(week)
        setExample(value)
        setSelectedId(value.activities[0]?.id)
    }, [sample, week, getSample])
    const state = sample ? (example ?? sampleState(week)) : realState
    const run = useCallback(
        async (command: Command): Promise<Reply | undefined> => {
            if (!sample) return realRun(command)
            const current = examples.current.get(week)
            if (!current) return undefined
            const next = structuredClone(current)
            switch (command.type) {
                case 'draft': {
                    const index = next.drafts.findIndex((draft) => draft.id === command.draft.id)
                    if (index >= 0) next.drafts[index] = command.draft
                    break
                }
                case 'newDraft':
                    next.drafts.push({
                        id: `sample-draft-${crypto.randomUUID()}`,
                        week: command.week,
                        title: '',
                        body: { type: 'doc', content: [{ type: 'paragraph' }] },
                        selections: [],
                        updatedAt: new Date().toISOString()
                    })
                    break
                case 'publish': {
                    const draft = next.drafts.find((item) => item.id === command.draftId)
                    if (draft) {
                        draft.publishedEntryId = `sample-entry-${draft.id}`
                        next.entries.push({
                            id: draft.publishedEntryId,
                            title: draft.title,
                            body: draft.body,
                            date: draft.week,
                            url: 'https://notion.so/example',
                            refreshedAt: new Date().toISOString()
                        })
                    }
                    break
                }
                case 'open':
                    setNotice('Sample links are examples. Switch to real data to open your work.')
                    break
                default:
                    break
            }
            examples.current.set(week, next)
            try {
                localStorage.setItem(`weekly-j:sample-state:${week}`, JSON.stringify(next))
            } catch {
                setNotice('Sample changes are kept for this session. Local storage is unavailable.')
            }
            setExample(next)
            return { state: next, connections: { github: false, notion: false, protectedStorage: false } }
        },
        [realRun, sample, week]
    )
    const inspect = useCallback(
        async (item: Activity, tab: 'diff' | 'details' = 'diff') => {
            const id = ++requestId.current
            setSelectedId(item.id)
            setInspectionTab(tab)
            setDetailError('')
            if (sample) return
            setDetailBusy(true)
            const reply = await realRun({ type: 'details', activityId: item.id })
            if (requestId.current !== id) return
            if (!reply)
                setDetailError('Could not load these changes. Retry, or check the repository connection in settings.')
            setDetailBusy(false)
        },
        [sample, realRun]
    )
    const initialInspected = useRef(false)
    useEffect(() => {
        if (!initialActivity || initialInspected.current) return
        const activity = realState.activities.find((item) => item.id === initialActivity)
        if (activity) {
            initialInspected.current = true
            void inspect(activity)
        }
    }, [initialActivity, realState.activities, inspect])
    const selected = state.activities.find((item) => item.id === selectedId)
    const items = useMemo(() => rangeActivities(state, week, offsetDay(week, 6)), [state, week])
    const visible = useMemo(
        () => filterWorkspaceActivity(state, week, { project, branch, kind, search: '' }),
        [state, week, project, branch, kind]
    )
    const currentWeek = weekOf(new Date(), state.settings)
    const cite = useCallback(
        (activity: Activity) => {
            if (!canCite) {
                setNotice('Open or create an editable draft to add a citation.')
                return
            }
            setCitation({ id: Date.now(), title: activity.title, url: activityLink(activity, state) })
            setNotice('Citation added to your entry.')
        },
        [canCite, state]
    )
    useEffect(() => {
        const bus = new BroadcastChannel('weekly-j-workspace-reference')
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
        if (sample) setExample(getSample(value))
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
    const changeSource = (value: boolean) => {
        if (value) setExample(getSample(week))
        setSample(value)
        setSelectedId(undefined)
        setDetached(undefined)
        setDetailError('')
        setNotice('')
        setCitation(undefined)
        setProject('all')
        setBranch('all')
        setKind('all')
        const url = new URL(window.location.href)
        url.searchParams.set('data', value ? 'sample' : 'real')
        window.history.replaceState({}, '', url)
    }
    const popout = async () => {
        if (!selected) return
        if (navigator.userAgent.includes('Electron/')) {
            const reply = await realRun({ type: 'popout', kind: 'activity', id: selected.id })
            if (reply) setDetached(selected.id)
        } else {
            const url = new URL(window.location.href)
            url.search = ''
            url.searchParams.set('reference', 'activity')
            url.searchParams.set('id', selected.id)
            const popup = window.open(url, `weekly-j-${selected.id}`, 'popup,width=1400,height=900')
            if (popup) setDetached(selected.id)
            else setNotice('The browser blocked the window. Allow pop-ups for this app and try again.')
        }
    }
    const refresh = async () => {
        setRefreshing(true)
        await run({ type: 'refresh' })
        setRefreshing(false)
    }
    const browse = async () => {
        if (project === 'all' || branch === 'all') return
        setHistoryBusy(true)
        const result = await run({
            type: 'history',
            repositoryId: project,
            branch,
            view: historyMode === 'history' ? 'history' : 'introduced',
            author,
            since: week
        })
        setNotice(
            result
                ? `${result.activityIds?.length ?? 0} commits loaded. Activity is still filtered to this week.`
                : 'Could not load branch history. Check the repository and try again.'
        )
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
                onInspect={(item) => void inspect(item)}
                onPopout={popout}
                onClose={() => setSelectedId(undefined)}
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
                        items={[{ label: 'Journal', onClick: () => onBack(week) }, { label: 'Weekly entry' }]}
                    />
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
                                weeksAgo === 0 ? 'This week' : weeksAgo === 1 ? 'Last week' : `${weeksAgo} weeks ago`,
                            range: () => ({
                                start: dateValue(shiftWeek(currentWeek, -weeksAgo)),
                                end: dateValue(offsetDay(shiftWeek(currentWeek, -weeksAgo), 6))
                            })
                        }))}
                    />
                </div>
                <div className="ws-utilities">
                    <Switch label="Sample data" checked={sample} onCheckedChange={changeSource} />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={refresh}
                        loading={refreshing}
                        aria-label="Refresh activity"
                        title="Refresh activity"
                    >
                        <WorkspaceIcon name="refresh" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFocus((value) => !value)}
                        aria-label={focus ? 'Show activity panels' : 'Focus on writing'}
                        aria-pressed={focus}
                        title={focus ? 'Show activity panels' : 'Focus on writing'}
                    >
                        <WorkspaceIcon name="focus" />
                    </Button>
                    <div className="ws-publish" ref={setPublishTarget} />
                </div>
            </header>
            {notice && (
                <div className="ws-action-notice" role="status">
                    <span>{notice}</span>
                    <Button variant="ghost" size="sm" aria-label="Dismiss notification" onClick={() => setNotice('')}>
                        <WorkspaceIcon name="close" />
                    </Button>
                </div>
            )}
            {!sample && (error || state.refreshError) && (
                <div className="ws-error-bar" role="alert">
                    <span>Could not update your journal. Your saved writing is still available.</span>
                    <Button variant="secondary" size="sm" onClick={refresh}>
                        Retry refresh
                    </Button>
                </div>
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
                                id: item.id,
                                title: item.title,
                                group: state.repositories.find((repo) => repo.id === item.repositoryId)?.name,
                                meta: `${formatDay(localDate(new Date(item.date), state.settings.timezone))} · ${item.sha?.slice(0, 7) ?? item.kind}`,
                                keywords: [item.sha ?? '', item.description, ...item.branches],
                                icon: <WorkspaceIcon name={item.kind === 'commit' ? 'commit' : 'pr'} />
                            }))}
                            suggestions={items.slice(0, 4).map((item) => ({
                                id: item.id,
                                title: item.title,
                                meta: state.repositories.find((repo) => repo.id === item.repositoryId)?.name
                            }))}
                            suggestionsLabel="This week"
                            onSelect={(result) => {
                                const item = items.find((activity) => activity.id === result.id)
                                if (item) void inspect(item, 'details')
                            }}
                        />
                    </div>
                    <WorkspaceActivityChart activities={items} state={state} week={week} />
                    <div className="ws-activity-filters" role="group" aria-label="Filter activity">
                        {(['all', 'commit', 'pr'] as const).map((value) => (
                            <Button
                                key={value}
                                variant="ghost"
                                size="sm"
                                className="ws-filter-chip"
                                aria-pressed={kind === value}
                                onClick={() => setKind(value)}
                            >
                                {value === 'all' ? 'All' : value === 'commit' ? 'Commits' : 'PRs & reviews'}
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
                        <div className="ws-project-filter">
                            <Select
                                label=""
                                aria-label="Filter by project"
                                className="ws-filter-chip ws-project-chip"
                                variant="ghost"
                                contentMinWidth={240}
                                value={project}
                                onValueChange={(value) => {
                                    setProject(value)
                                    setBranch('all')
                                }}
                                options={[
                                    {
                                        value: 'all',
                                        label: 'Projects',
                                        count: state.repositories.filter((repo) => !repo.removed).length
                                    },
                                    ...state.repositories
                                        .filter((repo) => !repo.removed)
                                        .map((repo) => ({ value: repo.id, label: repo.name }))
                                ]}
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="ws-filter-chip ws-history-chip"
                            onClick={() => setHistoryOpen(true)}
                            aria-label="More activity filters"
                            title="Browse branch history"
                            aria-pressed={branch !== 'all'}
                        >
                            <WorkspaceIcon name="branch" width="14" height="14" />
                        </Button>
                    </div>
                    {branch !== 'all' && (
                        <div className="ws-extra-filters">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="ws-filter-chip"
                                onClick={() => setBranch('all')}
                            >
                                Clear {branch}
                                <WorkspaceIcon name="close" width="14" height="14" />
                            </Button>
                        </div>
                    )}
                    <ScrollArea
                        className="ws-activity-scroll"
                        viewportClassName="ws-activity-viewport"
                        label="Weekly activity list"
                        fade={16}
                    >
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
                                    <ul>
                                        {visible
                                            .filter(
                                                (item) =>
                                                    localDate(new Date(item.date), state.settings.timezone) === day
                                            )
                                            .map((item) => (
                                                <li key={item.id}>
                                                    <button
                                                        type="button"
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
                                                        onClick={() => void inspect(item)}
                                                    >
                                                        <WorkspaceIcon
                                                            name={item.kind === 'commit' ? 'commit' : 'pr'}
                                                        />
                                                        <span className="ws-row-copy">
                                                            <span>{item.title}</span>
                                                            <small>
                                                                {
                                                                    state.repositories.find(
                                                                        (repo) => repo.id === item.repositoryId
                                                                    )?.name
                                                                }
                                                                <span>·</span>
                                                                {item.sha?.slice(0, 7) ?? item.kind}
                                                            </small>
                                                        </span>
                                                        <span className="ws-row-kind">
                                                            {item.kind === 'merged'
                                                                ? 'Merged'
                                                                : item.kind === 'review'
                                                                  ? 'Review'
                                                                  : item.kind === 'pr'
                                                                    ? 'PR'
                                                                    : ''}
                                                        </span>
                                                    </button>
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
                                        if (!items.length) void refresh()
                                    }}
                                >
                                    {items.length ? 'Clear activity filters' : 'Refresh activity'}
                                </Button>
                            </div>
                        )}
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
                        if (canCite && event.dataTransfer.types.includes('application/x-weekly-j-activity'))
                            event.preventDefault()
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
                >
                    <ScrollArea className="ws-dialog-fields" label="Branch history filters" fade={16}>
                        <Select
                            label="Project"
                            value={project}
                            onValueChange={(value) => {
                                setProject(value)
                                setBranch('all')
                            }}
                            options={[
                                { value: 'all', label: 'Choose a project' },
                                ...state.repositories
                                    .filter((repo) => !repo.removed)
                                    .map((repo) => ({ value: repo.id, label: repo.name }))
                            ]}
                        />
                        <Select
                            label="Branch"
                            value={branch}
                            onValueChange={setBranch}
                            options={[
                                { value: 'all', label: 'Choose a branch' },
                                ...(state.repositories.find((repo) => repo.id === project)?.branches ?? []).map(
                                    (name) => ({
                                        value: name,
                                        label: name
                                    })
                                )
                            ]}
                        />
                        <SegmentedControl
                            label="Branch view"
                            value={historyMode}
                            onValueChange={setHistoryMode}
                            options={[
                                { value: 'introduced', label: 'Introduced on branch' },
                                { value: 'history', label: 'Full history' }
                            ]}
                        />
                        <Input
                            label="Author"
                            placeholder="All authors"
                            value={author}
                            onChange={(event) => setAuthor(event.target.value)}
                        />
                        <Button loading={historyBusy} disabled={project === 'all' || branch === 'all'} onClick={browse}>
                            Load branch history
                        </Button>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </main>
    )
}
