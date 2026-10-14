import type { Activity, State } from '../shared/model'
import { localDate } from '../shared/model'
import { isPullRequest, pullRequestContext, pullRequestKey } from './pull-request'

export const offsetDay = (date: string, offset: number) => {
    const value = new Date(`${date}T12:00:00Z`)
    value.setUTCDate(value.getUTCDate() + offset)
    return value.toISOString().slice(0, 10)
}

// A picker value is already a calendar date in the journal's timezone.
export const journalWeek = (date: string, weekStart: number) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay()
    return offsetDay(date, -((day - weekStart + 7) % 7))
}

export const rangeActivities = (state: State, start: string, end: string) => {
    const inRange = (date: string) => {
        const day = localDate(new Date(date), state.settings.timezone)
        return day >= start && day <= end
    }
    const activeRepositories = new Set(state.repositories.filter((repo) => !repo.removed).map((repo) => repo.id))
    const items: Activity[] = []
    const pulls = new Map<string, Activity[]>()
    for (const activity of state.activities) {
        if (!activeRepositories.has(activity.repositoryId)) {
            continue
        }
        if (isPullRequest(activity)) {
            const key = pullRequestKey(activity)
            const related = pulls.get(key) ?? []
            related.push(activity)
            pulls.set(key, related)
        } else if (inRange(activity.date)) {
            items.push(activity)
        }
    }
    for (const related of pulls.values()) {
        const context = pullRequestContext(related[0], related)
        const date = context.dates.filter(inRange).toSorted().at(-1)
        if (!date) {
            continue
        }
        const { canonical } = context
        items.push({
            ...canonical,
            date,
            kind: 'pr',
            title:
                canonical.kind === 'pr' ? canonical.title : canonical.title.replace(/^(?<group1>Opened|Merged) /u, '')
        })
    }
    return items.toSorted((a, b) => b.date.localeCompare(a.date))
}
