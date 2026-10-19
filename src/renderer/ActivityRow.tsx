import type { ButtonHTMLAttributes } from 'react'
import { ChevronRight, Folder, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest } from 'lucide-react'
import type { Activity } from '../shared/model'
import { Badge } from './components/arc/badge/badge'
import './activity-row.css'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    activity: Activity
    repositoryName: string
    connected?: boolean
}

const labels: Record<Activity['kind'], string> = {
    commit: 'Commit',
    pr: 'Pull request',
    review: 'Review',
    opened: 'Opened',
    merged: 'Merged'
}

export function ActivityRow({ activity, repositoryName, connected, className, ...props }: Props) {
    const Icon =
        activity.kind === 'commit' ? GitCommitHorizontal : activity.kind === 'merged' ? GitMerge : GitPullRequest
    const pullNumber = activity.prId?.match(/(?:^|[:/])(\d+)$/)?.[1]
    const reference = activity.kind === 'commit' ? activity.sha?.slice(0, 7) : pullNumber ? `#${pullNumber}` : undefined
    return (
        <button
            {...props}
            type="button"
            className={['activity-row', className].filter(Boolean).join(' ')}
            data-kind={activity.kind}
            data-connected={connected || undefined}
        >
            <span className="activity-row-node" aria-hidden="true">
                <Icon size={14} strokeWidth={1.75} />
            </span>
            <span className="activity-row-content">
                <span className="activity-row-title">{activity.title}</span>
                <span className="activity-row-meta">
                    <span title={repositoryName}>
                        <Folder size={12} strokeWidth={1.75} aria-hidden="true" />
                        {repositoryName}
                    </span>
                    {activity.branches[0] && (
                        <span title={activity.branches[0]}>
                            <GitBranch size={12} strokeWidth={1.75} aria-hidden="true" />
                            {activity.branches[0]}
                        </span>
                    )}
                </span>
            </span>
            <span className="activity-row-trailing">
                <Badge
                    className="activity-row-status"
                    tone={activity.kind === 'merged' ? 'success' : 'neutral'}
                    size="sm"
                    animateChanges={false}
                >
                    {labels[activity.kind]}
                </Badge>
                {reference && <span className="activity-row-reference">{reference}</span>}
            </span>
            <ChevronRight size={14} strokeWidth={1.75} className="activity-row-chevron" aria-hidden="true" />
        </button>
    )
}
