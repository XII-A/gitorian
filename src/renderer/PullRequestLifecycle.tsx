import { useEffect, useState } from 'react'
import { GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import type { Activity } from '../shared/model'
import { Badge, type BadgeTone } from './components/arc/badge/badge'
import { Timeline, type TimelineEvent } from './components/arc/timeline/timeline'
import { changeRequestContext } from './pull-request'

const statuses = {
    open: { label: 'Open', Icon: GitPullRequest, tone: 'info' },
    draft: { label: 'Draft', Icon: GitPullRequestDraft, tone: 'neutral' },
    closed: { label: 'Closed', Icon: GitPullRequestClosed, tone: 'neutral' },
    merged: { label: 'Merged', Icon: GitMerge, tone: 'success' }
} satisfies Record<string, { label: string; Icon: typeof GitPullRequest; tone: BadgeTone }>

export function PullRequestStatus({ activity, activities }: { activity: Activity; activities: Activity[] }) {
    const { status } = changeRequestContext(activity, activities)
    const presentation = status ? statuses[status] : undefined
    const Icon = presentation?.Icon ?? GitPullRequest
    return (
        <Badge
            tone={presentation?.tone ?? 'neutral'}
            animateChanges={false}
            aria-label={presentation ? `Current status: ${presentation.label}` : 'Status unavailable'}
            icon={<Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
        >
            {presentation?.label ?? 'Status unavailable'}
        </Badge>
    )
}

export function PullRequestLifecycle({
    activity,
    activities,
    timezone,
    refreshedAt
}: {
    activity: Activity
    activities: Activity[]
    timezone: string
    refreshedAt?: string
}) {
    const context = changeRequestContext(activity, activities)
    const requestName = activity.remoteSource?.provider === 'gitlab' ? 'merge request' : 'pull request'
    const [now, setNow] = useState(() => Date.parse(refreshedAt ?? activity.date))
    useEffect(() => {
        setNow(Date.now())
        const interval = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(interval)
    }, [])
    const events: TimelineEvent[] = []
    if (context.openedAt)
        events.push({
            id: 'opened',
            at: context.openedAt,
            title: `Opened ${requestName}`,
            icon: <GitPullRequest aria-hidden="true" />
        })
    if (context.latestCommitAt && context.latestCommitAt !== context.openedAt)
        events.push({
            id: 'commit',
            at: context.latestCommitAt,
            title: 'Latest commit',
            icon: <GitCommitHorizontal aria-hidden="true" />
        })
    if (context.mergedAt)
        events.push({
            id: 'merged',
            at: context.mergedAt,
            title: `Merged ${requestName}`,
            tone: 'success',
            icon: <GitMerge aria-hidden="true" />
        })
    else if (context.closedAt)
        events.push({
            id: 'closed',
            at: context.closedAt,
            title: 'Closed without merging',
            icon: <GitPullRequestClosed aria-hidden="true" />
        })
    return (
        <section
            className="hub-detail-section"
            aria-label={`${requestName === 'merge request' ? 'Merge' : 'Pull'} request lifecycle`}
        >
            <h3>Lifecycle</h3>
            {events.length ? (
                <Timeline
                    key={activity.id}
                    events={events}
                    now={now}
                    label={`${requestName === 'merge request' ? 'Merge' : 'Pull'} request history`}
                    timeZone={timezone}
                    groupByDay={false}
                    scrollToNew={false}
                    className="hub-detail-lifecycle"
                />
            ) : (
                <p className="hub-detail-muted">Refresh activity to load this {requestName}’s status and history.</p>
            )}
        </section>
    )
}
