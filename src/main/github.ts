import type { Activity, Repository } from '../shared/model'
import type { Http } from './http'
import { fingerprint, githubRemote } from './git'

interface User {
    login: string
}
interface Pull {
    number: number
    title: string
    body: string | null
    html_url: string
    created_at: string
    merged_at: string | null
    merge_commit_sha: string | null
    user: User
    base: { ref: string; sha: string }
    head: { ref: string; sha: string }
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
    private request<T>(path: string): Promise<T> {
        return this.http.request<T>(`https://api.github.com/${path}`, this.token())
    }
    private async list<T>(path: string): Promise<T[]> {
        const result: T[] = []
        for (let page = 1; ; page++) {
            const items = await this.request<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
            result.push(...items)
            if (items.length < 100) return result
        }
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
    async activities(repository: Repository, login: string, trackedPrIds: string[]): Promise<Activity[]> {
        const remote = githubRemote(repository.remote)
        if (!remote || !this.token()) return []
        const pulls = await this.list<Pull>(`repos/${remote}/pulls?state=all&sort=updated&direction=desc`)
        const activities: Activity[] = []
        for (const summary of pulls) {
            const path = `repos/${remote}/pulls/${summary.number}`
            const pr = await this.request<Pull>(path)
            const commits = await this.list<Commit>(`${path}/commits`)
            const reviews = await this.list<Review>(`${path}/reviews`)
            const id = `${repository.id}:pr:${pr.number}`
            const mine = commits.filter((commit) =>
                repository.emails.some((email) => email.toLowerCase() === commit.commit.author.email.toLowerCase())
            )
            const myReviews = reviews.filter(
                (review) => review.user.login === login && review.submitted_at && review.state !== 'PENDING'
            )
            if (pr.user.login !== login && !mine.length && !myReviews.length && !trackedPrIds.includes(id)) continue
            const files = await this.list<File>(`${path}/files`)
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
                files: files.map((file) => ({ name: file.filename, status: file.status })),
                base: pr.base.ref,
                head: pr.head.sha,
                disposition: 'inbox' as const,
                explicit: false,
                deletedBranches: []
            }
            activities.push({ ...common, id, kind: 'pr', date: latest })
            activities.push({
                ...common,
                id: `${id}:opened`,
                kind: 'opened',
                date: pr.created_at,
                title: `Opened ${common.title}`
            })
            if (pr.merged_at)
                activities.push({
                    ...common,
                    id: `${id}:merged`,
                    kind: 'merged',
                    date: pr.merged_at,
                    title: `Merged ${common.title}`,
                    integrationSha: pr.merge_commit_sha ?? undefined
                })
            for (const commit of mine)
                activities.push({
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
                activities.push({
                    ...common,
                    id: `${id}:review:${review.id}`,
                    kind: 'review',
                    author: login,
                    date: review.submitted_at!,
                    title: `${review.state}: ${common.title}`,
                    description: review.body,
                    url: review.html_url
                })
        }
        return activities
    }
    async commitDetails(repository: Repository, sha: string): Promise<{ diff: string; files: Activity['files'] }> {
        const remote = githubRemote(repository.remote)
        if (!remote || !/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('GitHub commit source is unavailable')
        const path = `repos/${remote}/commits/${sha}`
        const metadata = await this.request<{ files: File[] }>(path)
        const diff = await this.http.request<string>(
            `https://api.github.com/${path}`,
            this.token(),
            { headers: { Accept: 'application/vnd.github.diff' } },
            'text'
        )
        return {
            diff: diff.length <= 2_000_000 ? diff : 'Diff is too large. Open in GitHub.',
            files: metadata.files.map((file) => ({ name: file.filename, status: file.status }))
        }
    }
    async snapshot(
        repository: Repository,
        activity: Activity
    ): Promise<{ diff: string; fingerprint?: string; base: string; head: string }> {
        const remote = githubRemote(repository.remote)
        const number = activity.prId?.split(':').at(-1)
        if (!remote || !number) throw new Error('GitHub remote is unavailable')
        const path = `repos/${remote}/pulls/${number}`
        const before = await this.request<Pull>(path)
        const integration =
            before.merged_at && before.merge_commit_sha
                ? await this.request<{ parents: { sha: string }[] }>(
                      `repos/${remote}/commits/${before.merge_commit_sha}`
                  )
                : undefined
        // A linear integration tip may be only the last of several rebased commits.
        // Only a true merge proves that its first-parent diff includes the full integration.
        const provenIntegration = integration && integration.parents.length > 1
        const diffPath = provenIntegration ? `repos/${remote}/commits/${before.merge_commit_sha}` : path
        const diff = await this.http.request<string>(
            `https://api.github.com/${diffPath}`,
            this.token(),
            { headers: { Accept: 'application/vnd.github.diff' } },
            'text'
        )
        const after = await this.request<Pull>(path)
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
