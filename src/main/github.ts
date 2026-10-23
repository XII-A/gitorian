import type { Activity, Repository } from '../shared/model'
import { localDate } from '../shared/model'
import type { Http } from './http'
import { fingerprint, githubRemote } from './git'
import { HttpError } from './http'

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
    base: { ref: string; sha: string }
    head: { ref: string; sha: string }
}
export interface ActivityScan {
    timezone?: string
    since?: string
    page?: number
    versions?: Record<string, string>
    background?: boolean
    checkpoint?: (page: number, complete: boolean) => void
    batch?: (activities: Activity[]) => Promise<void>
}
interface Commit {
    sha: string
    commit: { author: { email: string; date: string }; message: string }
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
export class GitHub {
    private device?: Device & { clientId: string; expires: number; nextPoll: number }
    constructor(
        private readonly http: Http,
        private readonly token: () => string,
        private readonly setToken: (token: string) => void
    ) {}
    private request<T>(path: string, background = false): Promise<T> {
        return this.http.request<T>(`https://api.github.com/${path}`, this.token(), {}, 'json', { background })
    }
    private async list<T>(path: string, background = false): Promise<T[]> {
        const result: T[] = []
        for (let page = 1; page <= 30; page++) {
            const items = await this.request<T[]>(
                `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
                background
            )
            result.push(...items)
            if (items.length < 100) return result
        }
        throw new Error('This activity has more than 3,000 detail records. Open it in GitHub for the complete source.')
    }
    async start(clientId: string): Promise<{ code: string; url: string; interval: number }> {
        if (!clientId) throw new Error('Enter the public client ID of a GitHub OAuth app with device flow enabled')
        const response = await fetch('https://github.com/login/device/code', {
            method: 'POST',
            signal: AbortSignal.timeout(30000),
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, scope: 'repo read:user user:email' })
        })
        if (!response.ok) throw new Error(`GitHub sign-in failed (${response.status})`)
        const device = (await response.json()) as Device & { error?: string }
        if (device.error || !device.device_code)
            throw new Error(
                device.error === 'device_flow_disabled'
                    ? 'Enable device flow in your GitHub OAuth application settings, then try again'
                    : device.error === 'incorrect_client_credentials'
                      ? 'GitHub rejected this OAuth client ID. Copy the client ID from your OAuth application settings'
                      : (device.error ?? 'Invalid device authorization response')
            )
        this.device = {
            ...device,
            clientId,
            expires: Date.now() + device.expires_in * 1000,
            nextPoll: Date.now() + device.interval * 1000
        }
        return { code: device.user_code, url: device.verification_uri, interval: device.interval }
    }
    async poll(): Promise<{ login: string; emails: string[] } | { pending: true; interval: number }> {
        const device = this.device
        if (!device || Date.now() > device.expires) throw new Error('Device sign-in expired; start again')
        if (Date.now() < device.nextPoll)
            return { pending: true, interval: Math.ceil((device.nextPoll - Date.now()) / 1000) }
        device.nextPoll = Date.now() + device.interval * 1000
        const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            signal: AbortSignal.timeout(30000),
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: device.clientId,
                device_code: device.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            })
        })
        if (!response.ok) throw new Error(`GitHub sign-in failed (${response.status}); try again`)
        const result = (await response.json()) as { access_token?: string; error?: string }
        if (result.error === 'slow_down') {
            device.interval += 5
            device.nextPoll = Date.now() + device.interval * 1000
        }
        if (result.error === 'authorization_pending' || result.error === 'slow_down')
            return { pending: true, interval: device.interval }
        if (!result.access_token)
            throw new Error(
                result.error === 'access_denied'
                    ? 'GitHub authorization was declined; start sign-in again'
                    : result.error === 'expired_token'
                      ? 'GitHub sign-in expired; start again'
                      : (result.error ?? 'GitHub sign-in failed')
            )
        const user = await this.http.request<User>('https://api.github.com/user', result.access_token)
        const emails = await this.http.request<{ email: string }[]>(
            'https://api.github.com/user/emails',
            result.access_token
        )
        this.setToken(result.access_token)
        this.device = undefined
        return { login: user.login, emails: emails.map((item) => item.email) }
    }
    async activities(
        repository: Repository,
        login: string,
        trackedPrIds: string[],
        scan: ActivityScan = {}
    ): Promise<Activity[]> {
        const remote = githubRemote(repository.remote)
        if (!remote || !this.token()) return []
        const activities: Activity[] = []
        const since = scan.since ?? repository.trackingStart
        const firstPage = Math.max(1, (scan.page ?? 1) - 1)
        let complete = false
        let hydrated = 0
        for (let page = firstPage; page < firstPage + 2; page++) {
            const pulls = await this.request<Pull[]>(
                `repos/${remote}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
                scan.background
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
                    scan.checkpoint?.(page, false)
                    return activities
                }
                hydrated++
                const path = `repos/${remote}/pulls/${summary.number}`
                const pr = summary
                const commits = await this.list<Commit>(`${path}/commits`, scan.background)
                const reviews = await this.list<Review>(`${path}/reviews`, scan.background)
                const id = `${repository.id}:pr:${pr.number}`
                const mine = commits.filter((commit) =>
                    repository.emails.some((email) => email.toLowerCase() === commit.commit.author.email.toLowerCase())
                )
                const myReviews = reviews.filter(
                    (review) => review.user.login === login && review.submitted_at && review.state !== 'PENDING'
                )
                if (pr.user.login !== login && !mine.length && !myReviews.length && !trackedPrIds.includes(id)) {
                    if (scan.versions) scan.versions[String(summary.number)] = version
                    scan.checkpoint?.(page, false)
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
                if (scan.batch) await scan.batch(batch)
                else activities.push(...eligible)
                if (scan.versions) scan.versions[String(summary.number)] = version
                scan.checkpoint?.(page, false)
            }
            if (pulls.length < 100) complete = true
            scan.checkpoint?.(complete ? 1 : page + 1, complete)
            if (complete) break
        }
        return activities
    }
    async files(repository: Repository, activity: Activity): Promise<Activity['files']> {
        const remote = githubRemote(repository.remote)
        const number = activity.prId?.split(':').at(-1)
        if (!remote || !number) return []
        return (await this.list<File>(`repos/${remote}/pulls/${number}/files`)).map(activityFile)
    }
    async commitDetails(
        repository: Repository,
        sha: string,
        includeDiff = true
    ): Promise<{ diff: string; files: Activity['files'] }> {
        const remote = githubRemote(repository.remote)
        if (!remote || !/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('GitHub commit source is unavailable')
        const path = `repos/${remote}/commits/${sha}`
        const files: File[] = []
        for (let page = 1; page <= 30; page++) {
            const metadata = await this.request<{ files: File[] }>(`${path}?per_page=100&page=${page}`)
            files.push(...metadata.files)
            if (metadata.files.length < 100) break
            if (page === 30)
                throw new Error('This commit has too many changed files. Open it in GitHub for the complete source.')
        }
        const diff = includeDiff
            ? await this.diff(`https://api.github.com/${path}`, this.token(), {
                  headers: { Accept: 'application/vnd.github.diff' }
              })
            : ''
        return {
            diff: diff.length <= 2_000_000 ? diff : 'Diff is too large. Open in GitHub.',
            files: files.map(activityFile)
        }
    }
    private async diff(url: string, token: string, init: RequestInit, background = false): Promise<string> {
        try {
            return await this.http.request<string>(url, token, init, 'text', { maxBytes: 2_000_000, background })
        } catch (error) {
            if (error instanceof HttpError && error.status === 413) return 'Diff is too large. Open in GitHub.'
            // GitHub may reject the diff representation (for example, when its
            // server-side rendering limit is exceeded) while JSON metadata works.
            // Keep acquisition moving, but never fingerprint unavailable evidence.
            if (error instanceof HttpError && error.status === 406)
                return "GitHub could not provide this diff (HTTP 406). It may exceed GitHub's rendering limits. Open in GitHub or inspect the changes locally."
            throw error
        }
    }
    async snapshot(
        repository: Repository,
        activity: Activity,
        background = false
    ): Promise<{ diff: string; fingerprint?: string; base: string; head: string }> {
        const remote = githubRemote(repository.remote)
        const number = activity.prId?.split(':').at(-1)
        if (!remote || !number) throw new Error('GitHub remote is unavailable')
        const path = `repos/${remote}/pulls/${number}`
        const before = await this.request<Pull>(path, background)
        if (activity.sourceVersion) {
            const [, base, head, merged, integration] = JSON.parse(activity.sourceVersion) as unknown[]
            if (
                before.base.sha !== base ||
                before.head.sha !== head ||
                before.merged_at !== merged ||
                before.merge_commit_sha !== integration
            )
                throw new Error('PR changed since activity refresh. Refresh this repository and try again.')
        }
        const integration =
            before.merged_at && before.merge_commit_sha
                ? await this.request<{ parents: { sha: string }[] }>(
                      `repos/${remote}/commits/${before.merge_commit_sha}`,
                      background
                  )
                : undefined
        // A linear integration tip may be only the last of several rebased commits.
        // Only a true merge proves that its first-parent diff includes the full integration.
        const provenIntegration = integration && integration.parents.length > 1
        const diffPath = provenIntegration ? `repos/${remote}/commits/${before.merge_commit_sha}` : path
        const diff = await this.diff(
            `https://api.github.com/${diffPath}`,
            this.token(),
            { headers: { Accept: 'application/vnd.github.diff' } },
            background
        )
        const after = await this.request<Pull>(path, background)
        if (
            before.base.sha !== after.base.sha ||
            before.head.sha !== after.head.sha ||
            before.merge_commit_sha !== after.merge_commit_sha ||
            before.merged_at !== after.merged_at
        )
            throw new Error('PR changed while capturing its revision; refresh and try again')
        const comparable =
            (!integration || provenIntegration) &&
            !/Binary files .* differ/.test(diff) &&
            !diff.includes('GIT binary patch')
        return {
            diff: diff.length <= 2_000_000 ? diff : 'Diff is too large. Open in GitHub.',
            fingerprint: comparable ? fingerprint(diff) : undefined,
            base: provenIntegration ? integration.parents[0].sha : before.base.sha,
            head: integration ? before.merge_commit_sha! : before.head.sha
        }
    }
}
