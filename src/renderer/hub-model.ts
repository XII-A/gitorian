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

export function draftForWeek(state: State, week: string) {
    return state.drafts.filter((draft) => draft.week === week).at(-1)
}

export function weekEntryAction(state: State, week: string, currentWeek: string) {
    const draft = draftForWeek(state, week)
    const end = offsetDay(week, 6)
    const target = week === currentWeek ? 'this week’s entry' : 'entry'
    if (draft?.publishedEntryId) return { label: `Open ${target}` }
    if (
        draft &&
        (draft.version > 1 ||
            draft.selections.length ||
            (draft.title.trim() && draft.title !== `${week} – ${end}`) ||
            JSON.stringify(draft.body) !== JSON.stringify(state.settings.template))
    )
        return { label: `Continue ${target}` }
    const publishedId =
        (state.activityPage?.since === week && state.activityPage.publishedEntryId) ||
        state.entries.find((entry) => entry.date.slice(0, 10) >= week && entry.date.slice(0, 10) <= end)?.id
    if (publishedId) return { label: `Open ${target}`, readerId: `notion:${publishedId}` }
    return { label: `Write ${target}` }
}
