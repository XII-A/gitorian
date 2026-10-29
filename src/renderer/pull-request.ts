import type { Activity } from '../shared/model'

export function isPullRequest(activity: Activity) {
    return activity.kind === 'change-request' || activity.kind === 'opened' || activity.kind === 'merged'
}

export function changeRequestKey(activity: Activity) {
    return JSON.stringify([
        activity.repositoryId,
        activity.changeRequestId ?? activity.id.replace(/:(opened|merged)$/, '')
    ])
}

export function changeRequestContext(activity: Activity, activities: Activity[]) {
    const key = changeRequestKey(activity)
    const related = activities.filter((item) => isPullRequest(item) && changeRequestKey(item) === key)
    const canonical =
        related.find((item) => item.kind === 'change-request') ??
        related.reduce((latest, item) => (item.date > latest.date ? item : latest), activity)
    const metadata = activity.changeRequest ?? canonical.changeRequest
    const openedAt = metadata?.openedAt ?? related.find((item) => item.kind === 'opened')?.date
    const mergedAt = metadata?.mergedAt ?? related.find((item) => item.kind === 'merged')?.date
    const commitDates = metadata?.commitDates ?? []
    const latestCommitAt = [...commitDates].sort().at(-1)
    return {
        canonical,
        status: metadata?.status ?? (mergedAt || activity.kind === 'merged' ? 'merged' : undefined),
        openedAt,
        mergedAt,
        closedAt: metadata?.closedAt,
        latestCommitAt,
        dates: [...related.map((item) => item.date), ...commitDates, openedAt, metadata?.closedAt, mergedAt].filter(
            (date): date is string => !!date && (!openedAt || date >= openedAt)
        )
    }
}
