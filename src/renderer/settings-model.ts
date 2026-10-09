export function timezoneOptions(current: string) {
    return [...new Set(['UTC', current, ...Intl.supportedValuesOf('timeZone')])]
        .filter(Boolean)
        .sort()
        .map((value) => ({ value, label: value.replaceAll('_', ' ') }))
}
