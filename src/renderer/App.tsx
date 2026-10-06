import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ArrowLeft, ArrowRight, BookOpen, GitBranch, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { coveredEntries, defaultLayout, inbox, featureActivities, shiftWeek, weekOf } from '../shared/model'
import type { Activity, Command, Draft, Entry, Reply, State } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Button } from './components/arc/button/button'
import { Editor } from './Editor'
import { Settings } from './Settings'
import { DiffViewer } from './DiffViewer'

export function App() {
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
    const [search, setSearch] = useState('')
    const [repositoryId, setRepositoryId] = useState('')
    const [featureId, setFeatureId] = useState('')
    const [view, setView] = useState('inbox')
    const [selectedId, setSelectedId] = useState('')
    const [entryId, setEntryId] = useState('')
    const [diff, setDiff] = useState('')
    const [historyIds, setHistoryIds] = useState<string[]>([])
    const [comparison, setComparison] = useState('')
    const [branch, setBranch] = useState('')
    const [historyView, setHistoryView] = useState<'introduced' | 'history'>('introduced')
    const [author, setAuthor] = useState('')
    const [since, setSince] = useState('')
    const [draft, setDraft] = useState<Draft>()
    const draftRef = useRef<Draft | undefined>(undefined)
    const saveQueue = useRef(Promise.resolve())
    const [saveStatus, setSaveStatus] = useState('Saved locally')
    const [featureName, setFeatureName] = useState('')
    const [deferWeek, setDeferWeek] = useState('')
    const [reason, setReason] = useState('')
    const [linkEntry, setLinkEntry] = useState('')
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
            void run({ type: 'details', activityId: referenceId }).then((reply) => {
                setDiff(reply?.diff ?? '')
            })
        }
    }, [reference, referenceId, run])
    if (!state)
        return (
            <main className="loading">
                <BookOpen />
                <h1>weekly-j</h1>
                <p>{error || 'Opening your workspace…'}</p>
            </main>
        )
    const activity = state.activities.find((item) => item.id === selectedId)
    const entry = state.entries.find((item) => item.id === entryId)
    const repository = state.repositories.find((item) => item.id === repositoryId)
    const feature = state.features.find((item) => item.id === featureId)
    const featureItems = featureId ? featureActivities(state, featureId).map((item) => item.id) : undefined
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
                `${item.title} ${item.description} ${item.author}`.toLowerCase().includes(search.toLowerCase())
        )
        .sort((left, right) => right.date.localeCompare(left.date))
    const entries = state.entries.filter((item) =>
        `${item.title} ${plainText(item.body)}`.toLowerCase().includes(search.toLowerCase())
    )
    const selectActivity = async (item: Activity) => {
        setSelectedId(item.id)
        setEntryId('')
        setDiff('')
        const result = await run({ type: 'details', activityId: item.id })
        setDiff(result?.diff ?? '')
    }
    const showEntry = (value: Entry) => {
        setEntryId(value.id)
        setSelectedId('')
    }
    const changeLayout = (layout: State['settings']['layout']) =>
        run({ type: 'settings', settings: { ...state.settings, layout } })
    const details = (
        <section className="pane details">
            <header className="pane-header">
                <span>{entry ? 'JOURNAL ENTRY' : 'WORK DETAILS'}</span>
                {(activity || entry) && !reference && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                            run({ type: 'popout', kind: entry ? 'entry' : 'activity', id: entry?.id ?? activity!.id })
                        }
                    >
                        Pop out ↗
                    </Button>
                )}
            </header>
            <div className="pane-content">
                {entry ? (
                    <>
                        <h2>{entry.title}</h2>
                        <p className="muted">
                            {new Date(entry.date).toLocaleDateString()} · Cached{' '}
                            {new Date(entry.refreshedAt).toLocaleString()}
                        </p>
                        <Button variant="secondary" onClick={() => run({ type: 'open', url: entry.url })}>
                            Open in Notion ↗
                        </Button>
                        <Editor key={entry.id} value={entry.body} readOnly />
                    </>
                ) : activity ? (
                    <>
                        <p className="eyebrow">
                            {state.repositories.find((item) => item.id === activity.repositoryId)?.name} /{' '}
                            {activity.kind}
                        </p>
                        <h2>{activity.title}</h2>
                        <p className="muted">
                            {activity.author} · {new Date(activity.date).toLocaleString()}
                            <br />
                            {activity.sha?.slice(0, 12)}
                        </p>
                        {activity.base && (
                            <p className="comparison">
                                Comparison: <strong>{activity.base}</strong>
                            </p>
                        )}
                        {activity.deletedBranches.length > 0 && (
                            <p className="muted">
                                Deleted branches: {activity.deletedBranches.join(', ')} · History retained
                            </p>
                        )}
                        <div className="row wrap">
                            {activity.url && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => run({ type: 'open', url: activity.url! })}
                                >
                                    Open in GitHub ↗
                                </Button>
                            )}
                            {draft && !draft.publishedEntryId && !reference && (
                                <Button
                                    size="sm"
                                    onClick={() =>
                                        run({
                                            type: 'select',
                                            draftId: draft.id,
                                            activityId: activity.id,
                                            included: !draft.selections.some((item) => item.activityId === activity.id)
                                        })
                                    }
                                >
                                    {draft.selections.some((item) => item.activityId === activity.id)
                                        ? 'Remove from draft'
                                        : 'Include in draft'}
                                </Button>
                            )}
                            {activity.kind === 'pr' && activity.url && draft && !reference && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setInsertLink({ url: activity.url!, title: activity.title, nonce: Date.now() })
                                    }}
                                >
                                    Insert PR link
                                </Button>
                            )}
                        </div>
                        <div className="coverage">
                            <h3>Journal coverage</h3>
                            {coveredEntries(state, activity).map((value) => (
                                <div key={value.id} className="row">
                                    <Button
                                        variant="ghost"
                                        onClick={() => {
                                            showEntry(value)
                                        }}
                                    >
                                        {value.title}
                                    </Button>
                                    {!reference && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                run({
                                                    type: 'coverage',
                                                    activityId: activity.id,
                                                    entryId: value.id,
                                                    linked: false
                                                })
                                            }
                                        >
                                            Unlink
                                        </Button>
                                    )}
                                </div>
                            ))}
                            {!coveredEntries(state, activity).length && (
                                <p className="muted">
                                    {activity.kind === 'pr' &&
                                    state.coverage.some((link) => link.activityId === activity.id)
                                        ? 'Updated work · earlier revisions have journal entries'
                                        : 'Uncovered work'}
                                </p>
                            )}
                            {activity.kind === 'pr' &&
                                state.coverage
                                    .filter(
                                        (link) => link.activityId === activity.id && link.revision !== activity.revision
                                    )
                                    .map((link) => (
                                        <Button
                                            key={`${link.entryId}:${link.revision}`}
                                            variant="ghost"
                                            onClick={() => {
                                                const prior = state.entries.find((value) => value.id === link.entryId)
                                                if (prior) showEntry(prior)
                                            }}
                                        >
                                            Previously:{' '}
                                            {state.entries.find((value) => value.id === link.entryId)?.title ??
                                                'Saved entry'}
                                        </Button>
                                    ))}
                            {!reference && entries.length > 0 && (
                                <div className="row">
                                    <label>
                                        Link existing entry
                                        <select
                                            value={linkEntry}
                                            onChange={(event) => {
                                                setLinkEntry(event.target.value)
                                            }}
                                        >
                                            <option value="">Choose entry</option>
                                            {state.entries.map((value) => (
                                                <option key={value.id} value={value.id}>
                                                    {value.title}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={!linkEntry}
                                        onClick={() =>
                                            run({
                                                type: 'coverage',
                                                activityId: activity.id,
                                                entryId: linkEntry,
                                                linked: true
                                            })
                                        }
                                    >
                                        Link
                                    </Button>
                                </div>
                            )}
                        </div>
                        <p className="description">{activity.description}</p>
                        {activity.files.length > 0 && (
                            <details>
                                <summary>{activity.files.length} changed files</summary>
                                {activity.files.map((file) => (
                                    <p className="path" key={file.name}>
                                        {file.status} · {file.name}
                                    </p>
                                ))}
                            </details>
                        )}
                        <DiffViewer key={activity.id} text={diff || state.diffs[activity.id] || ''} />
                        {!reference && (
                            <details className="decisions">
                                <summary>Inbox decisions & features</summary>
                                <label>
                                    Defer to week
                                    <input
                                        type="date"
                                        value={deferWeek}
                                        onChange={(event) => {
                                            setDeferWeek(event.target.value)
                                        }}
                                    />
                                </label>
                                <Button
                                    variant="secondary"
                                    disabled={!deferWeek}
                                    onClick={() =>
                                        run({
                                            type: 'disposition',
                                            activityId: activity.id,
                                            disposition: 'deferred',
                                            until: weekOf(new Date(`${deferWeek}T12:00:00`), state.settings)
                                        })
                                    }
                                >
                                    Defer
                                </Button>
                                <label>
                                    Dismiss reason (optional)
                                    <input
                                        value={reason}
                                        onChange={(event) => {
                                            setReason(event.target.value)
                                        }}
                                    />
                                </label>
                                <div className="row">
                                    <Button
                                        variant="ghost"
                                        onClick={() =>
                                            run({
                                                type: 'disposition',
                                                activityId: activity.id,
                                                disposition: 'dismissed',
                                                reason
                                            })
                                        }
                                    >
                                        Dismiss
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        onClick={() =>
                                            run({ type: 'disposition', activityId: activity.id, disposition: 'inbox' })
                                        }
                                    >
                                        Return to inbox
                                    </Button>
                                </div>
                                {state.features.map((value) => (
                                    <div key={value.id}>
                                        <label className="row">
                                            <input
                                                type="checkbox"
                                                checked={value.members.includes(activity.id)}
                                                onChange={(event) =>
                                                    run({
                                                        type: 'feature',
                                                        ...value,
                                                        members: event.target.checked
                                                            ? [...value.members, activity.id]
                                                            : value.members.filter((id) => id !== activity.id)
                                                    })
                                                }
                                            />
                                            {value.name}
                                            {value.archived && ' (archived)'}
                                        </label>
                                        {activity.prId && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    run({
                                                        type: 'feature',
                                                        ...value,
                                                        members: value.members.includes(activity.prId!)
                                                            ? value.members.filter((id) => id !== activity.prId)
                                                            : [...value.members, activity.prId!]
                                                    })
                                                }
                                            >
                                                {value.members.includes(activity.prId)
                                                    ? 'Remove PR membership'
                                                    : 'Track future PR work'}
                                            </Button>
                                        )}
                                        {activity.branches.map((name) => (
                                            <Button
                                                key={name}
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    const id = `branch:${activity.repositoryId}:${name}`
                                                    return run({
                                                        type: 'feature',
                                                        ...value,
                                                        members: value.members.includes(id)
                                                            ? value.members.filter((member) => member !== id)
                                                            : [...value.members, id]
                                                    })
                                                }}
                                            >
                                                {value.members.includes(`branch:${activity.repositoryId}:${name}`)
                                                    ? 'Untrack'
                                                    : 'Track'}{' '}
                                                {name}
                                            </Button>
                                        ))}
                                    </div>
                                ))}
                            </details>
                        )}
                    </>
                ) : (
                    <div className="empty">
                        <GitBranch size={36} />
                        <h2>Make room for reflection.</h2>
                        <p>Choose work on the left to inspect changes and see what you’ve already written.</p>
                    </div>
                )}
            </div>
        </section>
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
                    <span>YOUR WORK</span>
                    <span>{items.length}</span>
                </header>
                <div className="filters">
                    <label className="sr-only" htmlFor="search">
                        Search work and journals
                    </label>
                    <input
                        id="search"
                        placeholder="Search work & journals…"
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value)
                        }}
                    />
                    <label>
                        Repository
                        <select
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
                        </select>
                    </label>
                    <label>
                        Feature
                        <select
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
                        </select>
                    </label>
                    <label>
                        Browse
                        <select
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
                        </select>
                    </label>
                    {view === 'branch' && (
                        <fieldset>
                            <legend>Branch comparison</legend>
                            <label>
                                Branch
                                <select
                                    value={branch}
                                    onChange={(event) => {
                                        setBranch(event.target.value)
                                    }}
                                >
                                    <option value="">Choose branch</option>
                                    {repository?.branches.map((name) => (
                                        <option key={name}>{name}</option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                View
                                <select
                                    value={historyView}
                                    onChange={(event) => {
                                        setHistoryView(event.target.value as 'introduced' | 'history')
                                    }}
                                >
                                    <option value="introduced">Introduced relative to base</option>
                                    <option value="history">Reachable history</option>
                                </select>
                            </label>
                            <label>
                                Author filter
                                <input
                                    value={author}
                                    onChange={(event) => {
                                        setAuthor(event.target.value)
                                    }}
                                />
                            </label>
                            <label>
                                From author date
                                <input
                                    type="date"
                                    value={since}
                                    onChange={(event) => {
                                        setSince(event.target.value)
                                    }}
                                />
                            </label>
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
                              <button
                                  className="activity-card"
                                  key={value.id}
                                  onClick={() => {
                                      showEntry(value)
                                  }}
                              >
                                  <span className="eyebrow">JOURNAL · {value.date.slice(0, 10)}</span>
                                  <strong>{value.title}</strong>
                                  <span className="muted">{plainText(value.body).slice(0, 100)}</span>
                              </button>
                          ))
                        : items.map((item) => (
                              <button
                                  className={`activity-card ${selectedId === item.id ? 'selected' : ''}`}
                                  key={item.id}
                                  onClick={() => {
                                      void selectActivity(item)
                                  }}
                              >
                                  <span className="eyebrow">
                                      {item.kind === 'pr' &&
                                      state.coverage.some((link) => link.activityId === item.id) &&
                                      !coveredEntries(state, item).length
                                          ? 'UPDATED WORK'
                                          : item.kind.toUpperCase()}{' '}
                                      · {item.date.slice(0, 10)}
                                  </span>
                                  <strong>{item.title}</strong>
                                  <span className="muted">
                                      {state.repositories.find((value) => value.id === item.repositoryId)?.name} ·{' '}
                                      {item.author}
                                  </span>
                                  <span className="coverage-label">
                                      {draft?.selections.some((selection) => selection.activityId === item.id)
                                          ? 'Included in draft'
                                          : coveredEntries(state, item).length
                                            ? 'Covered'
                                            : item.disposition === 'deferred'
                                              ? `Deferred until ${item.deferUntil}`
                                              : item.disposition === 'dismissed'
                                                ? `Dismissed ${item.reason ?? ''}`
                                                : 'Uncovered'}
                                  </span>
                              </button>
                          ))}
                    {(view === 'entries' ? !entries.length : !items.length) && (
                        <p className="list-empty">
                            {state.repositories.length
                                ? 'No matching activity. Refresh, browse history, or choose another week.'
                                : 'Add your first repository in Settings to start exploring your work.'}
                        </p>
                    )}
                </div>
                <details className="feature-controls">
                    <summary>Manage features</summary>
                    <label>
                        Feature name
                        <input
                            value={featureName}
                            onChange={(event) => {
                                setFeatureName(event.target.value)
                            }}
                        />
                    </label>
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
                </details>
            </section>
        ),
        details,
        draft: (
            <section className="pane draft-pane">
                <header className="pane-header">
                    <span>YOUR REFLECTION</span>
                    <span className="local-label">LOCAL DRAFT</span>
                </header>
                <div className="pane-content">
                    <div className="row between">
                        <label>
                            Draft
                            <select
                                value={draft?.id ?? ''}
                                onChange={async (event) => {
                                    await saveQueue.current
                                    setActiveDraft(state.drafts.find((item) => item.id === event.target.value))
                                    setInsertLink(undefined)
                                }}
                            >
                                <option value="">Choose draft</option>
                                {state.drafts
                                    .filter((item) => item.week === week)
                                    .map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.title}
                                            {item.publishedEntryId ? ' · published' : ''}
                                        </option>
                                    ))}
                            </select>
                        </label>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                                await saveQueue.current
                                const result = await run({ type: 'newDraft', week })
                                if (result) setActiveDraft(result.state.drafts.at(-1))
                            }}
                        >
                            New entry
                        </Button>
                    </div>
                    {draft ? (
                        <>
                            <label className="sr-only" htmlFor="draft-title">
                                Draft title
                            </label>
                            <input
                                id="draft-title"
                                className="draft-title"
                                value={draft.title}
                                disabled={!!draft.publishedEntryId}
                                onChange={(event) => {
                                    editDraft({ ...draft, title: event.target.value })
                                }}
                            />
                            <Editor
                                key={draft.id}
                                value={draft.body}
                                readOnly={!!draft.publishedEntryId}
                                onChange={(body) => {
                                    const latest = draftRef.current
                                    if (latest) editDraft({ ...latest, body })
                                }}
                                insertLink={insertLink}
                            />
                            <div className="selected-work">
                                <h3>
                                    Included work <span className="muted">{draft.selections.length}</span>
                                </h3>
                                {draft.selections.map((selection) => (
                                    <div className="row" key={selection.activityId}>
                                        <span>
                                            {state.activities.find((item) => item.id === selection.activityId)?.title ??
                                                selection.activityId}
                                            {selection.revision && (
                                                <small className="muted"> · Captured revision</small>
                                            )}
                                        </span>
                                        {!draft.publishedEntryId && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    run({
                                                        type: 'select',
                                                        draftId: draft.id,
                                                        activityId: selection.activityId,
                                                        included: false
                                                    })
                                                }
                                            >
                                                Remove
                                            </Button>
                                        )}
                                    </div>
                                ))}
                                <p className="muted">
                                    Coverage is confirmed only after saving to Notion. Selecting work does not add it to
                                    your prose.
                                </p>
                            </div>
                            {state.saves
                                .filter((save) => save.draftId === draft.id && save.status !== 'confirmed')
                                .map((save) => (
                                    <div className="save-warning" key={save.id}>
                                        <p>
                                            {save.status === 'failed'
                                                ? 'Save failed. Your draft is safe.'
                                                : 'Save outcome is uncertain; coverage is pending.'}
                                        </p>
                                        <p>{save.error}</p>
                                        {save.status === 'unknown' && (
                                            <Button
                                                variant="secondary"
                                                onClick={() => run({ type: 'reconcile', saveId: save.id })}
                                            >
                                                Verify Notion save
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            <footer className="draft-footer">
                                <span className="muted" role="status">
                                    {saveStatus}
                                </span>
                                {draft.publishedEntryId ? (
                                    <Button
                                        onClick={() => {
                                            const saved = state.entries.find(
                                                (item) => item.id === draft.publishedEntryId
                                            )
                                            if (saved) showEntry(saved)
                                        }}
                                    >
                                        View saved entry
                                    </Button>
                                ) : (
                                    <Button
                                        loading={busy}
                                        onClick={async () => {
                                            setBusy(true)
                                            await saveQueue.current
                                            const latest = draftRef.current
                                            const persisted = latest
                                                ? await run({ type: 'draft', draft: latest })
                                                : undefined
                                            if (persisted) await run({ type: 'publish', draftId: draft.id })
                                            setBusy(false)
                                        }}
                                    >
                                        Save to Notion ↗
                                    </Button>
                                )}
                            </footer>
                        </>
                    ) : (
                        <div className="empty">
                            <BookOpen size={36} />
                            <h2>What did this week teach you?</h2>
                            <p>
                                Create an entry when you’re ready. Your writing stays on this machine until you save to
                                Notion.
                            </p>
                        </div>
                    )}
                </div>
            </section>
        )
    }
    const layout = state.settings.layout
    const visible = layout.order.filter((id) => !layout.hidden.includes(id))
    return (
        <main className="app">
            <header className="app-header">
                <div className="brand">
                    <BookOpen size={23} />
                    <h1>weekly-j</h1>
                    <span>Work into words.</span>
                </div>
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
                    <label>
                        Week of{' '}
                        <input
                            type="date"
                            value={week}
                            onChange={(event) => {
                                if (event.target.value)
                                    setWeek(weekOf(new Date(`${event.target.value}T12:00:00`), state.settings))
                            }}
                        />
                    </label>
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
                        Writing focus
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => changeLayout(structuredClone(defaultLayout))}>
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
                                {layout.hidden.includes(id) ? 'Show' : 'Hide'} {id}
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
                key={visible.join(':')}
                orientation="horizontal"
                defaultLayout={layout.sizes}
                onLayoutChanged={(sizes) => {
                    if (Object.keys(sizes).some((id) => Math.abs((layout.sizes[id] ?? 0) - sizes[id]) > 0.5))
                        void changeLayout({ ...layout, sizes: { ...layout.sizes, ...sizes } })
                }}
                className="workspace"
            >
                {visible.map((id, index) => (
                    <Fragment key={id}>
                        {index > 0 && (
                            <Separator className="separator" aria-label={`Resize ${visible[index - 1]} and ${id}`} />
                        )}
                        <Panel id={id} minSize={id === 'activity' ? 210 : 280}>
                            {panes[id]}
                        </Panel>
                    </Fragment>
                ))}
            </Group>
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
        </main>
    )
}
