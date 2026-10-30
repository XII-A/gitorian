import { contributionPages, ContributionIncomplete } from './contribution-pages'
import { DurabilityError } from './durability-error'
import type { Activity, Repository } from '../shared/model'
import { localDate } from '../shared/model'
import { HttpError, TransportError } from './http'
import { Effect } from 'effect'
import { fingerprint, githubRemote } from './git'
import { remoteConfiguration } from '../shared/provider-accounts'
import type { ActivityScan } from './contribution-reader'
interface User {
    login: string
}
interface Pull {
    number: number
    title: string
    body: string | null
    html_url: string
    created_at: string
    updated_at: string
    state?: 'open' | 'closed'
    draft?: boolean
    closed_at?: string | null
    merged_at: string | null
    merge_commit_sha: string | null
    user: User
    base: {
        ref: string
        sha: string
    }
    head: {
        ref: string
        sha: string
    }
}
interface Commit {
    sha: string
    commit: {
        author: {
            email: string
            date: string
        }
        message: string
    }
}
interface Review {
    id: number
    body: string
    submitted_at: string | null
    user: User
    state: string
    html_url: string
}
interface File {
    filename: string
    status: string
    previous_filename?: string
    additions?: number
    deletions?: number
}
function activityFile(file: File): Activity['files'][number] {
    return {
        name: file.filename,
        status: file.status,
        ...(file.previous_filename ? { previousName: file.previous_filename } : {}),
        ...(file.additions !== undefined && file.deletions !== undefined
            ? { lineStats: { additions: file.additions, deletions: file.deletions } }
            : {})
    }
}
export class GitHubFailure extends Error {
    readonly _tag = 'GitHubFailure'
}
export type GitHubError = GitHubFailure | HttpError | TransportError | DurabilityError
function toGitHubError(error: unknown): GitHubError {
    if (
        error instanceof GitHubFailure ||
        error instanceof HttpError ||
        error instanceof TransportError ||
        error instanceof DurabilityError
    )
        return error
    return new GitHubFailure(error instanceof Error ? error.message : String(error), { cause: error })
}
export type GitHub = ReturnType<typeof makeGitHub>
export type GitHubRequest = <A>(
    url: string,
    init?: RequestInit,
    format?: 'json' | 'text',
    background?: boolean
) => Effect.Effect<A, Error>
/** GitHub contribution reads. Account authorization and credential lifetime have one owner. */
export function makeGitHub(providerRequest: GitHubRequest) {
    const list = <T>(path: string, background = false): Effect.Effect<T[], Error> =>
        Effect.gen(function* () {
            const result: T[] = []
            for (let page = 1; page <= 30; page++) {
                const items = yield* request<T[]>(
                    `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
                    background
                )
                result.push(...items)
                if (items.length < 100) return result
            }
            return yield* Effect.fail(
                new GitHubFailure(
                    'This activity has more than 3,000 detail records. Open it in GitHub for the complete source.'
                )
            )
        })
    const activities = (
        repository: Repository,
        login: string,
        trackedPrIds: string[],
        scan: ActivityScan = {}
    ): Effect.Effect<Activity[], Error> =>
        Effect.gen(function* () {
            const remote = githubRemote(repository.remote)
            if (!remote) return []
            const activities: Activity[] = []
            const pages = contributionPages(scan)
            const read = <A>(path: string, staged = false) =>
                pages.read(path, () => request<A>(path, scan.background), staged)
            const details = <A>(path: string) =>
                Effect.gen(function* () {
                    const result: A[] = []
                    for (let p = 1; p <= 30; p++) {
                        const items = yield* read<A[]>(`${path}?per_page=100&page=${p}`, true)
                        result.push(...items)
                        if (items.length < 100) return result
                    }
                    return yield* Effect.fail(
                        new ContributionIncomplete(
                            'Contribution detail records exceed the provider completeness limit.'
                        )
                    )
                })
            const since = scan.since ?? repository.trackingStart
            const firstPage = Math.max(1, (scan.page ?? 1) - 1)
            let complete = false
            let hydrated = 0
            for (let page = firstPage; page < firstPage + 2; page++) {
                const pulls = yield* read<Pull[]>(
                    `repos/${remote}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`
                )
                if (scan.pending)
                    pulls.sort(
                        (a, b) =>
                            Number(scan.pending!.key.startsWith(`${b.number}:`)) -
                            Number(scan.pending!.key.startsWith(`${a.number}:`))
                    )
                for (const summary of pulls) {
                    if (localDate(new Date(summary.updated_at ?? summary.created_at), scan.timezone ?? 'UTC') < since) {
                        complete = true
                        break
                    }
                    const version = JSON.stringify([
                        summary.updated_at,
                        summary.base.sha,
                        summary.head.sha,
                        summary.merged_at,
                        summary.merge_commit_sha,
                        login,
                        repository.emails,
                        summary.state,
                        summary.draft,
                        summary.closed_at
                    ])
                    if (scan.versions?.[String(summary.number)] === version) continue
                    if (hydrated >= 20) {
                        yield* scan.checkpoint?.(page, false) ?? Effect.void
                        return activities
                    }
                    hydrated++
                    if (!(yield* pages.select(`${summary.number}:${version}`))) continue
                    const path = `repos/${remote}/pulls/${summary.number}`
                    const pr = summary
                    const detail = yield* pages.guard(
                        Effect.gen(function* () {
                            const commits = yield* details<Commit>(`${path}/commits`)
                            if (commits.length >= 250) {
                                const total = yield* read<Pull & { commits?: number }>(path, true)
                                if (commits.length > 250 || total.commits !== commits.length)
                                    return yield* Effect.fail(
                                        new ContributionIncomplete(
                                            'GitHub limits this pull-request commit endpoint to 250 commits. Complete contribution evidence is unavailable; open the source in GitHub.'
                                        )
                                    )
                            }
                            const reviews = yield* details<Review>(`${path}/reviews`)
                            return { commits, reviews }
                        })
                    )
                    if (!detail) continue
                    const { commits, reviews } = detail
                    const id = `${repository.id}:pr:${pr.number}`
                    const mine = commits.filter((commit) =>
                        repository.emails.some(
                            (email) => email.toLowerCase() === commit.commit.author.email.toLowerCase()
                        )
                    )
                    const myReviews = reviews.filter(
                        (review) => review.user.login === login && review.submitted_at && review.state !== 'PENDING'
                    )
                    if (pr.user.login !== login && !mine.length && !myReviews.length && !trackedPrIds.includes(id)) {
                        if (scan.versions) scan.versions[String(summary.number)] = version
                        yield* scan.checkpoint?.(page, false) ?? Effect.void
                        yield* pages.complete
                        continue
                    }
                    const batch: Activity[] = []
                    const latest =
                        commits
                            .map((commit) => commit.commit.author.date)
                            .sort()
                            .at(-1) ?? pr.created_at
                    const common = {
                        repositoryId: repository.id,
                        remoteSource: {
                            provider: 'github' as const,
                            host: 'github.com',
                            path: remote,
                            number: pr.number,
                            eventId: String(pr.number),
                            configuration: remoteConfiguration(repository),
                            accountId: repository.accountId,
                            sessionGeneration: repository.accountGeneration
                        },
                        title: `#${pr.number} ${pr.title}`,
                        author: pr.user.login,
                        branches: [pr.head.ref],
                        changeRequestId: id,
                        url: pr.html_url,
                        description: pr.body ?? '',
                        files: [],
                        base: pr.base.ref,
                        head: pr.head.sha,
                        sourceVersion: version,
                        revisionSource: {
                            base: pr.base.sha,
                            head: pr.head.sha,
                            mergedAt: pr.merged_at,
                            integrationSha: pr.merge_commit_sha
                        },
                        disposition: 'inbox' as const,
                        explicit: false,
                        deletedBranches: []
                    }
                    batch.push({
                        ...common,
                        id,
                        kind: 'change-request',
                        date: latest,
                        changeRequest: {
                            status: pr.merged_at
                                ? 'merged'
                                : pr.state === 'closed'
                                  ? 'closed'
                                  : pr.draft
                                    ? 'draft'
                                    : pr.state === 'open'
                                      ? 'open'
                                      : undefined,
                            openedAt: pr.created_at,
                            commitDates: [...new Set(commits.map((commit) => commit.commit.author.date))]
                                .filter((date) => date >= pr.created_at)
                                .sort(),
                            closedAt: pr.closed_at ?? undefined,
                            mergedAt: pr.merged_at ?? undefined
                        }
                    })
                    batch.push({
                        ...common,
                        id: `${id}:opened`,
                        kind: 'opened',
                        date: pr.created_at,
                        title: `Opened ${common.title}`
                    })
                    if (pr.merged_at)
                        batch.push({
                            ...common,
                            id: `${id}:merged`,
                            kind: 'merged',
                            date: pr.merged_at,
                            title: `Merged ${common.title}`,
                            integrationSha: pr.merge_commit_sha ?? undefined
                        })
                    for (const commit of mine)
                        batch.push({
                            ...common,
                            id: `${repository.id}:commit:${commit.sha}`,
                            kind: 'commit',
                            sha: commit.sha,
                            author: commit.commit.author.email,
                            date: commit.commit.author.date,
                            title: commit.commit.message.split('\n')[0],
                            description: commit.commit.message
                        })
                    for (const review of myReviews)
                        batch.push({
                            ...common,
                            id: `${id}:review:${review.id}`,
                            kind: 'review',
                            author: login,
                            date: review.submitted_at!,
                            title: `${review.state}: ${common.title}`,
                            description: review.body,
                            url: review.html_url
                        })
                    const eligible = batch.filter(
                        (item) =>
                            item.kind === 'change-request' ||
                            localDate(new Date(item.date), scan.timezone ?? 'UTC') >= repository.trackingStart
                    )
                    // Keep all events from hydrated PRs in the local cache. Otherwise an
                    // unchanged version would hide older reviews/commits when history expands.
                    if (scan.batch) yield* scan.batch(batch)
                    else activities.push(...eligible)
                    if (scan.versions) scan.versions[String(summary.number)] = version
                    yield* scan.checkpoint?.(page, false) ?? Effect.void
                    yield* pages.complete
                }
                if (pulls.length < 100) complete = true
                yield* scan.checkpoint?.(complete ? 1 : page + 1, complete) ?? Effect.void
                if (complete) break
            }
            return activities
        })
    const files = (repository: Repository, activity: Activity): Effect.Effect<Activity['files'], Error> =>
        Effect.gen(function* () {
            const remote = githubRemote(repository.remote)
            const number = activity.remoteSource?.number ?? activity.changeRequestId?.split(':').at(-1)
            if (!remote || !number) return []
            return (yield* list<File>(`repos/${remote}/pulls/${number}/files`)).map(activityFile)
        })
    const commitDetails = (
        repository: Repository,
        sha: string,
        includeDiff = true
    ): Effect.Effect<
        {
            diff: string
            files: Activity['files']
        },
        Error
    > =>
        Effect.gen(function* () {
            const remote = githubRemote(repository.remote)
            if (!remote || !/^[a-f0-9]{40,64}$/.test(sha))
                return yield* Effect.fail(new GitHubFailure('GitHub commit source is unavailable'))
            const path = `repos/${remote}/commits/${sha}`
            const files: File[] = []
            for (let page = 1; page <= 30; page++) {
                const metadata = yield* request<{
                    files: File[]
                }>(`${path}?per_page=100&page=${page}`)
                files.push(...metadata.files)
                if (metadata.files.length < 100) break
                if (page === 30)
                    return yield* Effect.fail(
                        new GitHubFailure(
                            'This commit has too many changed files. Open it in GitHub for the complete source.'
                        )
                    )
            }
            const diff = includeDiff
                ? yield* fetchDiff(`https://api.github.com/${path}`, {
                      headers: { Accept: 'application/vnd.github.diff' }
                  })
                : ''
            return {
                diff: diff.length <= 2000000 ? diff : 'Diff is too large. Open in GitHub.',
                files: files.map(activityFile)
            }
        })
    const snapshot = (
        repository: Repository,
        activity: Activity,
        background = false
    ): Effect.Effect<
        {
            diff: string
            fingerprint?: string
            base: string
            head: string
        },
        Error
    > =>
        Effect.gen(function* () {
            const remote = githubRemote(repository.remote)
            const number = activity.remoteSource?.number ?? activity.changeRequestId?.split(':').at(-1)
            if (!remote || !number) return yield* Effect.fail(new GitHubFailure('GitHub remote is unavailable'))
            const path = `repos/${remote}/pulls/${number}`
            const before = yield* request<Pull>(path, background)
            if (activity.revisionSource) {
                const { base, head, mergedAt: merged, integrationSha: integration } = activity.revisionSource
                if (
                    before.base.sha !== base ||
                    before.head.sha !== head ||
                    before.merged_at !== merged ||
                    before.merge_commit_sha !== integration
                )
                    return yield* Effect.fail(
                        new GitHubFailure('PR changed since activity refresh. Refresh this repository and try again.')
                    )
            }
            const integration =
                before.merged_at && before.merge_commit_sha
                    ? yield* request<{
                          parents: {
                              sha: string
                          }[]
                      }>(`repos/${remote}/commits/${before.merge_commit_sha}`, background)
                    : undefined
            // A linear integration tip may be only the last of several rebased commits.
            // Only a true merge proves that its first-parent diff includes the full integration.
            const provenIntegration = integration && integration.parents.length > 1
            const diffPath = provenIntegration ? `repos/${remote}/commits/${before.merge_commit_sha}` : path
            const diff = yield* fetchDiff(
                `https://api.github.com/${diffPath}`,
                { headers: { Accept: 'application/vnd.github.diff' } },
                background
            )
            const after = yield* request<Pull>(path, background)
            if (
                before.base.sha !== after.base.sha ||
                before.head.sha !== after.head.sha ||
                before.merge_commit_sha !== after.merge_commit_sha ||
                before.merged_at !== after.merged_at
            )
                return yield* Effect.fail(
                    new GitHubFailure('PR changed while capturing its revision; refresh and try again')
                )
            const comparable =
                (!integration || provenIntegration) &&
                !/Binary files .* differ/.test(diff) &&
                !diff.includes('GIT binary patch')
            return {
                diff: diff.length <= 2000000 ? diff : 'Diff is too large. Open in GitHub.',
                fingerprint: comparable ? fingerprint(diff) : undefined,
                base: provenIntegration ? integration.parents[0].sha : before.base.sha,
                head: integration ? before.merge_commit_sha! : before.head.sha
            }
        })
    const request = <T>(path: string, background = false): Effect.Effect<T, Error> =>
        providerRequest<T>('https://api.github.com/' + path, {}, 'json', background)
    const fetchDiff = (url: string, init: RequestInit, background = false): Effect.Effect<string, Error> =>
        providerRequest<string>(url, init, 'text', background).pipe(
            Effect.catchAll((error) => {
                if (error instanceof HttpError && error.status === 413)
                    return Effect.succeed('Diff is too large. Open in GitHub.')
                if (error instanceof HttpError && error.status === 406)
                    return Effect.succeed(
                        "GitHub could not provide this diff (HTTP 406). It may exceed GitHub's rendering limits. Open in GitHub or inspect the changes locally."
                    )
                return Effect.fail(error)
            })
        )
    return {
        activities: Effect.fn('GitHub.activities')(activities, Effect.mapError(toGitHubError)),
        files: Effect.fn('GitHub.files')(files, Effect.mapError(toGitHubError)),
        commitDetails: Effect.fn('GitHub.commitDetails')(commitDetails, Effect.mapError(toGitHubError)),
        snapshot: Effect.fn('GitHub.snapshot')(snapshot, Effect.mapError(toGitHubError))
    }
}
