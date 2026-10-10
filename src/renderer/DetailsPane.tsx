import { Disclosure } from './components/Disclosure'
import { Input, Field } from './components/Fields'
import { GitBranch } from 'lucide-react'
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
    setInsertLink: (link: { url: string; title: string; nonce: number }) => void
}
export function DetailsPane({ state, activity, entry, draft, reference, run, setInsertLink }: DetailsPaneProps) {
    return (
        <section className="pane details">
            <header className="pane-header">
                <span>{entry ? 'Journal entry' : 'Inspector'}</span>
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
                        {activity.kind === 'pr' &&
                            state.diffs[activity.id] !== undefined &&
                            activity.diffRevision !== activity.revision && (
                                <p className="save-warning">
                                    Cached diff from an earlier revision. Current changes are unavailable; refresh to
                                    retry or open in GitHub.
                                </p>
                            )}
                        <DiffViewer
                            key={activity.id}
                            text={state.diffs[activity.id] ?? ''}
                            onOpenSource={
                                activity.url
                                    ? () => {
                                          void run({ type: 'open', url: activity.url! })
                                      }
                                    : undefined
                            }
                        />
                        {!reference && (
                            <Disclosure className="decisions" title="Features">
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
                        <p>Choose work on the left to inspect changes while you write.</p>
                    </div>
                )}
            </div>
        </section>
    )
}
