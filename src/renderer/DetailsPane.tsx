import { Disclosure } from './components/Disclosure'
import { Input, Select, Field } from './components/Fields'
import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { coveredEntries, weekOf } from '../shared/model'
import type { Activity, Command, Draft, Entry, Reply, State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Editor } from './Editor'
import { DiffViewer } from './DiffViewer'

interface DetailsPaneProps {
    state: State
    activity?: Activity
    entry?: Entry
    draft?: Draft
    reference: boolean
    run: (command: Command) => Promise<Reply | undefined>
    showEntry: (entry: Entry) => void
    setInsertLink: (link: { url: string; title: string; nonce: number }) => void
}
export function DetailsPane({
    state,
    activity,
    entry,
    draft,
    reference,
    run,
    showEntry,
    setInsertLink
}: DetailsPaneProps) {
    const [deferWeek, setDeferWeek] = useState('')
    const [reason, setReason] = useState('')
    const [linkEntry, setLinkEntry] = useState('')
    return (
        <section className="pane details">
            <header className="pane-header">
                <span>{entry ? 'Journal entry' : 'Changes'}</span>
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
                        <h2>{activity.title}</h2>
                        <p className="change-origin">
                            {state.repositories.find((item) => item.id === activity.repositoryId)?.name} /{' '}
                            {activity.kind}
                        </p>

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
                        <div className="change-selection">
                            <span>
                                {draft?.selections.some((item) => item.activityId === activity.id)
                                    ? 'Included in this draft'
                                    : 'Excluded from this draft'}
                            </span>
                            {draft && !draft.publishedEntryId && !reference && (
                                <Button
                                    variant="secondary"
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
                        </div>
                        {activity.kind === 'pr' &&
                            state.diffs[activity.id] !== undefined &&
                            activity.diffRevision !== activity.revision && (
                                <p className="save-warning">
                                    Cached diff from an earlier revision. Current changes are unavailable; refresh to
                                    retry or open in GitHub.
                                </p>
                            )}
                        <DiffViewer key={activity.id} text={state.diffs[activity.id] ?? ''} />
                        <Disclosure title="More actions">
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
                                {activity.kind === 'pr' && activity.url && draft && !reference && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setInsertLink({
                                                url: activity.url!,
                                                title: activity.title,
                                                nonce: Date.now()
                                            })
                                        }}
                                    >
                                        Insert PR link
                                    </Button>
                                )}
                            </div>
                        </Disclosure>
                        <Disclosure className="coverage" title="Journal history">
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
                            {!reference && state.entries.length > 0 && (
                                <div className="row">
                                    <Field>
                                        Link existing entry
                                        <Select
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
                                        </Select>
                                    </Field>
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
                        </Disclosure>
                        <p className="description">{activity.description}</p>
                        {activity.files.length > 0 && (
                            <Disclosure title={`${activity.files.length} changed files`}>
                                {activity.files.map((file) => (
                                    <p className="path" key={file.name}>
                                        {file.status} · {file.name}
                                    </p>
                                ))}
                            </Disclosure>
                        )}

                        {!reference && (
                            <Disclosure className="decisions" title="Inbox decisions & features">
                                <Field>
                                    Defer to week
                                    <Input
                                        type="date"
                                        value={deferWeek}
                                        onChange={(event) => {
                                            setDeferWeek(event.target.value)
                                        }}
                                    />
                                </Field>
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
                                <Field>
                                    Dismiss reason (optional)
                                    <Input
                                        value={reason}
                                        onChange={(event) => {
                                            setReason(event.target.value)
                                        }}
                                    />
                                </Field>
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
                                        <Field className="row">
                                            <Input
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
                                        </Field>
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
                            </Disclosure>
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
}
