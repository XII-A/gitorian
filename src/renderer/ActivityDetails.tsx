import { CalendarDays, FolderGit2, GitCommitHorizontal, GitCompareArrows, UserRound } from 'lucide-react'
import type { Activity, State } from '../shared/model'
import { ActivityBranches } from './ActivityBranches'
import { ActivityDescription } from './ActivityDescription'
import { ActivityFiles } from './ActivityFiles'
import { PullRequestLifecycle } from './PullRequestLifecycle'
import { isPullRequest } from './pull-request'
import { readableError } from './background-work'
import { Alert } from './components/arc/alert/alert'
import { Button } from './components/arc/button/button'
import { Skeleton } from './components/arc/skeleton/skeleton'
import { EmptyState } from './components/arc/empty-state/empty-state'
import './activity-details.css'

/** The hub and workspace share one presentation of the captured activity. */
export function ActivityDetails({
    activity,
    state,
    loading,
    error,
    onRetry
}: {
    activity: Activity
    state: State
    loading?: boolean
    error?: string
    onRetry: () => void
}) {
    const repository = state.repositories.find((repo) => repo.id === activity.repositoryId)
    return (
        <>
            <dl className="hub-detail-meta">
                <div className="hub-detail-repository">
                    <dt>
                        <FolderGit2 size={16} strokeWidth={1.5} aria-hidden="true" />
                        Repository
                    </dt>
                    <dd>{repository?.name ?? 'Unknown repository'}</dd>
                </div>
                <ActivityBranches key={activity.id} activity={activity} activities={state.activities} />
                <div>
                    <dt>
                        <CalendarDays size={16} strokeWidth={1.5} aria-hidden="true" />
                        {isPullRequest(activity) ? 'Activity date' : 'Date'}
                    </dt>
                    <dd>
                        <time dateTime={activity.date}>
                            {new Date(activity.date).toLocaleString('en-US', {
                                timeZone: state.settings.timezone,
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit'
                            })}
                        </time>
                    </dd>
                </div>
                <div>
                    <dt>
                        <UserRound size={16} strokeWidth={1.5} aria-hidden="true" />
                        Author
                    </dt>
                    <dd>{activity.author || 'Unknown author'}</dd>
                </div>
                <div>
                    <dt>
                        <GitCompareArrows size={16} strokeWidth={1.5} aria-hidden="true" />
                        Comparison
                    </dt>
                    <dd>
                        <code>{activity.base ?? (activity.kind === 'commit' ? 'Parent commit' : 'Not recorded')}</code>
                    </dd>
                </div>
                {activity.sha && (
                    <div>
                        <dt>
                            <GitCommitHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
                            Commit
                        </dt>
                        <dd>
                            <code title={activity.sha}>{activity.sha.slice(0, 12)}</code>
                        </dd>
                    </div>
                )}
            </dl>
            {activity.deletedBranches.length > 0 && (
                <p className="hub-detail-muted">
                    Deleted branches: {activity.deletedBranches.join(', ')}. History is retained.
                </p>
            )}
            <section className="hub-detail-section" aria-label="Description">
                <h3>
                    {activity.kind === 'commit'
                        ? 'Commit message'
                        : activity.kind === 'review'
                          ? 'Review summary'
                          : 'Description'}
                </h3>
                {activity.description.trim() ? (
                    <ActivityDescription activity={activity} repository={repository} />
                ) : (
                    <p className="hub-detail-muted">
                        {activity.kind === 'review' ? 'No written review summary.' : 'No description provided.'}
                    </p>
                )}
            </section>
            {isPullRequest(activity) && (
                <PullRequestLifecycle
                    activity={activity}
                    activities={state.activities}
                    timezone={state.settings.timezone}
                    refreshedAt={state.lastRefreshed}
                />
            )}
            <section className="hub-detail-section" aria-label="Changed files" aria-busy={loading}>
                <h3>Changed files</h3>
                {loading && !activity.filesLoaded ? (
                    <Skeleton lines={4} label="Loading changed files" />
                ) : error ? (
                    <Alert tone="danger" title="Changed files could not be loaded">
                        <span className="hub-detail-error-message">{readableError(error)}</span>
                        <Button variant="secondary" onClick={onRetry}>
                            Retry details
                        </Button>
                    </Alert>
                ) : activity.files.length ? (
                    <ActivityFiles key={activity.id} files={activity.files} />
                ) : activity.filesLoaded ? (
                    <EmptyState
                        title="No changed files"
                        description="Reviews and metadata updates may have no file changes."
                    />
                ) : (
                    <Button variant="secondary" size="sm" onClick={onRetry}>
                        Load changed files
                    </Button>
                )}
            </section>
        </>
    )
}
