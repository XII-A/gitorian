import type { Activity, State } from '../shared/model'

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
export function activityLink(activity: Activity, state: State) {
    if (activity.url) return activity.url
    const repository = state.repositories.find((repo) => repo.id === activity.repositoryId)
    const remote = repository?.remote.replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '')
    return activity.sha && remote?.startsWith('https://github.com/') ? `${remote}/commit/${activity.sha}` : undefined
}
