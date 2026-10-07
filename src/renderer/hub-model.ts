import { localDate } from '../shared/model'
import type { State } from '../shared/model'

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

export function rangeActivities(state: State, start: string, end: string) {
    return state.activities
        .filter((item) => {
            const day = localDate(new Date(item.date), state.settings.timezone)
            return (
                day >= start &&
                day <= end &&
                item.disposition !== 'dismissed' &&
                state.repositories.some((repo) => repo.id === item.repositoryId && !repo.removed)
            )
        })
        .sort((a, b) => b.date.localeCompare(a.date))
}
