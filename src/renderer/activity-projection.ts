import { localDate, type State, type Activity } from '../shared/model'
import { isPullRequest, changeRequestContext, changeRequestKey } from './pull-request'

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

export type ActivityDayGroup = [string, Activity[]]
export interface ActivityFilters {
    project?: string
    day?: string
    branch?: string
    kind?: string
    authors?: string[]
    search?: string
}

/** One immutable range projection per activity/repository/timezone change, reused as filters change. */
export function projectActivityRange(state: ActivityRangeState, start: string, end: string) {
    const items = rangeActivities(state, start, end)
    const dates = new Map<string, string>()
    const dayOf = (item: Activity) => {
        let day = dates.get(item.date)
        if (day === undefined) {
            day = localDate(new Date(item.date), state.settings.timezone)
            dates.set(item.date, day)
        }
        return day
    }
    let previousItems: Activity[] | undefined
    return {
        items,
        select({
            project = 'all',
            day = 'all',
            branch = 'all',
            kind = 'all',
            authors = [],
            search = ''
        }: ActivityFilters = {}) {
            const inScope = (item: Activity) =>
                (project === 'all' || item.repositoryId === project) && (day === 'all' || dayOf(item) === day)
            // Chips describe the project/day scope, independently of branch, author, search and selected kind.
            const counts = { all: 0, commit: 0, 'change-request': 0 }
            for (const item of items) {
                if (!inScope(item)) continue
                counts.all++
                counts[item.kind === 'commit' ? 'commit' : 'change-request']++
            }
            const source = kind === 'previous' ? (previousItems ??= rangeActivities(state, start, end, true)) : items
            const authorTerms = authors.map((author) => author.toLowerCase())
            const query = search.toLowerCase()
            const selected: Activity[] = []
            const groups = new Map<string, Activity[]>()
            let matchingCount = 0
            for (const item of source) {
                if (
                    (project !== 'all' && item.repositoryId !== project) ||
                    (branch !== 'all' && !item.branches.includes(branch)) ||
                    (authorTerms.length && !authorTerms.some((author) => item.author.toLowerCase().includes(author))) ||
                    (kind === 'previous'
                        ? !item.previousSource
                        : kind !== 'all' && (kind === 'commit' ? item.kind !== 'commit' : item.kind === 'commit')) ||
                    (query && !`${item.title} ${item.sha ?? ''} ${item.description}`.toLowerCase().includes(query))
                )
                    continue
                // Preserve aggregate-week virtualization even when a moderate day is selected first.
                matchingCount++
                if (day !== 'all' && dayOf(item) !== day) continue
                selected.push(item)
                const itemDay = dayOf(item)
                const group = groups.get(itemDay) ?? []
                group.push(item)
                groups.set(itemDay, group)
            }
            return { items: selected, matchingCount, counts, groups: [...groups] satisfies ActivityDayGroup[] }
        }
    }
}
