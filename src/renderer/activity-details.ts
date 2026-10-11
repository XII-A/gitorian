import type { Activity, Repository } from '../shared/model'

export const changeKinds = ['deleted', 'added', 'renamed', 'modified', 'copied', 'other'] as const
export type ChangeKind = (typeof changeKinds)[number]
export const changeLabels: Record<ChangeKind, string> = {
    deleted: 'Deleted',
    added: 'Added',
    renamed: 'Renamed',
    modified: 'Modified',
    copied: 'Copied',
    other: 'Changed'
}

export function changeKind(status: string): ChangeKind {
    const normalized = status.toLowerCase()
    if (normalized === 'removed' || normalized === 'deleted' || /^d\d*$/.test(normalized)) return 'deleted'
    if (normalized === 'added' || /^a\d*$/.test(normalized)) return 'added'
    if (normalized === 'renamed' || /^r\d*$/.test(normalized)) return 'renamed'
    if (normalized === 'modified' || /^m\d*$/.test(normalized)) return 'modified'
    if (normalized === 'copied' || /^c\d*$/.test(normalized)) return 'copied'
    return 'other'
}

export function orderedFiles(files: Activity['files']): Activity['files'] {
    return [...files].sort(
        (a, b) =>
            changeKinds.indexOf(changeKind(a.status)) - changeKinds.indexOf(changeKind(b.status)) ||
            a.name.localeCompare(b.name, 'en')
    )
}

/** GitHub resolves relative Markdown paths against the repository's base branch. */
export function markdownUrl(value: string, activity: Activity, repository?: Repository): string {
    try {
        if (!value) return ''
        const remote = repository?.remote.replace(/\.git\/?$/, '').replace(/\/$/, '')
        const githubRepository =
            /^(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[:/]([^/]+\/[^/]+)$/.exec(remote ?? '')?.[1] ??
            /^https:\/\/github\.com\/([^/]+\/[^/]+)\//.exec(activity.url ?? '')?.[1]
        const repositoryUrl = githubRepository ? `https://github.com/${githubRepository}` : remote
        const base = value.startsWith('#')
            ? activity.url
            : repositoryUrl && /^https?:\/\//.test(repositoryUrl)
              ? `${repositoryUrl}/blob/${encodeURIComponent(activity.base ?? repository?.base ?? 'HEAD')}/`
              : activity.url
        const url = new URL(value, base)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
        return url.href
    } catch {
        return ''
    }
}
