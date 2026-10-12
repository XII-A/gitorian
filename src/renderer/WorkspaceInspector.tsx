import { EmptyState } from './components/arc/empty-state/empty-state'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { readableError } from './background-work'
import { useEffect, useMemo, useState } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/arc/tabs/tabs'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { DiffViewer } from './DiffViewer'
import { ActivityDetails } from './ActivityDetails'
import { RelatedActivities } from './RelatedActivities'
import { DiffSkeleton } from './DiffSkeleton'
import { PullRequestStatus } from './PullRequestLifecycle'
import { isPullRequest } from './pull-request'
import { Badge } from './components/arc/badge/badge'
import { activityLink } from './workspace-model'
import { hasCachedDetails } from './activity-cache'

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
    const related = useMemo(
        () =>
            state.activities.filter(
                (item) =>
                    item.id !== activity.id &&
                    item.repositoryId === activity.repositoryId &&
                    ((activity.prId && item.prId === activity.prId) ||
                        item.branches.some(
                            (branch) => branch !== repository?.base && activity.branches.includes(branch)
                        ))
            ),
        [state.activities, activity.id, activity.repositoryId, activity.prId, activity.branches, repository?.base]
    )
    const url = activityLink(activity, state)
    return (
        <section
            className={`ws-inspector ${reference ? 'ws-inspector-detached' : ''}`}
            aria-label="Activity inspector"
            aria-busy={loading}
        >
            <Tabs
                value={tab}
                variant="underline"
                onValueChange={(value) => {
                    setTab(value)
                    if (value === 'diff' && !hasCachedDetails(state, activity)) onInspect?.(activity, 'diff')
                    if (value === 'details' && !activity.filesLoaded && !loading) onInspect?.(activity, 'details')
                }}
                className="ws-inspector-tabs"
            >
                <header className="ws-inspector-header">
                    <div className="ws-inspector-heading">
                        <div className="ws-inspector-summary">
                            <span className="ws-inspector-title" title={activity.title}>
                                {activity.title}
                            </span>
                            {activity.sha && (
                                <Badge
                                    className="ws-inspector-commit"
                                    animateChanges={false}
                                    size="sm"
                                    title={activity.sha}
                                >
                                    <code>{activity.sha.slice(0, 7)}</code>
                                </Badge>
                            )}
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
                    </div>
                    <TabsList aria-label="Activity information" className="ws-inspector-tab-list" edgeToEdge>
                        <TabsTrigger value="diff">Diff</TabsTrigger>
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="related">
                            Related{' '}
                            <Badge size="sm" animateChanges={false}>
                                {related.length}
                            </Badge>
                        </TabsTrigger>
                    </TabsList>
                </header>
                <TabsContent value="diff">
                    {state.diffs[activity.id] === undefined && (loading || error) ? (
                        loading ? (
                            <DiffSkeleton />
                        ) : (
                            <ScrollArea
                                className="ws-diff-state"
                                viewportClassName="ws-diff-state-viewport"
                                label="Diff status"
                                fade={0}
                            >
                                <div role="status">
                                    <EmptyState
                                        iconVariant="plain"
                                        icon={
                                            <WarningCircleIcon size={32} weight="bold" className="ws-diff-error-icon" />
                                        }
                                        title="Changes couldn't be loaded"
                                        description={readableError(error!)}
                                        action={
                                            <>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => onInspect?.(activity, 'diff')}
                                                >
                                                    Retry
                                                </Button>
                                                {url && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => run({ type: 'open', url })}
                                                    >
                                                        Open on GitHub
                                                    </Button>
                                                )}
                                            </>
                                        }
                                    />
                                </div>
                            </ScrollArea>
                        )
                    ) : state.diffs[activity.id] === undefined ? (
                        <div className="ws-diff-loading" role="status">
                            Changes have not been loaded.
                        </div>
                    ) : (
                        <>
                            {loading && (
                                <p className="ws-diff-notice" role="status">
                                    Refreshing changes...
                                </p>
                            )}
                            {error && !loading && (
                                <div className="ws-diff-notice" role="status">
                                    <p>Changes could not be refreshed. Showing cached changes.</p>
                                    <Button variant="ghost" size="sm" onClick={() => onInspect?.(activity, 'diff')}>
                                        Retry
                                    </Button>
                                </div>
                            )}
                            {activity.kind === 'pr' && activity.diffRevision !== activity.revision && !error && (
                                <p className="ws-diff-notice">Showing changes from an earlier revision.</p>
                            )}
                            <DiffViewer
                                key={activity.id}
                                text={state.diffs[activity.id]}
                                onOpenSource={
                                    url
                                        ? () => {
                                              void run({ type: 'open', url })
                                          }
                                        : undefined
                                }
                                initialSplit={reference}
                            />
                        </>
                    )}
                </TabsContent>
                <TabsContent value="details">
                    <ScrollArea className="ws-inspector-scroll" label="Activity details" fade={16}>
                        <div className="ws-details-content">
                            <div className="ws-details-heading">
                                <h2>{activity.title}</h2>
                                {isPullRequest(activity) ? (
                                    <PullRequestStatus activity={activity} activities={state.activities} />
                                ) : activity.kind === 'review' ? (
                                    <Badge animateChanges={false}>Review</Badge>
                                ) : null}
                            </div>
                            <ActivityDetails
                                activity={activity}
                                state={state}
                                loading={loading}
                                error={!activity.filesLoaded ? error : undefined}
                                onRetry={() => onInspect?.(activity, 'details')}
                            />
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
                    <RelatedActivities
                        key={activity.id}
                        activities={related}
                        repositoryName={repository?.name ?? 'Repository'}
                        onInspect={onInspect}
                    />
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
