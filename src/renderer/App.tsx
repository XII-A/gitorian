import { Popover, PopoverTrigger, PopoverContent } from './components/arc/popover/popover'
import { Disclosure } from './components/Disclosure'
import { Input, Select, Field } from './components/Fields'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
    ArrowLeft,
    ArrowRight,
    BookOpen,
    RefreshCw,
    Settings as SettingsIcon,
    CalendarDays,
    History,
    Search,
    PanelLeft,
    SlidersHorizontal,
    PenLine
} from 'lucide-react'
import { defaultLayout, featureActivities, shiftWeek, weekOf } from '../shared/model'
import type { Activity, Command, Draft, Entry, Reply, State } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Button } from './components/arc/button/button'
import { DraftPane } from './DraftPane'
import { Settings } from './Settings'
import { DetailsPane } from './DetailsPane'
import { CommandMenu } from './components/CommandMenu'
import { WeeklyHub } from './WeeklyHub'
import { journalWeek, offsetDay, rangeActivities } from './hub-model'

export function App() {
    const [screen, setScreen] = useState<'hub' | 'workspace'>('hub')
    const [writingFocus, setWritingFocus] = useState(false)
    const openingJournal = useRef(false)
    const [state, setState] = useState<State>()
    const [connections, setConnections] = useState<Reply['connections']>({
        github: false,
        notion: false,
        protectedStorage: false
    })
    const [remotes, setRemotes] = useState<Record<string, string[]>>({})
    const [week, setWeek] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [layoutReset, setLayoutReset] = useState(0)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(false)
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches)
    useEffect(() => {
        const media = window.matchMedia('(max-width: 900px)')
        const changed = () => setNarrow(media.matches)
        media.addEventListener('change', changed)
        return () => media.removeEventListener('change', changed)
    }, [])
    useEffect(() => {
        const keyboard = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault()
                if (!document.querySelector('.settings')) setCommandsOpen((open) => !open)
            }
        }
        window.addEventListener('keydown', keyboard)
        return () => window.removeEventListener('keydown', keyboard)
    }, [])
    const [search, setSearch] = useState('')
    const [repositoryId, setRepositoryId] = useState('')
    const [featureId, setFeatureId] = useState('')
    const [view, setView] = useState('week')
    const [selectedId, setSelectedId] = useState('')
    const [entryId, setEntryId] = useState('')
    const [historyIds, setHistoryIds] = useState<string[]>([])
    const [comparison, setComparison] = useState('')
    const [branch, setBranch] = useState('')
    const [historyView, setHistoryView] = useState<'introduced' | 'history'>('introduced')
    const [author, setAuthor] = useState('')
    const [since, setSince] = useState('')
    const [draft, setDraft] = useState<Draft>()
    const draftRef = useRef<Draft | undefined>(undefined)
    const restoredId = useRef<string | undefined>(undefined)
    const saveQueue = useRef(Promise.resolve())
    const [saveStatus, setSaveStatus] = useState('Saved locally')
    const [featureName, setFeatureName] = useState('')
    const [insertLink, setInsertLink] = useState<{ url: string; title: string; nonce: number }>()
    const parameters = new URLSearchParams(window.location.search)
    const reference = parameters.get('reference')
    const referenceId = parameters.get('id')
    const apply = useCallback((reply: Reply) => {
        setState(reply.state)
        setConnections(reply.connections)
        if ('remotes' in reply) setRemotes(reply.remotes as Record<string, string[]>)
    }, [])
    const run = useCallback(
        async (command: Command): Promise<Reply | undefined> => {
            try {
                const reply = await window.journal.invoke(command)
                apply(reply)
                setError('')
                return reply
            } catch (failure) {
                setError(String(failure))
                return undefined
            }
        },
        [apply]
    )
    useEffect(() => {
        void run({ type: 'state' }).then((reply) => {
            if (reply) setWeek(weekOf(new Date(), reply.state.settings))
        })
        const timer = setInterval(() => {
            void run({ type: 'state' })
        }, 15000)
        return () => {
            clearInterval(timer)
        }
    }, [run])
    const setActiveDraft = (value: Draft | undefined) => {
        draftRef.current = value
        setDraft(value)
    }
    const editDraft = (value: Draft) => {
        setActiveDraft(value)
        setSaveStatus('Saving locally…')
        saveQueue.current = saveQueue.current.then(async () => {
            try {
                const reply = await window.journal.invoke({ type: 'draft', draft: value })
                apply(reply)
                setSaveStatus('Saved locally')
            } catch (failure) {
                setSaveStatus('Local save failed')
                setError(String(failure))
            }
        })
    }
    useEffect(() => {
        if (!state || reference) return
        if (restoredId.current !== state.restoreId) {
            draftRef.current = undefined
            restoredId.current = state.restoreId
        }
        const current = draftRef.current
        if (!current || current.week !== week) {
            const candidate = state.drafts.filter((item) => item.week === week && !item.publishedEntryId).at(-1)
            draftRef.current = candidate
            setDraft(candidate)
        } else {
            const stored = state.drafts.find((item) => item.id === current.id)
            if (stored) {
                const merged = { ...current, selections: stored.selections, publishedEntryId: stored.publishedEntryId }
                draftRef.current = merged
                setDraft(merged)
            }
        }
    }, [state, week, reference])
    useEffect(() => {
        if (!reference || !referenceId) return
        if (reference === 'entry') setEntryId(referenceId)
        else {
            setSelectedId(referenceId)
            void run({ type: 'details', activityId: referenceId })
        }
    }, [reference, referenceId, run])
    if (!state)
        return (
            <main className="loading">
                <BookOpen />
                <h1>A moment for your week.</h1>
                <p role={error ? 'alert' : 'status'}>
                    {error ? 'Unable to open your journal. Try again.' : 'Opening your journal…'}
                </p>
                {error && <Button onClick={() => void run({ type: 'state' })}>Try again</Button>}
            </main>
        )
    const activity = state.activities.find((item) => item.id === selectedId)
    const entry = state.entries.find((item) => item.id === entryId)
    const repository = state.repositories.find((item) => item.id === repositoryId)
    const feature = state.features.find((item) => item.id === featureId)
    const featureItems = featureId ? featureActivities(state, featureId).map((item) => item.id) : undefined
    const matchingFeatureWork = new Set(
        state.features
            .filter((item) => search && item.name.toLowerCase().includes(search.toLowerCase()))
            .flatMap((item) => featureActivities(state, item.id).map((activity) => activity.id))
    )
    let items: Activity[] =
        view === 'week'
            ? rangeActivities(state, week, offsetDay(week, 6))
            : view === 'branch'
              ? state.activities.filter((item) => historyIds.includes(item.id))
              : state.activities
    items = items
        .filter(
            (item) =>
                (!repositoryId || item.repositoryId === repositoryId) &&
                (!featureItems || featureItems.includes(item.id)) &&
                (`${item.title} ${item.description} ${item.author}`.toLowerCase().includes(search.toLowerCase()) ||
                    matchingFeatureWork.has(item.id))
        )
        .sort((left, right) => right.date.localeCompare(left.date))
    const entries = state.entries.filter((item) =>
        `${item.title} ${plainText(item.body)}`.toLowerCase().includes(search.toLowerCase())
    )
    const selectActivity = async (item: Activity) => {
        setSelectedId(item.id)
        setEntryId('')
        await run({ type: 'details', activityId: item.id })
    }
    const showEntry = (value: Entry) => {
        setEntryId(value.id)
        setSelectedId('')
    }
    const changeLayout = (layout: State['settings']['layout']) =>
        run({ type: 'settings', settings: { ...state.settings, layout } })
    const details = (
        <DetailsPane
            state={state}
            activity={activity}
            entry={entry}
            draft={draft}
            reference={!!reference}
            run={run}
            setInsertLink={setInsertLink}
        />
    )
    if (reference)
        return (
            <main className="reference">
                {error && <p role="alert">{error}</p>}
                {details}
            </main>
        )
    const panes = {
        activity: (
            <section className="pane activity-pane">
                <header className="pane-header">
                    <span>{view === 'entries' ? 'Journal library' : 'Work explorer'}</span>
                    <span>{view === 'entries' ? entries.length : items.length}</span>
                </header>
                <div className="filters">
                    <label className="sr-only" htmlFor="search">
                        Search work and journals
                    </label>
                    <Input
                        id="search"
                        placeholder="Search work & journals…"
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value)
                        }}
                    />
                    <Field>
                        Repository
                        <Select
                            value={repositoryId}
                            onChange={(event) => {
                                setRepositoryId(event.target.value)
                                setBranch('')
                            }}
                        >
                            <option value="">All repositories</option>
                            {state.repositories.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                    {!item.available ? ' · cached' : ''}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field>
                        Feature
                        <Select
                            value={featureId}
                            onChange={(event) => {
                                setFeatureId(event.target.value)
                                setFeatureName(
                                    state.features.find((item) => item.id === event.target.value)?.name ?? ''
                                )
                            }}
                        >
                            <option value="">All features</option>
                            {state.features.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                    {item.archived ? ' · archived' : ''}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Field>
                        Browse
                        <Select
                            value={view}
                            onChange={(event) => {
                                setView(event.target.value)
                            }}
                        >
                            <option value="week">This week’s work</option>
                            <option value="history">All captured history</option>
                            <option value="branch">Branch browser</option>
                            <option value="entries">Saved journals</option>
                        </Select>
                    </Field>
                    {view === 'branch' && (
                        <fieldset>
                            <legend>Branch comparison</legend>
                            <Field>
                                Branch
                                <Select
                                    value={branch}
                                    onChange={(event) => {
                                        setBranch(event.target.value)
                                    }}
                                >
                                    <option value="">Choose branch</option>
                                    {repository?.branches.map((name) => (
                                        <option key={name}>{name}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field>
                                View
                                <Select
                                    value={historyView}
                                    onChange={(event) => {
                                        setHistoryView(event.target.value as 'introduced' | 'history')
                                    }}
                                >
                                    <option value="introduced">Introduced relative to base</option>
                                    <option value="history">Reachable history</option>
                                </Select>
                            </Field>
                            <Field>
                                Author filter
                                <Input
                                    value={author}
                                    onChange={(event) => {
                                        setAuthor(event.target.value)
                                    }}
                                />
                            </Field>
                            <Field>
                                From author date
                                <Input
                                    type="date"
                                    value={since}
                                    onChange={(event) => {
                                        setSince(event.target.value)
                                    }}
                                />
                            </Field>
                            <Button
                                size="sm"
                                disabled={!repository || !branch}
                                onClick={async () => {
                                    const result = await run({
                                        type: 'history',
                                        repositoryId,
                                        branch,
                                        view: historyView,
                                        author,
                                        since
                                    })
                                    if (result) {
                                        setHistoryIds(result.activityIds ?? [])
                                        setComparison(result.message ?? '')
                                    }
                                }}
                            >
                                Browse branch
                            </Button>
                            <p className="muted">{comparison}</p>
                        </fieldset>
                    )}
                </div>
                <div className="activity-list">
                    {view === 'entries'
                        ? entries.map((value) => (
                              <Button
                                  variant="ghost"
                                  contentLayout="stack"
                                  className="activity-card"
                                  key={value.id}
                                  onClick={() => {
                                      showEntry(value)
                                  }}
                              >
                                  <span className="eyebrow">JOURNAL · {value.date.slice(0, 10)}</span>
                                  <strong>{value.title}</strong>
                                  <span className="muted">{plainText(value.body).slice(0, 100)}</span>
                              </Button>
                          ))
                        : items.map((item) => (
                              <Button
                                  variant="ghost"
                                  contentLayout="stack"
                                  className={`activity-card ${selectedId === item.id ? 'selected' : ''}`}
                                  key={item.id}
                                  onClick={() => {
                                      void selectActivity(item)
                                  }}
                              >
                                  <span className="eyebrow">
                                      {item.kind.toUpperCase()} · {item.date.slice(0, 10)}
                                  </span>
                                  <strong>{item.title}</strong>
                                  <span className="muted">
                                      {state.repositories.find((value) => value.id === item.repositoryId)?.name} ·{' '}
                                      {item.author}
                                  </span>
                              </Button>
                          ))}
                    {(view === 'entries' ? !entries.length : !items.length) && (
                        <p className="list-empty">
                            {state.repositories.length
                                ? 'No matching activity. Refresh, browse history, or choose another week.'
                                : 'Add your first repository in Settings to start exploring your work.'}
                        </p>
                    )}
                </div>
                <Disclosure className="feature-controls" title="Manage features">
                    <Field>
                        Feature name
                        <Input
                            value={featureName}
                            onChange={(event) => {
                                setFeatureName(event.target.value)
                            }}
                        />
                    </Field>
                    <div className="row">
                        <Button
                            size="sm"
                            disabled={!featureName}
                            onClick={() =>
                                run({ type: 'feature', id: '', name: featureName, archived: false, members: [] })
                            }
                        >
                            Create
                        </Button>
                        {feature && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => run({ type: 'feature', ...feature, name: featureName })}
                                >
                                    Rename
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => run({ type: 'feature', ...feature, archived: !feature.archived })}
                                >
                                    {feature.archived ? 'Unarchive' : 'Archive'}
                                </Button>
                            </>
                        )}
                    </div>
                    {feature?.members.map((member) => (
                        <div className="row" key={member}>
                            <span className="path">
                                {state.activities.find((item) => item.id === member)?.title ?? member}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                    run({
                                        type: 'feature',
                                        ...feature,
                                        members: feature.members.filter((id) => id !== member)
                                    })
                                }
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                </Disclosure>
            </section>
        ),
        details,
        draft: (
            <DraftPane
                state={state}
                week={week}
                draft={draft}
                busy={busy}
                saveStatus={saveStatus}
                insertLink={insertLink}
                run={run}
                showEntry={showEntry}
                onEdit={editDraft}
                onBodyChange={(body) => {
                    const latest = draftRef.current
                    if (latest) editDraft({ ...latest, body })
                }}
                onChoose={async (id) => {
                    await saveQueue.current
                    const result = await run({ type: 'state' })
                    if (result) setActiveDraft(result.state.drafts.find((item) => item.id === id))
                    setInsertLink(undefined)
                }}
                onCreate={async () => {
                    await saveQueue.current
                    const result = await run({ type: 'newDraft', week })
                    if (result) setActiveDraft(result.state.drafts.at(-1))
                    setInsertLink(undefined)
                }}
                onPublish={async () => {
                    if (!draft) return
                    setBusy(true)
                    await saveQueue.current
                    const latest = draftRef.current
                    const persisted = latest ? await run({ type: 'draft', draft: latest }) : undefined
                    if (persisted) await run({ type: 'publish', draftId: draft.id })
                    setBusy(false)
                }}
            />
        )
    }
    const layout = state.settings.layout
    const visible = writingFocus ? ['draft' as const] : layout.order.filter((id) => !layout.hidden.includes(id))
    if (screen === 'hub')
        return (
            <>
                <WeeklyHub
                    state={state}
                    run={run}
                    error={error}
                    onSettings={() => setSettingsOpen(true)}
                    onWrite={(date) => {
                        if (openingJournal.current) return
                        openingJournal.current = true
                        void (async () => {
                            try {
                                await saveQueue.current
                                const targetWeek = journalWeek(date, state.settings.weekStart)
                                const existing = state.drafts
                                    .filter((item) => item.week === targetWeek && !item.publishedEntryId)
                                    .at(-1)
                                const result = existing ? undefined : await run({ type: 'newDraft', week: targetWeek })
                                if (!existing && !result) return
                                setWeek(targetWeek)
                                setView('week')
                                setActiveDraft(existing ?? result?.state.drafts.at(-1))
                                setWritingFocus(false)
                                setScreen('workspace')
                                window.scrollTo(0, 0)
                            } finally {
                                openingJournal.current = false
                            }
                        })()
                    }}
                    onActivity={(item) => {
                        setWeek(weekOf(new Date(item.date), state.settings))
                        setView('week')
                        void selectActivity(item)
                        setWritingFocus(false)
                        setScreen('workspace')
                    }}
                />
                {settingsOpen && (
                    <Settings
                        state={state}
                        connections={connections}
                        remotes={remotes}
                        run={run}
                        close={() => setSettingsOpen(false)}
                    />
                )}
                {commandsOpen && (
                    <CommandMenu
                        close={() => setCommandsOpen(false)}
                        commands={[
                            { name: 'Open journal', hint: 'Continue writing', action: () => setScreen('workspace') },
                            {
                                name: 'Open settings',
                                hint: 'Repositories and connections',
                                action: () => setSettingsOpen(true)
                            },
                            {
                                name: 'Refresh activity',
                                hint: 'Discover work',
                                action: () => {
                                    void run({ type: 'refresh' })
                                }
                            }
                        ]}
                    />
                )}
            </>
        )
    return (
        <main className={`app hub-workspace ${writingFocus ? 'hub-writing' : ''}`}>
            <nav className="app-rail" aria-label="Workspace navigation">
                <div className="app-mark" aria-label="weekly-j">
                    <BookOpen size={20} />
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Search workspace"
                    title="Search workspace (Ctrl/Cmd+K)"
                    onClick={() => {
                        setCommandsOpen(true)
                    }}
                >
                    <Search size={18} />
                </Button>
                {[
                    { id: 'week', name: 'This week’s work', icon: CalendarDays },
                    { id: 'entries', name: 'Journal library', icon: BookOpen },
                    { id: 'history', name: 'Work history', icon: History }
                ].map(({ id, name, icon: Icon }) => (
                    <Button
                        key={id}
                        variant="ghost"
                        size="sm"
                        aria-label={name}
                        title={name}
                        aria-pressed={view === id}
                        onClick={() => {
                            setView(id)
                            void changeLayout({
                                ...layout,
                                hidden: layout.hidden.filter((pane) => pane !== 'activity')
                            })
                        }}
                    >
                        <Icon size={18} />
                    </Button>
                ))}
                <div className="rail-spacer" />
                <Button variant="ghost" size="sm" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                    <SettingsIcon size={18} />
                </Button>
            </nav>
            <div className="workspace-shell">
                <header className="app-header">
                    <Button variant="ghost" size="sm" onClick={() => setScreen('hub')}>
                        <ArrowLeft size={16} /> Back to week
                    </Button>
                    <div className="week-picker">
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Previous week"
                            onClick={() => {
                                setWeek(shiftWeek(week, -1))
                            }}
                        >
                            <ArrowLeft size={16} />
                        </Button>
                        <Field>
                            Week of{' '}
                            <Input
                                type="date"
                                value={week}
                                onChange={(event) => {
                                    if (event.target.value)
                                        setWeek(weekOf(new Date(`${event.target.value}T12:00:00`), state.settings))
                                }}
                            />
                        </Field>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Next week"
                            onClick={() => {
                                setWeek(shiftWeek(week, 1))
                            }}
                        >
                            <ArrowRight size={16} />
                        </Button>
                    </div>
                    <div className="row">
                        <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={async () => {
                                setBusy(true)
                                await run({ type: 'refresh' })
                                setBusy(false)
                            }}
                        >
                            <RefreshCw size={14} />
                            Refresh
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Settings"
                            onClick={() => {
                                setSettingsOpen(true)
                            }}
                        >
                            <SettingsIcon size={18} />
                        </Button>
                    </div>
                </header>
                <div className="workspace-toolbar">
                    <span className="muted">
                        {state.lastRefreshed
                            ? `Last refresh ${new Date(state.lastRefreshed).toLocaleString()}`
                            : 'Local workspace · Refresh to discover activity'}
                        {state.refreshError && ' · Refresh incomplete'}
                    </span>
                    <div className="row">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                changeLayout({ ...layout, hidden: ['activity'], sizes: { details: 40, draft: 60 } })
                            }
                        >
                            <PenLine size={14} /> Writing focus
                        </Button>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm">
                                    <SlidersHorizontal size={14} />
                                    Customize workspace
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="layout-menu-content" align="end">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                        if (await changeLayout(structuredClone(defaultLayout)))
                                            setLayoutReset((value) => value + 1)
                                    }}
                                >
                                    Reset layout
                                </Button>
                                {layout.order.map((id, index) => (
                                    <div className="row" key={id}>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                changeLayout({
                                                    ...layout,
                                                    hidden: layout.hidden.includes(id)
                                                        ? layout.hidden.filter((item) => item !== id)
                                                        : visible.length > 1
                                                          ? [...layout.hidden, id]
                                                          : layout.hidden
                                                })
                                            }
                                        >
                                            <PanelLeft size={14} /> {layout.hidden.includes(id) ? 'Show' : 'Hide'} {id}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`Move ${id} pane left`}
                                            disabled={index === 0}
                                            onClick={() => {
                                                const order = [...layout.order]
                                                ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
                                                return changeLayout({ ...layout, order })
                                            }}
                                        >
                                            ←
                                        </Button>
                                    </div>
                                ))}
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
                {(error || state.refreshError) && (
                    <div className="error-bar" role="alert">
                        <span>{error || state.refreshError}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setError('')
                                if (state.refreshError) void run({ type: 'refresh' })
                            }}
                        >
                            Retry / dismiss
                        </Button>
                    </div>
                )}
                <Group
                    key={`${visible.join(':')}:${layoutReset}`}
                    orientation={narrow ? 'vertical' : 'horizontal'}
                    defaultLayout={layout.sizes}
                    onLayoutChanged={(sizes) => {
                        if (
                            !writingFocus &&
                            Object.keys(sizes).some((id) => Math.abs((layout.sizes[id] ?? 0) - sizes[id]) > 0.5)
                        )
                            void changeLayout({ ...layout, sizes: { ...layout.sizes, ...sizes } })
                    }}
                    className="workspace"
                >
                    {visible.map((id, index) => (
                        <Fragment key={id}>
                            {index > 0 && (
                                <Separator
                                    className="separator"
                                    aria-label={`Resize ${visible[index - 1]} and ${id}`}
                                />
                            )}
                            <Panel id={id} minSize={narrow ? 160 : id === 'activity' ? 210 : 280}>
                                {panes[id]}
                            </Panel>
                        </Fragment>
                    ))}
                </Group>
                <footer className="app-statusbar">
                    <span>
                        <span className="status-dot" /> Local workspace
                    </span>
                    <span>
                        {connections.notion ? 'Notion connected' : 'Notion offline'} ·{' '}
                        {state.repositories.filter((item) => !item.removed).length} repositories
                    </span>
                </footer>
            </div>
            {settingsOpen && (
                <Settings
                    state={state}
                    connections={connections}
                    remotes={remotes}
                    run={run}
                    close={() => {
                        setSettingsOpen(false)
                    }}
                />
            )}
            {commandsOpen && (
                <CommandMenu
                    close={() => setCommandsOpen(false)}
                    commands={[
                        ...[
                            { id: 'week', name: 'Open this week’s work', hint: 'Activity for the selected week' },
                            { id: 'entries', name: 'Open journal library', hint: 'Read your published entries' },
                            {
                                id: 'history',
                                name: 'Browse work history',
                                hint: 'Find earlier commits and pull requests'
                            }
                        ].map(({ id, name, hint }) => ({
                            name,
                            hint,
                            action: () => {
                                setView(id)
                                void changeLayout({
                                    ...layout,
                                    hidden: layout.hidden.filter((pane) => pane !== 'activity')
                                })
                            }
                        })),
                        {
                            name: 'Open settings',
                            hint: 'Repositories, connections, and preferences',
                            action: () => setSettingsOpen(true)
                        },
                        {
                            name: 'Focus on writing',
                            hint: 'Make room for your journal',
                            action: () => {
                                void changeLayout({
                                    ...layout,
                                    hidden: ['activity'],
                                    sizes: { draft: 65, details: 35 }
                                })
                            }
                        },
                        {
                            name: 'Refresh workspace',
                            hint: 'Discover new activity',
                            action: () => {
                                void run({ type: 'refresh' })
                            }
                        }
                    ]}
                />
            )}
        </main>
    )
}
