import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { ChevronRight, Folder, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest } from 'lucide-react'
import type { Activity } from '../shared/model'
import type { RepositoryMarkerStyle } from './repository-markers'
import './activity-row.css'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    activity: Activity
    repositoryName: string
    connected?: boolean
    repositoryMarker?: RepositoryMarkerStyle
    repositoryGroup?: string
}

const labels: Record<Activity['kind'], string> = {
    commit: 'Commit',
    'change-request': 'Pull request',
    review: 'Review',
    opened: 'Opened',
    merged: 'Merged'
}

export function ActivityRow({
    activity,
    repositoryName,
    connected,
    repositoryMarker,
    repositoryGroup,
    className,
    ...props
}: Props) {
    const Icon =
        activity.kind === 'commit' ? GitCommitHorizontal : activity.kind === 'merged' ? GitMerge : GitPullRequest
    const pullNumber = activity.remoteSource?.number ?? activity.changeRequestId?.match(/(?:^|[:/])(\d+)$/)?.[1]
    const reference =
        activity.kind === 'commit'
            ? activity.sha?.slice(0, 7)
            : pullNumber
              ? `${activity.remoteSource?.provider === 'gitlab' ? '!' : '#'}${pullNumber}`
              : undefined
    const kindLabel =
        activity.remoteSource?.provider === 'gitlab' && activity.kind === 'change-request'
            ? 'Merge request'
            : activity.remoteSource?.provider === 'gitlab' && activity.kind === 'review'
              ? 'Review comment'
              : labels[activity.kind]
    return (
        <button
            {...props}
            type="button"
            className={['activity-row', className].filter(Boolean).join(' ')}
            data-activity-id={activity.id}
            data-repository-id={activity.repositoryId}
            data-repository-group={repositoryGroup}
            data-kind={activity.kind}
            data-connected={connected || undefined}
        >
            <span className="activity-row-node" aria-hidden="true">
                <Icon size={14} strokeWidth={1.75} />
            </span>
            <span className="activity-row-content">
                <span className="activity-row-kind">{kindLabel}: </span>
                <span className="activity-row-title">{activity.title.trim() || 'Untitled activity'}</span>
                <span className="activity-row-meta">
                    <span title={repositoryName}>
                        {repositoryMarker ? (
                            <span
                                className="activity-repository-marker"
                                data-shape={repositoryMarker.shape}
                                style={{ '--repository-color': repositoryMarker.color } as CSSProperties}
                                aria-hidden="true"
                            />
                        ) : (
                            <Folder size={12} strokeWidth={1.75} aria-hidden="true" />
                        )}
                        {repositoryName}
                    </span>
                    {activity.branches[0] && (
                        <span title={activity.branches[0]}>
                            <GitBranch size={12} strokeWidth={1.75} aria-hidden="true" />
                            {activity.branches[0]}
                        </span>
                    )}
                    {reference && <span className="activity-row-reference">{reference}</span>}
                </span>
            </span>
            <ChevronRight size={14} strokeWidth={1.75} className="activity-row-chevron" aria-hidden="true" />
        </button>
    )
}
