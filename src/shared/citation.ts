const prefix = '#gitorian-activity='

export function localCitationHref(id: string) {
    return prefix + encodeURIComponent(id)
}

export function localCitationId(href: string) {
    if (href.startsWith(prefix)) return new URLSearchParams(href.slice(1)).get('gitorian-activity')
    return null
}
