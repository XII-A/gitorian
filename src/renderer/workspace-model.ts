import type { Activity, State } from '../shared/model'
import { offsetDay, rangeActivities } from './hub-model'
import type { ActivityRangeState } from './hub-model'

export const dateValue = (value: string) => new Date(`${value}T12:00:00`)
export const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dayFormatters = new Map<string, Intl.DateTimeFormat>()
export function formatDay(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
    const key = JSON.stringify(options)
    let formatter = dayFormatters.get(key)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', options)
        if (dayFormatters.size >= 32) dayFormatters.delete(dayFormatters.keys().next().value!)
        dayFormatters.set(key, formatter)
    }
    return formatter.format(dateValue(date))
}
export function filterWorkspaceActivity(
    state: ActivityRangeState,
    start: string,
    filters: { project: string; branch: string; kind: string; search: string; authors?: string[] }
) {
    return rangeActivities(state, start, offsetDay(start, 6), filters.kind === 'previous').filter(
        (activity) =>
            (filters.project === 'all' || activity.repositoryId === filters.project) &&
            (filters.branch === 'all' || activity.branches.includes(filters.branch)) &&
            (!filters.authors?.length ||
                filters.authors.some((author) => activity.author.toLowerCase().includes(author.toLowerCase()))) &&
            (filters.kind === 'previous'
                ? activity.previousSource
                : filters.kind === 'all' ||
                  (filters.kind === 'commit' ? activity.kind === 'commit' : activity.kind !== 'commit')) &&
            `${activity.title} ${activity.sha ?? ''} ${activity.description}`
                .toLowerCase()
                .includes(filters.search.toLowerCase())
    )
}
export function activityLink(activity: Activity, state: State) {
    if (activity.url) return activity.url
    const repository = state.repositories.find((repo) => repo.id === activity.repositoryId)
    const remote = repository?.remote.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '')
    return activity.sha && remote?.startsWith('https://github.com/') ? `${remote}/commit/${activity.sha}` : undefined
}
