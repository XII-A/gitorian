import { DurabilityError } from './durability-error'
import type { Activity, Repository } from '../shared/model'
import { localDate } from '../shared/model'
import { Http, HttpError, TransportError } from './http'
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Schema } from 'effect'
import { fingerprint, githubRemote } from './git'
// Public identifier for Gitorian's OAuth registration. Device flow needs no client secret.
const githubClientId = 'Ov23li9PFMAWRrbZQ6Xy'
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
export interface ActivityScan {
    timezone?: string
    since?: string
    page?: number
    versions?: Record<string, string>
    background?: boolean
    checkpoint?: (page: number, complete: boolean) => Effect.Effect<void, Error>
    batch?: (activities: Activity[]) => Effect.Effect<void, Error>
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
interface Device {
    device_code: string
    user_code: string
    verification_uri: string
    interval: number
    expires_in: number
}
interface Credential {
    access_token: string
    refresh_token?: string
    expires?: number
}
interface TokenResponse {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
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
export type GitHub = Effect.Effect.Success<ReturnType<typeof makeGitHub>>
export const GitHub = Context.GenericTag<GitHub>('gitorian/GitHub')
export const GitHubLive = (
    credential: () => string,
    setToken: (token: string) => void,
    fetcher: typeof fetch = fetch
) => Layer.scoped(GitHub, makeGitHub(credential, setToken, fetcher))
function makeGitHub(credential: () => string, setToken: (token: string) => void, fetcher: typeof fetch) {
    return Effect.gen(function* () {
        const http = yield* Http
        const registration = yield* Effect.makeSemaphore(1)
        const operations = yield* Scope.make()
        const rotationScope = yield* Scope.make()
        const rotations = new Set<Fiber.RuntimeFiber<string, Error>>()
        let closed = false
        yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
                const accepted = yield* registration.withPermits(1)(
                    Effect.sync(() => {
                        closed = true
                        return [...rotations]
                    })
                )
                yield* Scope.close(operations, Exit.void)
                yield* Effect.forEach(accepted, Fiber.await, { discard: true })
                yield* Scope.close(rotationScope, Exit.void)
            })
        )
        const own = <A, E, R>(operation: Effect.Effect<A, E, R>): Effect.Effect<A, E | GitHubFailure, R> =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    const fiber = yield* registration.withPermits(1)(
                        Effect.suspend(() =>
                            closed
                                ? Effect.fail(new GitHubFailure('GitHub is closed.'))
                                : Effect.forkIn(Effect.interruptible(operation), operations)
                        )
                    )
                    return yield* restore(Fiber.join(fiber)).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
                })
            )
        let authorization:
            | (Device & {
                  expires: number
                  nextPoll: number
              })
            | undefined
        let renewal:
            | {
                  stored: string
                  id: symbol
                  fiber: Fiber.RuntimeFiber<string, Error>
              }
            | undefined
        const fetchResponse = (url: string, init: RequestInit) =>
            Effect.tryPromise({
                try: (signal) =>
                    fetcher(url, { ...init, signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) }),
                catch: (error) => new TransportError(error)
            })
        const readJson = (response: Response) =>
            Effect.tryPromise({
                try: () => response.json() as Promise<unknown>,
                catch: (error) => new TransportError(error)
            })
        const credentialSchema = Schema.Struct({
            access_token: Schema.NonEmptyString,
            refresh_token: Schema.optional(Schema.NonEmptyString),
            expires: Schema.optional(Schema.Number)
        })
        const credentials = Effect.try({
            try: (): { stored: string; current: Credential } => {
                const stored = credential()
                if (!stored.startsWith('{')) return { stored, current: { access_token: stored } }
                try {
                    return { stored, current: Schema.decodeUnknownSync(credentialSchema)(JSON.parse(stored)) }
                } catch (cause) {
                    throw new GitHubFailure('Saved GitHub credentials could not be read. Reconnect in Settings.', {
                        cause
                    })
                }
            },
            catch: toGitHubError
        })
        const accessToken = () => credentials.pipe(Effect.map((value) => value.current.access_token))
        const save = (result: TokenResponse): string => {
            const session: Credential = {
                access_token: result.access_token!,
                refresh_token: result.refresh_token,
                expires: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined
            }
            setToken(result.refresh_token ? JSON.stringify(session) : session.access_token)
            return session.access_token
        }
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
        const start = (): Effect.Effect<
            {
                code: string
                url: string
                interval: number
            },
            Error
        > =>
            Effect.gen(function* () {
                const response = yield* fetchResponse('https://github.com/login/device/code', {
                    method: 'POST',
                    signal: AbortSignal.timeout(30000),
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id: githubClientId, scope: 'repo read:user user:email' })
                })
                if (!response.ok)
                    return yield* Effect.fail(new GitHubFailure(`GitHub sign-in failed (${response.status})`))
                const device = (yield* readJson(response)) as Device & {
                    error?: string
                }
                if (device.error || !device.device_code)
                    return yield* Effect.fail(
                        new GitHubFailure(
                            device.error === 'device_flow_disabled' || device.error === 'incorrect_client_credentials'
                                ? 'GitHub sign-in is unavailable in this version of Gitorian. Check for an app update or contact the maintainer.'
                                : (device.error ?? 'Invalid device authorization response')
                        )
                    )
                authorization = {
                    ...device,
                    expires: Date.now() + device.expires_in * 1000,
                    nextPoll: Date.now() + device.interval * 1000
                }
                return { code: device.user_code, url: device.verification_uri, interval: device.interval }
            })
        const poll = (): Effect.Effect<
            | {
                  login: string
                  emails: string[]
              }
            | {
                  pending: true
                  interval: number
              },
            Error
        > =>
            Effect.gen(function* () {
                const device = authorization
                if (!device || Date.now() > device.expires)
                    return yield* Effect.fail(new GitHubFailure('Device sign-in expired; start again'))
                if (Date.now() < device.nextPoll)
                    return { pending: true, interval: Math.ceil((device.nextPoll - Date.now()) / 1000) }
                device.nextPoll = Date.now() + device.interval * 1000
                const response = yield* fetchResponse('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    signal: AbortSignal.timeout(30000),
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client_id: githubClientId,
                        device_code: device.device_code,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                })
                if (!response.ok)
                    return yield* Effect.fail(
                        new GitHubFailure(`GitHub sign-in failed (${response.status}); try again`)
                    )
                const result = (yield* readJson(response)) as TokenResponse
                if (result.error === 'slow_down') {
                    device.interval += 5
                    device.nextPoll = Date.now() + device.interval * 1000
                }
                if (result.error === 'authorization_pending' || result.error === 'slow_down')
                    return { pending: true, interval: device.interval }
                if (!result.access_token)
                    return yield* Effect.fail(
                        new GitHubFailure(
                            result.error === 'access_denied'
                                ? 'GitHub authorization was declined; start sign-in again'
                                : result.error === 'expired_token'
                                  ? 'GitHub sign-in expired; start again'
                                  : (result.error ?? 'GitHub sign-in failed')
                        )
                    )
                const user = yield* http.request<User>('https://api.github.com/user', result.access_token)
                const emails = yield* http.request<
                    {
                        email: string
                    }[]
                >('https://api.github.com/user/emails', result.access_token)
                yield* Effect.try({
                    try: () => {
                        if (closed) throw new GitHubFailure('GitHub is closed.')
                        save(result)
                    },
                    catch: toGitHubError
                })
                authorization = undefined
                return { login: user.login, emails: emails.map((item) => item.email) }
            })
        const activities = (
            repository: Repository,
            login: string,
            trackedPrIds: string[],
            scan: ActivityScan = {}
        ): Effect.Effect<Activity[], Error> =>
            Effect.gen(function* () {
                const remote = githubRemote(repository.remote)
                if (!remote || !(yield* accessToken())) return []
                const activities: Activity[] = []
                const since = scan.since ?? repository.trackingStart
                const firstPage = Math.max(1, (scan.page ?? 1) - 1)
                let complete = false
                let hydrated = 0
                for (let page = firstPage; page < firstPage + 2; page++) {
                    const pulls = yield* request<Pull[]>(
                        `repos/${remote}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
                        scan.background
                    )
                    for (const summary of pulls) {
                        if (
                            localDate(new Date(summary.updated_at ?? summary.created_at), scan.timezone ?? 'UTC') <
                            since
                        ) {
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
                        const path = `repos/${remote}/pulls/${summary.number}`
                        const pr = summary
                        const commits = yield* list<Commit>(`${path}/commits`, scan.background)
                        const reviews = yield* list<Review>(`${path}/reviews`, scan.background)
                        const id = `${repository.id}:pr:${pr.number}`
                        const mine = commits.filter((commit) =>
                            repository.emails.some(
                                (email) => email.toLowerCase() === commit.commit.author.email.toLowerCase()
                            )
                        )
                        const myReviews = reviews.filter(
                            (review) => review.user.login === login && review.submitted_at && review.state !== 'PENDING'
                        )
                        if (
                            pr.user.login !== login &&
                            !mine.length &&
                            !myReviews.length &&
                            !trackedPrIds.includes(id)
                        ) {
                            if (scan.versions) scan.versions[String(summary.number)] = version
                            yield* scan.checkpoint?.(page, false) ?? Effect.void
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
                            title: `#${pr.number} ${pr.title}`,
                            author: pr.user.login,
                            branches: [pr.head.ref],
                            prId: id,
                            url: pr.html_url,
                            description: pr.body ?? '',
                            files: [],
                            base: pr.base.ref,
                            head: pr.head.sha,
                            sourceVersion: version,
                            disposition: 'inbox' as const,
                            explicit: false,
                            deletedBranches: []
                        }
                        batch.push({
                            ...common,
                            id,
                            kind: 'pr',
                            date: latest,
                            pullRequest: {
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
                                item.kind === 'pr' ||
                                localDate(new Date(item.date), scan.timezone ?? 'UTC') >= repository.trackingStart
                        )
                        // Keep all events from hydrated PRs in the local cache. Otherwise an
                        // unchanged version would hide older reviews/commits when history expands.
                        if (scan.batch) yield* scan.batch(batch)
                        else activities.push(...eligible)
                        if (scan.versions) scan.versions[String(summary.number)] = version
                        yield* scan.checkpoint?.(page, false) ?? Effect.void
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
                const number = activity.prId?.split(':').at(-1)
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
                const number = activity.prId?.split(':').at(-1)
                if (!remote || !number) return yield* Effect.fail(new GitHubFailure('GitHub remote is unavailable'))
                const path = `repos/${remote}/pulls/${number}`
                const before = yield* request<Pull>(path, background)
                if (activity.sourceVersion) {
                    const [, base, head, merged, integration] = JSON.parse(activity.sourceVersion) as unknown[]
                    if (
                        before.base.sha !== base ||
                        before.head.sha !== head ||
                        before.merged_at !== merged ||
                        before.merge_commit_sha !== integration
                    )
                        return yield* Effect.fail(
                            new GitHubFailure(
                                'PR changed since activity refresh. Refresh this repository and try again.'
                            )
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
        const renew = (rejected?: string): Effect.Effect<string, Error> =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    const completion = yield* registration.withPermits(1)(
                        Effect.gen(function* () {
                            if (closed) return yield* Effect.fail(new GitHubFailure('GitHub is closed.'))
                            const { stored, current } = yield* credentials
                            if (rejected && rejected !== current.access_token)
                                return Effect.succeed(current.access_token)
                            if (!current.refresh_token) return Effect.succeed(current.access_token)
                            if (!rejected && (!current.expires || current.expires > Date.now() + 60000))
                                return Effect.succeed(current.access_token)
                            if (renewal?.stored === stored) return Fiber.join(renewal.fiber)
                            const id = Symbol()
                            const started = yield* Deferred.make<undefined>()
                            // Once the provider may rotate credentials, persist its result even if every reader leaves.
                            const task = Effect.gen(function* () {
                                const response = yield* fetchResponse('https://github.com/login/oauth/access_token', {
                                    method: 'POST',
                                    signal: AbortSignal.timeout(30000),
                                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        client_id: githubClientId,
                                        grant_type: 'refresh_token',
                                        refresh_token: current.refresh_token
                                    })
                                })
                                if (!response.ok)
                                    return yield* Effect.fail(
                                        new HttpError(
                                            response.status,
                                            'GitHub connection renewal failed (' +
                                                String(response.status) +
                                                '). Try again.'
                                        )
                                    )
                                const result = (yield* readJson(response)) as TokenResponse
                                if (result.error === 'bad_refresh_token')
                                    return yield* Effect.fail(
                                        new HttpError(401, 'GitHub connection expired. Reconnect in Settings.')
                                    )
                                if (result.error || !result.access_token || !result.refresh_token)
                                    return yield* Effect.fail(
                                        new GitHubFailure('GitHub connection renewal failed. Try again.')
                                    )
                                return yield* Effect.try({
                                    try: () => {
                                        if (credential() !== stored)
                                            throw new GitHubFailure(
                                                'GitHub connection changed during renewal. Try again.'
                                            )
                                        return save(result)
                                    },
                                    catch: toGitHubError
                                })
                            })
                            const fiber: Fiber.RuntimeFiber<string, Error> = yield* Effect.forkIn(
                                Effect.uninterruptible(Deferred.await(started).pipe(Effect.zipRight(task))).pipe(
                                    Effect.ensuring(
                                        Effect.sync(() => {
                                            rotations.delete(fiber)
                                            if (renewal?.id === id) renewal = undefined
                                        })
                                    )
                                ),
                                rotationScope
                            )
                            renewal = { stored, id, fiber }
                            rotations.add(fiber)
                            yield* Deferred.succeed(started, undefined)
                            return Fiber.join(fiber)
                        })
                    )
                    return yield* restore(completion)
                })
            )
        const authenticated = <T>(operation: (token: string) => Effect.Effect<T, Error>): Effect.Effect<T, Error> =>
            Effect.gen(function* () {
                const token = yield* renew()
                return yield* operation(token).pipe(
                    Effect.catchAll((error) => {
                        if (!(error instanceof HttpError) || error.status !== 401) return Effect.fail(error)
                        return credentials.pipe(
                            Effect.flatMap(({ current }): Effect.Effect<T, Error> =>
                                current.refresh_token
                                    ? renew(token).pipe(Effect.flatMap(operation))
                                    : Effect.fail(error)
                            )
                        )
                    })
                )
            })
        const request = <T>(path: string, background = false): Effect.Effect<T, Error> =>
            authenticated((token) =>
                http.request<T>('https://api.github.com/' + path, token, {}, 'json', { background })
            )
        const fetchDiff = (url: string, init: RequestInit, background = false): Effect.Effect<string, Error> =>
            authenticated((token) =>
                http.request<string>(url, token, init, 'text', { maxBytes: 2000000, background })
            ).pipe(
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
            start: Effect.fn('GitHub.start')(start, own, Effect.mapError(toGitHubError)),
            poll: Effect.fn('GitHub.poll')(poll, own, Effect.mapError(toGitHubError)),
            activities: Effect.fn('GitHub.activities')(activities, own, Effect.mapError(toGitHubError)),
            files: Effect.fn('GitHub.files')(files, own, Effect.mapError(toGitHubError)),
            commitDetails: Effect.fn('GitHub.commitDetails')(commitDetails, own, Effect.mapError(toGitHubError)),
            snapshot: Effect.fn('GitHub.snapshot')(snapshot, own, Effect.mapError(toGitHubError))
        }
    })
}
