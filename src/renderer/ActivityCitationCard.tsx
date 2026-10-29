import { Quote } from 'lucide-react'
import type { Activity } from '../shared/model'
import { Badge } from './components/arc/badge/badge'
import './activity-citation-card.css'

export function ActivityCitationCard({
    activity,
    repositoryName,
    ready = false
}: {
    activity: Activity
    repositoryName: string
    ready?: boolean
}) {
    const pullNumber = activity.prId?.match(/(?:^|[:/])(\d+)$/)?.[1]
    const reference = activity.kind === 'commit' ? activity.sha?.slice(0, 7) : pullNumber ? `#${pullNumber}` : undefined
    return (
        <div className="activity-citation-card" data-ready={ready || undefined}>
            <div className="activity-citation-heading">
                <Quote size={16} aria-hidden="true" />
                <Badge tone="neutral" size="sm" animateChanges={false}>
                    Activity citation
                </Badge>
                {reference && <span className="activity-citation-reference">{reference}</span>}
            </div>
            <span className="activity-citation-title">{activity.title}</span>
            <span className="activity-citation-repository">{repositoryName}</span>
            <span className="activity-citation-hint">{ready ? 'Release to cite' : 'Drop into your writing'}</span>
        </div>
    )
}
