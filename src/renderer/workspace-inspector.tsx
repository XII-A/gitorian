import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { useEffect, useMemo, useState } from 'react'

import type { Activity, Command, Reply, State } from '../shared/model'
import { required } from '../shared/required'
import { hasCachedDetails } from './activity-cache'
import { ActivityDetails } from './activity-details-view'
import { readableError } from './background-work'
import { Badge } from './components/arc/badge/badge'
import { Button } from './components/arc/button/button'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/arc/tabs/tabs'
import { WorkspaceIcon } from './components/workspace-icon'
import { DiffSkeleton } from './diff-skeleton'
import { DiffViewer } from './diff-viewer'
import { isPullRequest } from './pull-request'
import { PullRequestStatus } from './pull-request-lifecycle'
import { RelatedActivities } from './related-activities'
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
export const WorkspaceInspector = ({
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
}: Props) => {
    const [tab, setTab] = useState<string>(initialTab)
    useEffect(() => {
        setTab(initialTab)
    }, [activity.id, initialTab])
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
                    if (value === 'diff' && !hasCachedDetails(state, activity)) {
                        onInspect?.(activity, 'diff')
                    }
                    if (value === 'details' && !activity.filesLoaded && !loading) {
                        onInspect?.(activity, 'details')
                    }
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
                                    className="ws-inspector-commit ws-header-chip"
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
                            <Badge className="ws-header-chip" size="sm" animateChanges={false}>
                                {related.length}
                            </Badge>
                        </TabsTrigger>
                    </TabsList>
                </header>
                <TabsContent value="diff">
                    {(() => {
                        if (state.diffs[activity.id] === undefined && (loading || error)) {
                            return loading ? (
                                <DiffSkeleton />
                            ) : (
                                <ScrollArea
                                    className="ws-diff-state"
                                    viewportClassName="ws-diff-state-viewport"
                                    label="Diff status"
                                    fade={0}
                                >
                                    <output style={{ display: 'block' }}>
                                        <EmptyState
                                            iconVariant="plain"
                                            icon={
                                                <WarningCircleIcon
                                                    size={32}
                                                    weight="bold"
                                                    className="ws-diff-error-icon"
                                                />
                                            }
                                            title="Changes couldn't be loaded"
                                            description={readableError(required(error))}
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
                                                            onClick={() => Promise.resolve(run({ type: 'open', url }))}
                                                        >
                                                            Open on GitHub
                                                        </Button>
                                                    )}
                                                </>
                                            }
                                        />
                                    </output>
                                </ScrollArea>
                            )
                        }
                        if (state.diffs[activity.id] === undefined) {
                            return (
                                <output className="ws-diff-loading" style={{ display: 'block' }}>
                                    Changes have not been loaded.
                                </output>
                            )
                        }
                        return (
                            <>
                                {loading && (
                                    <output className="ws-diff-notice" style={{ display: 'block' }}>
                                        Refreshing changes...
                                    </output>
                                )}
                                {error && !loading && (
                                    <output className="ws-diff-notice" style={{ display: 'block' }}>
                                        <p>Changes could not be refreshed. Showing cached changes.</p>
                                        <Button variant="ghost" size="sm" onClick={() => onInspect?.(activity, 'diff')}>
                                            Retry
                                        </Button>
                                    </output>
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
                        )
                    })()}
                </TabsContent>
                <TabsContent value="details">
                    <ScrollArea className="ws-inspector-scroll" label="Activity details" fade={16}>
                        <div className="ws-details-content">
                            <div className="ws-details-heading">
                                <h2>{activity.title}</h2>
                                {(() => {
                                    if (isPullRequest(activity)) {
                                        return <PullRequestStatus activity={activity} activities={state.activities} />
                                    }
                                    if (activity.kind === 'review') {
                                        return <Badge animateChanges={false}>Review</Badge>
                                    }
                                    return null
                                })()}
                            </div>
                            <ActivityDetails
                                activity={activity}
                                state={state}
                                loading={loading}
                                error={activity.filesLoaded ? undefined : error}
                                onRetry={() => onInspect?.(activity, 'details')}
                            />
                            {url && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => Promise.resolve(run({ type: 'open', url }))}
                                >
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
                <output>
                    {citationStatus ||
                        (() => {
                            if (canCite) {
                                return 'Keep a little context in your entry.'
                            }
                            if (reference) {
                                return 'Citations go to your open draft.'
                            }
                            return 'Start a draft to cite this change.'
                        })()}
                </output>
                <Button variant="secondary" size="sm" disabled={!canCite} onClick={onCite}>
                    Cite in entry
                </Button>
            </footer>
        </section>
    )
}
