import type { Activity, Repository } from '../shared/model'

/** Commit membership does not establish origin. A matching PR head supplies a known source branch. */
export const activityBranches = (activity: Activity, activities: Activity[] = []) => {
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
        label: (() => {
            if (source) {
                return 'Source branch'
            }
            if (activity.kind === 'commit' && primary) {
                return 'Found on'
            }
            return 'Branch'
        })(),
        primary,
        remaining: branches.filter((branch) => branch !== primary)
    }
}

export const changeKinds = ['deleted', 'added', 'renamed', 'modified', 'copied', 'other'] as const
export type ChangeKind = (typeof changeKinds)[number]
export const changeLabels: Record<ChangeKind, string> = {
    added: 'Added',
    copied: 'Copied',
    deleted: 'Deleted',
    modified: 'Modified',
    other: 'Changed',
    renamed: 'Renamed'
}

export const changeKind = (status: string): ChangeKind => {
    const normalized = status.toLowerCase()
    if (normalized === 'removed' || normalized === 'deleted' || /^d\d*$/u.test(normalized)) {
        return 'deleted'
    }
    if (normalized === 'added' || /^a\d*$/u.test(normalized)) {
        return 'added'
    }
    if (normalized === 'renamed' || /^r\d*$/u.test(normalized)) {
        return 'renamed'
    }
    if (normalized === 'modified' || /^m\d*$/u.test(normalized)) {
        return 'modified'
    }
    if (normalized === 'copied' || /^c\d*$/u.test(normalized)) {
        return 'copied'
    }
    return 'other'
}

export const orderedFiles = (files: Activity['files']): Activity['files'] =>
    [...files].toSorted(
        (a, b) =>
            changeKinds.indexOf(changeKind(a.status)) - changeKinds.indexOf(changeKind(b.status)) ||
            a.name.localeCompare(b.name, 'en')
    )

/** GitHub resolves relative Markdown paths against the repository's base branch. */
export const markdownUrl = (value: string, activity: Activity, repository?: Repository): string => {
    try {
        if (!value) {
            return ''
        }
        const remote = repository?.remote.replace(/\.git\/?$/u, '').replace(/\/$/u, '')
        const githubRepository =
            /^(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[:/](?<group1>[^/]+\/[^/]+)$/u.exec(remote ?? '')?.[1] ??
            /^https:\/\/github\.com\/(?<group1>[^/]+\/[^/]+)\//u.exec(activity.url ?? '')?.[1]
        const repositoryUrl = githubRepository ? `https://github.com/${githubRepository}` : remote
        const base = (() => {
            if (value.startsWith('#')) {
                return activity.url
            }
            if (repositoryUrl && /^https?:\/\//u.test(repositoryUrl)) {
                return `${repositoryUrl}/blob/${encodeURIComponent(activity.base ?? repository?.base ?? 'HEAD')}/`
            }
            return activity.url
        })()
        const url = new URL(value, base)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
            return ''
        }
        return url.href
    } catch {
        return ''
    }
}
