import type { Activity } from '../shared/model'

export const isPullRequest = (activity: Activity) =>
    activity.kind === 'pr' || activity.kind === 'opened' || activity.kind === 'merged'

export const pullRequestKey = (activity: Activity) =>
    JSON.stringify([activity.repositoryId, activity.prId ?? activity.id.replace(/:(?<group1>opened|merged)$/u, '')])

export const pullRequestContext = (activity: Activity, activities: Activity[]) => {
    const key = pullRequestKey(activity)
    const related = activities.filter((item) => isPullRequest(item) && pullRequestKey(item) === key)
    const canonical =
        related.find((item) => item.kind === 'pr') ??
        related.reduce((latest, item) => (item.date > latest.date ? item : latest), activity)
    const metadata = activity.pullRequest ?? canonical.pullRequest
    const openedAt = metadata?.openedAt ?? related.find((item) => item.kind === 'opened')?.date
    const mergedAt = metadata?.mergedAt ?? related.find((item) => item.kind === 'merged')?.date
    const commitDates = metadata?.commitDates ?? []
    const latestCommitAt = [...commitDates].toSorted().at(-1)
    return {
        canonical,
        closedAt: metadata?.closedAt,
        dates: [...related.map((item) => item.date), ...commitDates, openedAt, metadata?.closedAt, mergedAt].filter(
            (date): date is string => !!date && (!openedAt || date >= openedAt)
        ),
        latestCommitAt,
        mergedAt,
        openedAt,
        status: metadata?.status ?? (mergedAt || activity.kind === 'merged' ? 'merged' : undefined)
    }
}
