import { Effect } from 'effect'
import type { Activity, Repository } from '../shared/model'
import { providerRemote, remoteConfiguration } from '../shared/provider-accounts'
import type { ActivityScan } from './contribution-reader'
import { fingerprint } from './git'

interface User {
    id: number
    username: string
}
interface MergeRequest {
    iid: number
    title: string
    description: string | null
    web_url: string
    author: User
    created_at: string
    updated_at: string
    merged_at?: string | null
    closed_at?: string | null
    state: string
    draft?: boolean
    source_branch: string
    target_branch: string
    sha: string
    changes_count?: string
    merge_commit_sha?: string
    diff_refs?: { base_sha: string; head_sha: string; start_sha: string }
}
interface Commit {
    id: string
    title: string
    message: string
    author_email: string
    authored_date: string
    web_url: string
}
interface Note {
    id: number
    body: string
    author: User
    created_at: string
    system: boolean
}
interface Diff {
    old_path: string
    new_path: string
    diff: string
    new_file?: boolean
    deleted_file?: boolean
    renamed_file?: boolean
    too_large?: boolean
    collapsed?: boolean
    a_mode?: string
    b_mode?: string
}
export class GitLabFailure extends Error {
    readonly _tag = 'GitLabFailure'
}

export function makeGitLab(
    request: <A>(path: string, background?: boolean) => Effect.Effect<A, Error>,
    userId: string
) {
    const project = (repository: Repository) => {
        const remote = providerRemote(repository.remote)
        return remote?.provider === 'gitlab' ? `projects/${encodeURIComponent(remote.path)}` : undefined
    }
    const list = <A>(path: string, background = false): Effect.Effect<A[], Error> =>
        Effect.gen(function* () {
            const result: A[] = []
            for (let page = 1; page <= 30; page++) {
                const items = yield* request<A[]>(
                    `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
                    background
                )
                result.push(...items)
                if (items.length < 100) return result
            }
            return yield* Effect.fail(
                new GitLabFailure(
                    'This activity has too many detail records. Open it in GitLab for the complete source.'
                )
            )
        })
    const file = (d: Diff): Activity['files'][number] => ({
        name: d.new_path,
        previousName: d.renamed_file ? d.old_path : undefined,
        status: d.new_file ? 'added' : d.deleted_file ? 'removed' : d.renamed_file ? 'renamed' : 'modified'
    })
    const patch = (diffs: Diff[], pureRenames = new Set<Diff>()) => {
        if (
            diffs.some(
                (d) =>
                    d.too_large ||
                    d.collapsed ||
                    typeof d.diff !== 'string' ||
                    (!d.diff && !pureRenames.has(d)) ||
                    /(?:Binary files .* differ|GIT binary patch)/.test(d.diff)
            )
        )
            throw new GitLabFailure('GitLab could not provide the complete diff. Open this merge request in GitLab.')
        const value = diffs
            .map(
                (d) =>
                    `diff --git a/${d.old_path} b/${d.new_path}\n${d.renamed_file ? `rename from ${d.old_path}\nrename to ${d.new_path}\n` : ''}${d.new_file && d.b_mode ? `new file mode ${d.b_mode}\n` : d.deleted_file && d.a_mode ? `deleted file mode ${d.a_mode}\n` : d.a_mode && d.b_mode && d.a_mode !== d.b_mode ? `old mode ${d.a_mode}\nnew mode ${d.b_mode}\n` : ''}--- ${d.new_file ? '/dev/null' : `a/${d.old_path}`}\n+++ ${d.deleted_file ? '/dev/null' : `b/${d.new_path}`}\n${d.diff}`
            )
            .join('\n')
        if (value.length > 2_000_000) throw new GitLabFailure('Diff is too large. Open in GitLab.')
        return value
    }
    const completePatch = (repository: Repository, diffs: Diff[], base: string, head: string, background = false) =>
        Effect.gen(function* () {
            const pureRenames = new Set<Diff>()
            for (const diff of diffs.filter((d) => d.renamed_file && d.diff === '')) {
                const root = project(repository)
                const oldFile = yield* request<{ blob_id?: string }>(
                    `${root}/repository/files/${encodeURIComponent(diff.old_path)}?ref=${encodeURIComponent(base)}`,
                    background
                )
                const newFile = yield* request<{ blob_id?: string }>(
                    `${root}/repository/files/${encodeURIComponent(diff.new_path)}?ref=${encodeURIComponent(head)}`,
                    background
                )
                if (oldFile.blob_id && oldFile.blob_id === newFile.blob_id) pureRenames.add(diff)
            }
            return yield* Effect.try({
                try: () => patch(diffs, pureRenames),
                catch: (e) => (e instanceof Error ? e : new GitLabFailure(String(e)))
            })
        })
    const assertComplete = (mr: MergeRequest, diffs: Diff[]) => {
        if (!mr.changes_count || !/^\d+$/.test(mr.changes_count) || Number(mr.changes_count) !== diffs.length)
            throw new GitLabFailure('GitLab could not provide the complete diff. Open this merge request in GitLab.')
    }
    const activities = (
        repository: Repository,
        _login: string,
        _tracked: string[],
        scan: ActivityScan = {}
    ): Effect.Effect<Activity[], Error> =>
        Effect.gen(function* () {
            const root = project(repository)
            if (!root) return []
            const result: Activity[] = []
            // Reconcile all states, including old MRs whose notes do not advance updated_at.
            const page = scan.page ?? 1
            const mrs = yield* request<MergeRequest[]>(
                `${root}/merge_requests?state=all&scope=all&order_by=created_at&sort=asc&per_page=20&page=${page}`,
                scan.background
            )
            const recent = yield* request<MergeRequest[]>(
                `${root}/merge_requests?state=all&scope=all&order_by=updated_at&sort=desc&per_page=5&page=1`,
                scan.background
            )
            let position = scan.offset ?? 0
            const sweep = mrs.slice(position, position + 5)
            const work = [
                ...recent.filter((m) => !sweep.some((s) => s.iid === m.iid)).map((mr) => ({ mr, sweep: false })),
                ...sweep.map((mr) => ({ mr, sweep: true }))
            ]
            for (const item of work) {
                let mr = item.mr
                const base = `${root}/merge_requests/${mr.iid}`
                const commits = yield* list<Commit>(`${base}/commits`, scan.background)
                const notes = yield* list<Note>(`${base}/notes`, scan.background)
                const own = commits.filter((c) =>
                    repository.emails.some((e) => e.toLowerCase() === c.author_email.toLowerCase())
                )
                const reviews = notes.filter(
                    (n) => !n.system && String(n.author.id) === userId && String(mr.author.id) !== userId
                )
                if (String(mr.author.id) !== userId && !own.length && !reviews.length) {
                    if (item.sweep) {
                        position++
                        yield* scan.checkpoint?.(page, false, position) ?? Effect.void
                    }
                    continue
                }
                mr = yield* request<MergeRequest>(base, scan.background)
                if (!mr.diff_refs?.base_sha || !mr.diff_refs.head_sha)
                    return yield* Effect.fail(
                        new GitLabFailure('Merge request revision is not available yet. Refresh again shortly.')
                    )
                const id = `${repository.id}:gitlab:${providerRemote(repository.remote)!.path}:mr:${mr.iid}`
                const common = {
                    repositoryId: repository.id,
                    revisionSource: {
                        base: mr.diff_refs.base_sha,
                        head: mr.diff_refs.head_sha,
                        integrationSha: mr.merge_commit_sha ?? null,
                        mergedAt: mr.merged_at ?? null
                    },
                    remoteSource: {
                        provider: 'gitlab' as const,
                        host: 'gitlab.com',
                        path: providerRemote(repository.remote)!.path,
                        number: mr.iid,
                        eventId: String(mr.iid),
                        configuration: remoteConfiguration(repository),
                        accountId: repository.accountId,
                        sessionGeneration: repository.accountGeneration
                    },
                    title: `!${mr.iid} ${mr.title}`,
                    description: mr.description ?? '',
                    author: mr.author.username,
                    branches: [mr.source_branch],
                    changeRequestId: id,
                    url: mr.web_url,
                    files: [],
                    base: mr.target_branch,
                    head: mr.sha,
                    sourceVersion: JSON.stringify({
                        updatedAt: mr.updated_at,
                        base: mr.diff_refs?.base_sha,
                        head: mr.sha,
                        integration: mr.merge_commit_sha
                    }),
                    disposition: 'inbox' as const,
                    explicit: false,
                    deletedBranches: []
                }
                const batch: Activity[] = [
                    {
                        ...common,
                        id,
                        kind: 'change-request',
                        date:
                            commits
                                .map((c) => c.authored_date)
                                .sort()
                                .at(-1) ?? mr.created_at,
                        changeRequest: {
                            status:
                                mr.state === 'merged'
                                    ? 'merged'
                                    : mr.state === 'closed'
                                      ? 'closed'
                                      : mr.draft
                                        ? 'draft'
                                        : 'open',
                            openedAt: mr.created_at,
                            mergedAt: mr.merged_at ?? undefined,
                            closedAt: mr.closed_at ?? undefined,
                            commitDates: commits.map((c) => c.authored_date)
                        }
                    },
                    {
                        ...common,
                        id: `${id}:opened`,
                        kind: 'opened',
                        date: mr.created_at,
                        title: `Opened ${common.title}`
                    }
                ]
                if (mr.merged_at)
                    batch.push({
                        ...common,
                        id: `${id}:merged`,
                        kind: 'merged',
                        date: mr.merged_at,
                        title: `Merged ${common.title}`
                    })
                for (const commit of own)
                    batch.push({
                        ...common,
                        id: `${repository.id}:commit:${commit.id}`,
                        kind: 'commit',
                        sha: commit.id,
                        title: commit.title,
                        description: commit.message,
                        author: commit.author_email,
                        date: commit.authored_date,
                        url: commit.web_url
                    })
                for (const note of reviews)
                    batch.push({
                        ...common,
                        id: `${id}:note:${note.id}`,
                        kind: 'review',
                        title: `Review comment: ${common.title}`,
                        author: note.author.username,
                        description: note.body,
                        date: note.created_at,
                        url: `${mr.web_url}#note_${note.id}`
                    })
                if (scan.batch) yield* scan.batch(batch)
                else result.push(...batch)
                if (item.sweep) {
                    position++
                    yield* scan.checkpoint?.(page, false, position) ?? Effect.void
                }
            }
            yield* (
                scan.checkpoint?.(
                    position < mrs.length ? page : mrs.length < 20 ? 1 : page + 1,
                    position >= mrs.length && mrs.length < 20,
                    position < mrs.length ? position : 0
                ) ?? Effect.void
            )
            return result
        })
    const number = (activity: Activity) =>
        activity.remoteSource?.number ?? Number(/:mr:(\d+)/.exec(activity.changeRequestId ?? '')?.[1])
    const files = (repository: Repository, activity: Activity) =>
        Effect.gen(function* () {
            const { diffs } = yield* loadMergeRequest(repository, activity)
            return diffs.map(file)
        })
    const commitDetails = (repository: Repository, sha: string, includeDiff = true) =>
        Effect.gen(function* () {
            if (!/^[a-f0-9]{40,64}$/.test(sha))
                return yield* Effect.fail(new GitLabFailure('Commit source is unavailable.'))
            const root = project(repository)
            const commit = yield* request<{ parent_ids: string[] }>(`${root}/repository/commits/${sha}`)
            const parent = commit.parent_ids?.[0]
            if (!parent || !/^[a-f0-9]{40,64}$/.test(parent))
                return yield* Effect.fail(
                    new GitLabFailure(
                        'Complete commit changes are unavailable. Locate the local repository or open GitLab.'
                    )
                )
            // Unlike /commits/:sha/diff, compare reports overflow explicitly.
            const comparison = yield* request<{
                compare_timeout?: boolean
                compare_same_ref?: boolean
                commit?: { id: string }
                diffs: Diff[]
            }>(`${root}/repository/compare?from=${parent}&to=${sha}&straight=true`)
            if (
                comparison.compare_timeout !== false ||
                comparison.compare_same_ref ||
                comparison.commit?.id !== sha ||
                !Array.isArray(comparison.diffs)
            )
                return yield* Effect.fail(
                    new GitLabFailure('GitLab could not provide the complete commit diff. Open it in GitLab.')
                )
            const diffs = comparison.diffs
            const diff = includeDiff ? yield* completePatch(repository, diffs, parent, sha) : ''
            return { files: diffs.map(file), diff }
        })
    const loadMergeRequest = (repository: Repository, activity: Activity, background = false) =>
        Effect.gen(function* () {
            const path = `${project(repository)}/merge_requests/${number(activity)}`
            const before = yield* request<MergeRequest>(path, background)
            if (
                !before.diff_refs?.base_sha ||
                !before.diff_refs.head_sha ||
                (activity.head && activity.head !== before.diff_refs.head_sha) ||
                (activity.revisionSource &&
                    (activity.revisionSource.base !== before.diff_refs.base_sha ||
                        activity.revisionSource.head !== before.diff_refs.head_sha ||
                        activity.revisionSource.mergedAt !== (before.merged_at ?? null) ||
                        activity.revisionSource.integrationSha !== (before.merge_commit_sha ?? null)))
            )
                return yield* Effect.fail(
                    new GitLabFailure('Merge request changed. Refresh this repository and try again.')
                )
            const diffs = yield* list<Diff>(`${path}/diffs`, background)
            yield* Effect.try({
                try: () => assertComplete(before, diffs),
                catch: (e) => (e instanceof Error ? e : new GitLabFailure(String(e)))
            })
            const after = yield* request<MergeRequest>(path, background)
            if (
                JSON.stringify(before.diff_refs) !== JSON.stringify(after.diff_refs) ||
                before.merge_commit_sha !== after.merge_commit_sha ||
                before.state !== after.state ||
                before.changes_count !== after.changes_count
            )
                return yield* Effect.fail(
                    new GitLabFailure('Merge request changed while loading. Refresh and try again.')
                )
            return { before, diffs }
        })
    const snapshot = (repository: Repository, activity: Activity, background = false) =>
        Effect.gen(function* () {
            const { before, diffs } = yield* loadMergeRequest(repository, activity, background)
            const diff = yield* completePatch(
                repository,
                diffs,
                before.diff_refs!.base_sha,
                before.diff_refs!.head_sha,
                background
            )
            return {
                diff,
                fingerprint: fingerprint(diff),
                base: before.diff_refs!.base_sha,
                head: before.diff_refs!.head_sha
            }
        })
    return { activities, files, commitDetails, snapshot }
}
