import type { Repository, State } from '../shared/model'

export function timezoneOptions(current: string) {
    return [...new Set(['UTC', current, ...Intl.supportedValuesOf('timeZone')])]
        .filter(Boolean)
        .sort()
        .map((value) => ({ value, label: value.replaceAll('_', ' ') }))
}

/** Only compare editable fields; refreshes and immediately saved connection/folder actions are not form edits. */
export function hasUnsavedSettings(settings: State['settings'], repositories: Repository[], saved: State) {
    const editable = (preferences: State['settings'], repos: Repository[]) => ({
        weekStart: preferences.weekStart,
        timezone: preferences.timezone,
        refreshMinutes: preferences.refreshMinutes,
        template: preferences.template,
        repositories: repos
            .map(({ id, base, remote, trackingStart, emails, removed }) => ({
                id,
                base,
                remote,
                trackingStart,
                emails,
                removed
            }))
            .sort((a, b) => a.id.localeCompare(b.id))
    })
    const serialize = (value: unknown) =>
        JSON.stringify(value, (_, item: unknown) =>
            item && typeof item === 'object' && !Array.isArray(item)
                ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
                : item
        )
    return serialize(editable(settings, repositories)) !== serialize(editable(saved.settings, saved.repositories))
}
