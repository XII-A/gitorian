import type { Repository, State } from '../shared/model'

export const timezoneOptions = (current: string) =>
    [...new Set(['UTC', current, ...Intl.supportedValuesOf('timeZone')])]
        .filter(Boolean)
        .toSorted()
        .map((value) => ({ label: value.replaceAll('_', ' '), value }))

/** Only compare editable fields; refreshes and immediately saved connection/folder actions are not form edits. */
export const hasUnsavedSettings = (
    settings: State['settings'],
    repositories: Repository[],
    saved: State,
    token: string
) => {
    const editable = (preferences: State['settings'], repos: Repository[]) => ({
        destination: preferences.destination,
        githubClientId: preferences.githubClientId,
        refreshMinutes: preferences.refreshMinutes,
        repositories: repos
            .map(({ id, base, remote, trackingStart, emails, removed }) => ({
                base,
                emails,
                id,
                remote,
                removed,
                trackingStart
            }))
            .toSorted((a, b) => a.id.localeCompare(b.id)),
        template: preferences.template,
        timezone: preferences.timezone,
        weekStart: preferences.weekStart
    })
    const serialize = (value: unknown) =>
        JSON.stringify(value, (_, item: unknown) =>
            item && typeof item === 'object' && !Array.isArray(item)
                ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
                : item
        )
    return (
        !!token ||
        serialize(editable(settings, repositories)) !== serialize(editable(saved.settings, saved.repositories))
    )
}
