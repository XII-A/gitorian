import { Popover, PopoverTrigger, PopoverContent } from './components/arc/popover/popover'
import { Input, Select, Field } from './components/Fields'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { inbox, featureActivities, weekOf } from '../shared/model'
import type { Activity, Command, Draft, Entry, Reply, State } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Button } from './components/arc/button/button'
import { DraftPane } from './DraftPane'
import { Settings } from './Settings'
import { DetailsPane } from './DetailsPane'
import { CommandMenu } from './components/CommandMenu'
import { WeeklyHub } from './WeeklyHub'
import { journalWeek } from './hub-model'
import { WorkSelection } from './WorkSelection'
import { Workspace } from './Workspace'
import { createSampleJournal } from './workspace-sample'

export function App() {
    const [sample, setSample] = useState(
        () => !window.journal || new URLSearchParams(location.search).get('demo') === '1'
    )
    const [sampleJournal] = useState(createSampleJournal)
    const bridge = useRef(sample ? sampleJournal : window.journal)
    const [switching, setSwitching] = useState(false)
    const [screen, setScreen] = useState<'hub' | 'workspace'>(sample ? 'workspace' : 'hub')
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
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(false)
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
    const [view, setView] = useState('inbox')
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
    const [selectionBusy, setSelectionBusy] = useState(false)
    const selectionLock = useRef(false)
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
                const active = bridge.current
                const reply = await active.invoke(command)
                if (active !== bridge.current) return undefined
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
            if (reply) {
                setWeek(weekOf(new Date(), reply.state.settings))
                if (bridge.current === sampleJournal) setSelectedId(reply.state.activities[0]?.id ?? '')
            }
        })
        const timer = setInterval(() => {
            void run({ type: 'state' })
        }, 15000)
        return () => {
            clearInterval(timer)
        }
    }, [run, sampleJournal])
    const setActiveDraft = (value: Draft | undefined) => {
        draftRef.current = value
        setDraft(value)
    }
    const editDraft = (value: Draft) => {
        setActiveDraft(value)
        setSaveStatus('Saving locally…')
        const active = bridge.current
        saveQueue.current = saveQueue.current.then(async () => {
            try {
                const reply = await active.invoke({ type: 'draft', draft: value })
                if (active !== bridge.current) return
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
    const featureItems = featureId ? featureActivities(state, featureId).map((item) => item.id) : undefined
    const matchingFeatureWork = new Set(
        state.features
            .filter((item) => search && item.name.toLowerCase().includes(search.toLowerCase()))
            .flatMap((item) => featureActivities(state, item.id).map((activity) => activity.id))
    )
    let items: Activity[] =
        view === 'inbox'
            ? inbox(state, week)
            : view === 'deferred'
              ? state.activities.filter((item) => item.disposition === 'deferred')
              : view === 'dismissed'
                ? state.activities.filter((item) => item.disposition === 'dismissed')
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
    if (sample && view === 'inbox')
        items = items.filter((item) => journalWeek(item.date.slice(0, 10), state.settings.weekStart) === week)
    const entries = state.entries.filter((item) =>
        `${item.title} ${plainText(item.body)}`.toLowerCase().includes(search.toLowerCase())
    )
    const selectActivity = async (item: Activity) => {
        setSelectedId(item.id)
        setEntryId('')
        await run({ type: 'details', activityId: item.id })
    }
    const changeSelection = async (activities: Activity[], included: boolean) => {
        if (selectionLock.current) return
        selectionLock.current = true
        setSelectionBusy(true)
        try {
            await saveQueue.current
            const current = draftRef.current
            if (!current || current.publishedEntryId) return
            for (const item of activities) {
                const result = await run({ type: 'select', draftId: current.id, activityId: item.id, included })
                if (!result) break
            }
        } finally {
            selectionLock.current = false
            setSelectionBusy(false)
        }
    }
    const showEntry = (value: Entry) => {
        setEntryId(value.id)
        setSelectedId('')
    }
    const details = (
        <DetailsPane
            state={state}
            activity={activity}
            entry={entry}
            draft={draft}
            reference={!!reference}
            run={run}
            showEntry={showEntry}
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
                    <span>{view === 'entries' ? 'Journal library' : 'Work to include'}</span>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm">
                                Filters
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end">
                            {' '}
                            <div className="advanced-work-filters">
                                <Field>
                                    Feature
                                    <Select
                                        value={featureId}
                                        onChange={(event) => {
                                            setFeatureId(event.target.value)
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
                                        <option value="inbox">Inbox & carryover</option>
                                        <option value="deferred">Deferred</option>
                                        <option value="dismissed">Dismissed</option>
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
                        </PopoverContent>
                    </Popover>
                </header>
                <div className="filters">
                    <label className="sr-only" htmlFor="search">
                        Search work and journals
                    </label>
                    <Input
                        id="search"
                        placeholder="Search work"
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
                </div>
                <div className="work-list-region">
                    {view === 'entries' ? (
                        entries.map((value) => (
                            <Button
                                variant="ghost"
                                contentLayout="stack"
                                className="activity-card"
                                key={value.id}
                                onClick={() => {
                                    showEntry(value)
                                }}
                            >
                                <span className="journal-date">Journal · {value.date.slice(0, 10)}</span>
                                <strong>{value.title}</strong>
                                <span className="muted">{plainText(value.body).slice(0, 100)}</span>
                            </Button>
                        ))
                    ) : (
                        <WorkSelection
                            items={items}
                            state={state}
                            draft={draft}
                            selectedId={selectedId}
                            pending={selectionBusy}
                            onInspect={selectActivity}
                            onSelection={changeSelection}
                        />
                    )}
                    {(view === 'entries' ? !entries.length : !items.length) && (
                        <p className="list-empty">
                            {state.repositories.length
                                ? 'No matching activity. Refresh, browse history, or choose another week.'
                                : 'Add your first repository in Settings to start exploring your work.'}
                        </p>
                    )}
                </div>
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
                publishAvailable={!sample && connections.notion && !!state.settings.destination}
                sample={sample}
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
    if (screen === 'hub')
        return (
            <>
                <WeeklyHub
                    state={state}
                    run={run}
                    error={error}
                    onSettings={() => {
                        if (!sample) setSettingsOpen(true)
                    }}
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
                                setActiveDraft(existing ?? result?.state.drafts.at(-1))
                                setScreen('workspace')
                                window.scrollTo(0, 0)
                            } finally {
                                openingJournal.current = false
                            }
                        })()
                    }}
                    onActivity={(item) => {
                        void selectActivity(item)
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
                                action: () => {
                                    if (!sample) setSettingsOpen(true)
                                }
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
        <Workspace
            state={state}
            week={week}
            panes={panes}
            includedCount={draft?.selections.length ?? 0}
            sample={sample}
            switching={switching}
            onWeek={(value) => {
                setWeek(value)
                if (sample) {
                    setSelectedId(
                        state.activities.find(
                            (item) => journalWeek(item.date.slice(0, 10), state.settings.weekStart) === value
                        )?.id ?? ''
                    )
                    setEntryId('')
                }
            }}
            onBack={() => setScreen('hub')}
            onSettings={() => {
                if (!sample) setSettingsOpen(true)
            }}
            busy={busy}
            error={error}
            onDismissError={() => setError('')}
            onRefresh={async () => {
                setBusy(true)
                await run({ type: 'refresh' })
                setBusy(false)
            }}
            onSample={async (value) => {
                if (!value && !window.journal) return
                setSwitching(true)
                try {
                    await saveQueue.current
                    const next = value ? sampleJournal : window.journal
                    const reply = await next.invoke({ type: 'state' })
                    bridge.current = next
                    draftRef.current = undefined
                    setDraft(undefined)
                    setInsertLink(undefined)
                    setSelectedId(
                        value
                            ? (reply.state.activities.find(
                                  (item) => journalWeek(item.date.slice(0, 10), reply.state.settings.weekStart) === week
                              )?.id ?? '')
                            : ''
                    )
                    setEntryId('')
                    setRepositoryId('')
                    setFeatureId('')
                    setSearch('')
                    setView('inbox')
                    setSettingsOpen(false)
                    setError('')
                    setSaveStatus('Saved locally')
                    setSample(value)
                    apply(reply)
                    const url = new URL(location.href)
                    if (value) url.searchParams.set('demo', '1')
                    else url.searchParams.delete('demo')
                    history.replaceState({}, '', url)
                } catch (failure) {
                    setError(String(failure))
                } finally {
                    setSwitching(false)
                }
            }}
            overlays={
                <>
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
                                { name: 'Open work inbox', hint: 'Review your work', action: () => setView('inbox') },
                                {
                                    name: 'Open journal library',
                                    hint: 'Published entries',
                                    action: () => setView('entries')
                                },
                                {
                                    name: 'Browse work history',
                                    hint: 'Earlier commits and pull requests',
                                    action: () => setView('history')
                                },
                                {
                                    name: 'Open settings',
                                    hint: 'Repositories and connections',
                                    action: () => {
                                        if (!sample) setSettingsOpen(true)
                                    }
                                },
                                {
                                    name: 'Refresh activity',
                                    hint: 'Discover new work',
                                    action: () => {
                                        void run({ type: 'refresh' })
                                    }
                                }
                            ]}
                        />
                    )}
                </>
            }
        />
    )
}
