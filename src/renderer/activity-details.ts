import type { Activity, Repository } from '../shared/model'
import { providerRemote } from '../shared/provider-accounts'

export function activityProvider(activity: Activity) {
    if (activity.remoteSource) return activity.remoteSource.provider
    if (activity.url?.startsWith('https://gitlab.com/')) return 'gitlab'
    if (activity.url?.startsWith('https://github.com/')) return 'github'
}

/** Commit membership does not establish origin. A matching PR head supplies a known source branch. */
export function activityBranches(activity: Activity, activities: Activity[] = []) {
    const branches = [...new Set(activity.branches.filter(Boolean))]
    const sources =
        activity.kind === 'commit'
            ? [
                  ...new Set(
                      activities
                          .filter(
                              (item) =>
                                  item.repositoryId === activity.repositoryId &&
                                  item.kind !== 'commit' &&
                                  activity.sha &&
                                  item.head === activity.sha
                          )
                          .map((item) => item.branches[0])
                          .filter(Boolean)
                  )
              ]
            : branches.slice(0, 1)
    const source = sources.length === 1 ? sources[0] : undefined
    const primary = source ?? branches[0]
    return {
        primary,
        remaining: branches.filter((branch) => branch !== primary),
        label: source ? 'Source branch' : activity.kind === 'commit' && primary ? 'Found on' : 'Branch'
    }
}

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

/** Resolve relative descriptions against their originating project and base branch. */
export function markdownUrl(value: string, activity: Activity, repository?: Repository): string {
    try {
        if (!value) return ''
        const fromUrl = /^(https:\/\/(?:github\.com|gitlab\.com)\/.+?)\/(?:-\/)?(?:pull|merge_requests|commit)\//.exec(
            activity.url ?? ''
        )?.[1]
        const remote =
            activity.remoteSource ?? providerRemote(fromUrl ?? '') ?? providerRemote(repository?.remote ?? '')
        const repositoryUrl = remote ? `https://${remote.host}/${remote.path}` : undefined
        const base = value.startsWith('#')
            ? activity.url
            : repositoryUrl && /^https?:\/\//.test(repositoryUrl)
              ? `${repositoryUrl}/${remote?.provider === 'gitlab' ? '-/' : ''}blob/${encodeURIComponent(activity.base ?? repository?.base ?? 'HEAD')}/`
              : activity.url
        const url = new URL(value, base)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
        return url.href
    } catch {
        return ''
    }
}
