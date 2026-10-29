import { localDate } from '../shared/model'
import type { State } from '../shared/model'
import type { Activity } from '../shared/model'
import { isPullRequest, changeRequestContext, changeRequestKey } from './pull-request'

export function offsetDay(date: string, offset: number) {
    const value = new Date(`${date}T12:00:00Z`)
    value.setUTCDate(value.getUTCDate() + offset)
    return value.toISOString().slice(0, 10)
}

// A picker value is already a calendar date in the journal's timezone.
export function journalWeek(date: string, weekStart: number) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay()
    return offsetDay(date, -((day - weekStart + 7) % 7))
}

export type ActivityRangeState = Pick<State, 'activities' | 'repositories'> & {
    settings: Pick<State['settings'], 'timezone'>
}

export function rangeActivities(state: ActivityRangeState, start: string, end: string, includePrevious = false) {
    const inRange = (date: string) => {
        const day = localDate(new Date(date), state.settings.timezone)
        return day >= start && day <= end
    }
    const activeRepositories = new Set(state.repositories.filter((repo) => !repo.removed).map((repo) => repo.id))
    const items: Activity[] = []
    const pulls = new Map<string, Activity[]>()
    for (const activity of state.activities) {
        if (activity.previousSource && !includePrevious) continue
        if (!activeRepositories.has(activity.repositoryId)) continue
        if (isPullRequest(activity)) {
            const key = changeRequestKey(activity)
            const related = pulls.get(key) ?? []
            related.push(activity)
            pulls.set(key, related)
        } else if (inRange(activity.date)) items.push(activity)
    }
    for (const related of pulls.values()) {
        const context = changeRequestContext(related[0], related)
        const date = context.dates.filter(inRange).sort().at(-1)
        if (!date) continue
        const canonical = context.canonical
        items.push({
            ...canonical,
            kind: 'change-request',
            title:
                canonical.kind === 'change-request'
                    ? canonical.title
                    : canonical.title.replace(/^(Opened|Merged) /, ''),
            date
        })
    }
    return items.sort((a, b) => b.date.localeCompare(a.date))
}
