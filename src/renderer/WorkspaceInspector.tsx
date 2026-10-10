import { useEffect, useState } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/arc/tabs/tabs'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { DiffViewer } from './DiffViewer'
import { ActivityRow } from './ActivityRow'
import { ActivityHover } from './ActivityHover'
import { activityLink } from './workspace-model'

interface Props {
    state: State
    activity: Activity
    run: (command: Command) => Promise<Reply | undefined>
    loading?: boolean
    error?: string
    reference?: boolean
    canCite?: boolean
    initialTab?: 'diff' | 'details'
    citationStatus?: string
    onCite: () => void
    onPopout?: () => void
    onClose?: () => void
    onInspect?: (activity: Activity, tab?: 'diff' | 'details') => void
}
export function WorkspaceInspector({
    state,
    activity,
    run,
    loading,
    error,
    reference,
    canCite,
    initialTab = 'diff',
    citationStatus,
    onCite,
    onPopout,
    onClose,
    onInspect
}: Props) {
    const [tab, setTab] = useState<string>(initialTab)
    useEffect(() => setTab(initialTab), [activity.id, initialTab])
    const repository = state.repositories.find((repo) => repo.id === activity.repositoryId)
    const related = state.activities.filter(
        (item) =>
            item.id !== activity.id &&
            item.repositoryId === activity.repositoryId &&
            ((activity.prId && item.prId === activity.prId) ||
                item.branches.some((branch) => branch !== repository?.base && activity.branches.includes(branch)))
    )
    const url = activityLink(activity, state)
    return (
        <section
            className={`ws-inspector ${reference ? 'ws-inspector-detached' : ''}`}
            aria-label="Activity inspector"
            aria-busy={loading}
        >
            <header className="ws-inspector-heading">
                <div>
                    <code>{activity.sha?.slice(0, 7) ?? activity.kind}</code>
                    <span title={activity.title}>{activity.title}</span>
                </div>
                <div>
                    {onPopout && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onPopout}
                            aria-label="Pop out diff"
                            title="Open in a separate window"
                        >
                            <WorkspaceIcon name="popout" />
                            Pop out
                        </Button>
                    )}
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClose}
                            aria-label={reference ? 'Dock back to workspace' : 'Close inspector'}
                        >
                            <WorkspaceIcon name={reference ? 'back' : 'close'} />
                            {reference && 'Dock back'}
                        </Button>
                    )}
                </div>
            </header>
            {reference && (
                <div className="ws-reference-meta">
                    <span>
                        {repository?.name} · {activity.branches.join(', ') || 'No branch'}
                    </span>
                    <span>{activity.author}</span>
                </div>
            )}
            {loading && (
                <div className="ws-skeleton" role="status">
                    <span />
                    <span />
                    <span />
                    <p>Loading changes…</p>
                </div>
            )}
            {error && (
                <div className="ws-inline-error" role="alert">
                    <p>{error}</p>
                    <Button variant="secondary" size="sm" onClick={() => onInspect?.(activity)}>
                        Retry loading diff
                    </Button>
                </div>
            )}
            {activity.kind === 'pr' &&
                state.diffs[activity.id] !== undefined &&
                activity.diffRevision !== activity.revision && (
                    <p className="ws-inline-error">
                        This is a cached diff from an earlier revision. Reload the activity or open GitHub for current
                        changes.
                    </p>
                )}
            <Tabs
                value={tab}
                onValueChange={(value) => {
                    setTab(value)
                    if (
                        value === 'diff' &&
                        (state.diffs[activity.id] === undefined ||
                            (activity.kind === 'pr' && activity.diffRevision !== activity.revision))
                    )
                        onInspect?.(activity, 'diff')
                }}
                className="ws-inspector-tabs"
            >
                <TabsList aria-label="Activity information" edgeToEdge>
                    <TabsTrigger value="diff">Diff</TabsTrigger>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="related">Related · {related.length}</TabsTrigger>
                </TabsList>
                <TabsContent value="diff">
                    <DiffViewer key={activity.id} text={state.diffs[activity.id] ?? ''} initialSplit={reference} />
                </TabsContent>
                <TabsContent value="details">
                    <ScrollArea className="ws-inspector-scroll" label="Activity details" fade={16}>
                        <div className="ws-details-content">
                            <h2>{activity.title}</h2>
                            <p>{activity.description || 'No description was captured for this activity.'}</p>
                            <dl>
                                <div>
                                    <dt>Project</dt>
                                    <dd>{repository?.name}</dd>
                                </div>
                                <div>
                                    <dt>Branch</dt>
                                    <dd>{activity.branches.join(', ') || 'No branch'}</dd>
                                </div>
                                <div>
                                    <dt>Author</dt>
                                    <dd>{activity.author}</dd>
                                </div>
                                <div>
                                    <dt>Comparison</dt>
                                    <dd>{activity.base ?? 'Parent commit'}</dd>
                                </div>
                            </dl>
                            {activity.deletedBranches.length > 0 && (
                                <p>Deleted branches: {activity.deletedBranches.join(', ')}. History is retained.</p>
                            )}
                            <h3>Changed files</h3>
                            <ul className="ws-paths">
                                {activity.files.map((file) => (
                                    <li key={file.name}>
                                        <code>{file.name}</code>
                                        <span>{file.status}</span>
                                    </li>
                                ))}
                            </ul>
                            {url && (
                                <Button variant="secondary" size="sm" onClick={() => run({ type: 'open', url })}>
                                    Open in GitHub
                                    <WorkspaceIcon name="popout" />
                                </Button>
                            )}
                        </div>
                    </ScrollArea>
                </TabsContent>
                <TabsContent value="related">
                    <ScrollArea className="ws-inspector-scroll" label="Related activity" fade={16}>
                        <ActivityHover>
                            <ul className="ws-related-list activity-row-list">
                                {related.length ? (
                                    related.map((item, index) => (
                                        <li key={item.id}>
                                            <ActivityRow
                                                activity={item}
                                                repositoryName={repository?.name ?? 'Repository'}
                                                connected={index < related.length - 1}
                                                className="ws-activity-row"
                                                onClick={() => onInspect?.(item)}
                                            />
                                        </li>
                                    ))
                                ) : (
                                    <li>No related activity has been captured for this branch.</li>
                                )}
                            </ul>
                        </ActivityHover>
                    </ScrollArea>
                </TabsContent>
            </Tabs>
            <footer className="ws-inspector-footer">
                <span role="status">
                    {citationStatus ||
                        (canCite
                            ? 'Keep a little context in your entry.'
                            : reference
                              ? 'Citations go to your open draft.'
                              : 'Start a draft to cite this change.')}
                </span>
                <Button variant="secondary" size="sm" disabled={!canCite} onClick={onCite}>
                    Cite in entry
                </Button>
            </footer>
        </section>
    )
}
