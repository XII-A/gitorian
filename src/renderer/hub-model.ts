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
