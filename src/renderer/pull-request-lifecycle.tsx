import { GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Activity } from '../shared/model'
import type { BadgeTone } from './components/arc/badge/badge'
import { Badge } from './components/arc/badge/badge'
import type { TimelineEvent } from './components/arc/timeline/timeline'
import { Timeline } from './components/arc/timeline/timeline'
import { pullRequestContext } from './pull-request'

const statuses = {
    closed: { Icon: GitPullRequestClosed, label: 'Closed', tone: 'neutral' },
    draft: { Icon: GitPullRequestDraft, label: 'Draft', tone: 'neutral' },
    merged: { Icon: GitMerge, label: 'Merged', tone: 'success' },
    open: { Icon: GitPullRequest, label: 'Open', tone: 'info' }
} satisfies Record<string, { label: string; Icon: typeof GitPullRequest; tone: BadgeTone }>

export const PullRequestStatus = ({ activity, activities }: { activity: Activity; activities: Activity[] }) => {
    const { status } = pullRequestContext(activity, activities)
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

export const PullRequestLifecycle = ({
    activity,
    activities,
    timezone,
    refreshedAt
}: {
    activity: Activity
    activities: Activity[]
    timezone: string
    refreshedAt?: string
}) => {
    const context = pullRequestContext(activity, activities)
    const [now, setNow] = useState(() => Date.parse(refreshedAt ?? activity.date))
    useEffect(() => {
        setNow(Date.now())
        const interval = setInterval(() => {
            setNow(Date.now())
        }, 60_000)
        return () => {
            clearInterval(interval)
        }
    }, [])
    const events: TimelineEvent[] = []
    if (context.openedAt) {
        events.push({
            at: context.openedAt,
            icon: <GitPullRequest aria-hidden="true" />,
            id: 'opened',
            title: 'Opened pull request'
        })
    }
    if (context.latestCommitAt && context.latestCommitAt !== context.openedAt) {
        events.push({
            at: context.latestCommitAt,
            icon: <GitCommitHorizontal aria-hidden="true" />,
            id: 'commit',
            title: 'Latest commit'
        })
    }
    if (context.mergedAt) {
        events.push({
            at: context.mergedAt,
            icon: <GitMerge aria-hidden="true" />,
            id: 'merged',
            title: 'Merged pull request',
            tone: 'success'
        })
    } else if (context.closedAt) {
        events.push({
            at: context.closedAt,
            icon: <GitPullRequestClosed aria-hidden="true" />,
            id: 'closed',
            title: 'Closed without merging'
        })
    }
    return (
        <section className="hub-detail-section" aria-label="Pull request lifecycle">
            <h3>Lifecycle</h3>
            {events.length ? (
                <Timeline
                    key={activity.id}
                    events={events}
                    now={now}
                    label="Pull request history"
                    timeZone={timezone}
                    groupByDay={false}
                    scrollToNew={false}
                    className="hub-detail-lifecycle"
                />
            ) : (
                <p className="hub-detail-muted">Refresh activity to load this pull request’s status and history.</p>
            )}
        </section>
    )
}
