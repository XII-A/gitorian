import { app, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const profile = process.env.GITORIAN_E2E_PROFILE
if (!profile) throw new Error('An owned disposable provider profile is required')
app.setPath('userData', profile)
mkdirSync(profile, { recursive: true })
let githubUser = 102
let offline = false
let pending = true
let held = false
let releaseDiff
let diffGate
app.on('gitorian-provider-hold-diff', () => {
    diffGate = new Promise((done) => {
        releaseDiff = done
    })
})
app.on('gitorian-provider-release-diff', () => {
    releaseDiff?.()
    diffGate = undefined
    held = false
})
app.on('gitorian-provider-read-state', (target) => {
    target.held = held
})
const requests = []
app.on('gitorian-provider-user', (id) => {
    githubUser = id
    pending = true
})
app.on('gitorian-provider-offline', (value) => {
    offline = value
})
let browserUnavailable = true
app.on('gitorian-provider-browser-ready', () => {
    browserUnavailable = false
})
shell.openExternal = async () => {
    if (browserUnavailable) throw new Error('Synthetic missing browser')
}
const users = {
    101: { id: 101, login: 'alex-personal', email: 'personal@example.test' },
    102: { id: 102, login: 'alex-work', email: 'work@example.test' },
    201: { id: 201, username: 'alex-lab', email: 'lab@example.test' }
}
const mergeRequest = (iid) => ({
    iid,
    title: iid === 1 ? 'Improve GitLab workflow' : 'Older review work',
    description: 'Handle interrupted saves safely.',
    web_url: `https://gitlab.com/team/sub/project/-/merge_requests/${iid}`,
    author: { id: iid === 1 ? 201 : 301, username: iid === 1 ? 'alex-lab' : 'teammate' },
    created_at: iid === 1 ? '2026-10-26T10:00:00Z' : '2025-01-01T10:00:00Z',
    updated_at: iid === 1 ? '2026-10-28T10:00:00Z' : '2025-01-01T10:00:00Z',
    state: 'opened',
    merged_at: null,
    closed_at: null,
    merge_commit_sha: null,
    source_branch: 'topic',
    target_branch: 'main',
    sha: 'a'.repeat(40),
    changes_count: '1',
    diff_refs: { base_sha: 'b'.repeat(40), head_sha: 'a'.repeat(40), start_sha: 'b'.repeat(40) }
})
globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push({
        host: url.host,
        path: url.pathname + url.search,
        method: init.method ?? 'GET',
        githubHeaders: new Headers(init.headers).has('X-GitHub-Api-Version')
    })
    if (offline) throw new Error('Synthetic provider outage')
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
    const provider = url.host === 'gitlab.com' ? 'gitlab' : 'github'
    if (url.pathname.endsWith('/device/code') || url.pathname.endsWith('/authorize_device')) {
        return json({
            device_code: `fixture-${provider}-${provider === 'github' ? githubUser : 201}`,
            user_code: provider === 'github' ? 'GHTX-ABCD' : 'GLTX-WXYZ',
            verification_uri:
                provider === 'github' ? 'https://github.com/login/device' : 'https://gitlab.com/oauth/device',
            interval: 1,
            expires_in: 300
        })
    }
    if (url.pathname.endsWith('/access_token') || url.pathname === '/oauth/token') {
        if (pending) {
            pending = false
            return json({ error: 'authorization_pending' }, 400)
        }
        const body =
            new Headers(init.headers).get('Content-Type') === 'application/x-www-form-urlencoded'
                ? Object.fromEntries(new URLSearchParams(init.body))
                : JSON.parse(init.body)
        const id = Number(body.device_code?.split('-').at(-1) ?? githubUser)
        return json({ access_token: `synthetic-user-${id}` })
    }
    const id = Number(new Headers(init.headers).get('Authorization')?.split('-').at(-1))
    const user = users[id]
    if (!user) return json({ message: 'Unauthenticated' }, 401)
    if (url.pathname.endsWith('/user/emails'))
        return json([{ email: user.email, verified: true, confirmed_at: '2026-01-01T00:00:00Z' }])
    if (url.pathname.endsWith('/user')) return json(user)
    if (/^\/repositories\/\d+$/.test(url.pathname))
        return json({ full_name: url.pathname.endsWith('12') ? 'team/shared' : 'team/backend' })
    if (/\/repos\/[^/]+\/[^/]+$/.test(url.pathname))
        return json({
            id: url.pathname.includes('shared') ? 12 : 11,
            private: false,
            owner: { type: 'Organization', login: 'team' }
        })
    if (/\/projects\/[^/]+$/.test(url.pathname))
        return json({ id: 21, path_with_namespace: 'team/sub/project', namespace: { kind: 'group', path: 'team' } })
    if (provider === 'gitlab' && url.pathname.includes('/merge_requests')) {
        if (url.pathname.endsWith('/merge_requests'))
            return json(url.searchParams.get('page') === '1' ? [mergeRequest(1), mergeRequest(2)] : [])
        const iid = Number(/\/merge_requests\/(\d+)/.exec(url.pathname)?.[1])
        if (url.pathname.endsWith('/commits'))
            return json(
                iid === 1
                    ? [
                          {
                              id: 'a'.repeat(40),
                              title: 'Support interrupted saves',
                              message: 'Support interrupted saves',
                              author_email: 'lab@example.test',
                              authored_date: '2026-10-28T10:00:00Z',
                              web_url: 'https://gitlab.com/team/sub/project/-/commit/' + 'a'.repeat(40)
                          }
                      ]
                    : []
            )
        if (url.pathname.endsWith('/notes'))
            return json(
                iid === 2
                    ? [
                          {
                              id: 900,
                              body: 'Please handle interrupted saves.',
                              author: { id: 201, username: 'alex-lab' },
                              created_at: '2026-10-28T11:00:00Z',
                              system: false
                          }
                      ]
                    : []
            )
        if (url.pathname.endsWith('/diffs')) {
            if (diffGate) {
                held = true
                await diffGate
            }
            return json([
                { old_path: 'old.ts', new_path: 'work.ts', renamed_file: true, diff: '@@ -1 +1 @@\n-old\n+supported\n' }
            ])
        }
        return json(mergeRequest(iid))
    }
    if (url.pathname.endsWith('/pulls') || url.pathname.endsWith('/merge_requests')) return json([])
    throw new Error(`Unexpected synthetic provider request: ${url.host}${url.pathname}`)
}
app.on('before-quit', () => writeFileSync(join(profile, 'provider-requests.json'), JSON.stringify(requests, null, 2)))
await import(pathToFileURL(resolve('out/main/index.js')).href)
