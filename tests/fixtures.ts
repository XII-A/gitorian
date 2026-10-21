import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Store } from '../src/main/store'
import { Http } from '../src/main/http'
import { Notion } from '../src/main/notion'
import { GitHub } from '../src/main/github'
import { JournalService } from '../src/main/service'
import type { NotionBlock } from '../src/shared/notion-format'
import { afterAll } from 'vitest'

const execute = promisify(execFile)
const gitAt =
    (directory: string) =>
    async (...args: string[]) =>
        (await execute('git', args, { cwd: directory, windowsHide: true })).stdout.trim()

async function removeFixture(directory: string) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !target.startsWith(resolve(tmpdir()) + sep + 'weekly-j-'))
        throw new Error(`Unexpected fixture directory: ${target}`)
    await rm(target, { recursive: true, force: true })
}

let gitTemplate: Promise<string> | undefined
let templateDirectory: string | undefined
async function createGitTemplate() {
    templateDirectory = await mkdtemp(join(tmpdir(), 'weekly-j-git-template-'))
    const git = gitAt(templateDirectory)
    await git('init', '-b', 'development')
    await git('config', 'user.name', 'Journal author')
    await git('config', 'user.email', 'first@example.com')
    await writeFile(join(templateDirectory, 'work.txt'), 'initial\n')
    await git('add', 'work.txt')
    await git('commit', '-m', 'Initial work')
    await git('branch', 'main')
    return templateDirectory
}

afterAll(async () => {
    if (templateDirectory) await removeFixture(templateDirectory)
})
export const patch =
    'diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
export async function journal() {
    const directory = await mkdtemp(join(tmpdir(), 'weekly-j-test-'))
    const store = new Store(join(directory, 'tracking.sqlite'))
    const remote = transport()
    const http = new Http(remote.fetch)
    const github = new GitHub(
        http,
        () => 'test-token',
        (token) => {
            remote.token = token
        }
    )
    const notion = new Notion(http, () => 'test-token')
    const service = new JournalService(store, github, notion, () => ({
        github: remote.github,
        notion: true,
        protectedStorage: true
    }))
    store.state.settings.githubLogin = 'me'
    store.state.settings.destination = { kind: 'page', id: 'parent', titleProperty: 'Name', dateProperty: '' }
    return {
        directory,
        store,
        remote,
        service,
        github,
        notion,
        close: async () => {
            store.close()
            await removeFixture(directory)
        }
    }
}
export async function workspace() {
    const app = await journal()
    const git = gitAt(app.directory)
    try {
        // Copy a pristine real repository, never hardlink it or share mutable refs.
        // Each scenario still owns its checkout, SQLite store, and transport state.
        await cp(await (gitTemplate ??= createGitTemplate()), app.directory, { recursive: true })
        await app.service.addRepository(app.directory)
        const repository = app.store.state.repositories[0]
        repository.remote = 'https://github.com/example/project.git'
        return { ...app, git, repository }
    } catch (error) {
        await app.close()
        throw error
    }
}
export function transport() {
    let githubVersion = ''
    let githubUpdatedAt = new Date().toISOString()
    let revision = 0
    const pages: {
        id: string
        url: string
        created_time: string
        properties: Record<string, unknown>
        blocks: NotionBlock[]
    }[] = []
    const requests: { url: string; method: string; body?: Record<string, unknown> }[] = []
    const remote = {
        pages,
        requests,
        github: false,
        token: '',
        patch,
        head: 'a'.repeat(40),
        authorDate: '2026-10-06T10:00:00Z',
        authorEmail: 'second@example.com',
        merged: false,
        mergeParents: ['b'.repeat(40), 'a'.repeat(40)],
        finalPatch: patch,
        failCreate: false,
        loseCreateResponse: false,
        failAppend: false,
        loseAppendResponse: false,
        failDiff: false,
        diffStatus: 200,
        fetch: (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
            Promise.resolve().then(() => {
                const url = input instanceof Request ? input.url : String(input)
                const method = init.method ?? 'GET'
                const body =
                    typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
                requests.push({ url, method, body })
                const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
                const list = (results: unknown[]) => json({ results, has_more: false, next_cursor: null })
                if (url.includes('api.github.com')) {
                    const version = JSON.stringify([
                        remote.head,
                        remote.patch,
                        remote.merged,
                        remote.finalPatch,
                        remote.mergeParents,
                        remote.authorDate,
                        remote.authorEmail
                    ])
                    if (version !== githubVersion) {
                        githubVersion = version
                        githubUpdatedAt = new Date(Date.now() + revision++).toISOString()
                    }
                    const pull = {
                        number: 1,
                        title: 'Improve work',
                        body: 'Context',
                        html_url: 'https://github.com/example/project/pull/1',
                        created_at: '2026-10-05T10:00:00Z',
                        updated_at: githubUpdatedAt,
                        merged_at: remote.merged ? '2026-10-07T10:00:00Z' : null,
                        merge_commit_sha: remote.merged ? 'c'.repeat(40) : null,
                        user: { login: 'someone-else' },
                        base: { ref: 'main', sha: 'b'.repeat(40) },
                        head: { ref: 'feature', sha: remote.head }
                    }
                    if (new Headers(init.headers).get('Accept') === 'application/vnd.github.diff') {
                        if (remote.failDiff) throw new Error('Diff connection unavailable')
                        if (remote.diffStatus !== 200)
                            return new Response(
                                JSON.stringify({
                                    message: 'Sorry, the diff exceeded the maximum number of lines.',
                                    errors: [{ resource: 'PullRequest', field: 'diff', code: 'too_large' }]
                                }),
                                { status: remote.diffStatus, statusText: 'Not Acceptable' }
                            )
                        return new Response(
                            url.includes(`/commits/${'c'.repeat(40)}`) ? remote.finalPatch : remote.patch
                        )
                    }
                    if (/\/commits\/[a-f0-9]+/.test(url))
                        return json({
                            files: [{ filename: 'a.ts', status: 'modified' }],
                            parents: remote.mergeParents.map((sha) => ({ sha }))
                        })
                    if (url.includes('/commits'))
                        return json([
                            {
                                sha: 'd'.repeat(40),
                                commit: {
                                    author: { email: remote.authorEmail, date: remote.authorDate },
                                    message: 'My contribution'
                                }
                            }
                        ])
                    if (url.includes('/reviews'))
                        return json([
                            {
                                id: 10,
                                body: 'Reviewed thoughtfully',
                                submitted_at: '2026-10-07T11:00:00Z',
                                user: { login: 'me' },
                                state: 'APPROVED',
                                html_url: 'https://github.com/example/project/pull/1#review-10'
                            }
                        ])
                    if (url.includes('/files')) return json([{ filename: 'a.ts', status: 'modified' }])
                    if (url.includes('/pulls?')) return json([pull])
                    return json(pull)
                }
                if (url.endsWith('/pages') && method === 'POST') {
                    if (remote.failCreate) return new Response('{}', { status: 400, statusText: 'Bad Request' })
                    const page = {
                        id: randomUUID(),
                        url: 'https://www.notion.so/entry',
                        created_time: new Date().toISOString(),
                        properties: body?.properties as Record<string, unknown>,
                        blocks: ((body?.children ?? []) as NotionBlock[]).map((block) => ({
                            ...block,
                            id: randomUUID()
                        }))
                    }
                    pages.push(page)
                    if (remote.loseCreateResponse) {
                        remote.loseCreateResponse = false
                        throw new Error('Connection lost after server commit')
                    }
                    return json(page)
                }
                if (url.includes('/data_sources/') && url.endsWith('/query')) return list(pages)
                if (url.includes('/blocks/parent/children'))
                    return list([
                        {
                            id: 'year-toggle',
                            type: 'toggle',
                            toggle: { rich_text: [{ type: 'text', text: { content: '2026' } }] },
                            has_children: true
                        }
                    ])
                if (url.includes('/blocks/year-toggle/children'))
                    return list(
                        pages.map((page) => ({ id: page.id, type: 'child_page', child_page: { title: 'Saved entry' } }))
                    )
                const id = /\/(?:blocks|pages)\/([^/?]+)/.exec(url)?.[1]
                const page = pages.find((item) => item.id === id)
                if (method === 'DELETE') {
                    const owner = pages.find((item) => item.blocks.some((block) => block.id === id))
                    if (owner) {
                        owner.blocks = owner.blocks.filter((block) => block.id !== id)
                        return json({ id, archived: true })
                    }
                }
                if (page && url.includes('/children')) {
                    if (method === 'PATCH') {
                        if (remote.failAppend) {
                            remote.failAppend = false
                            throw new Error('Append connection lost')
                        }
                        page.blocks.push(
                            ...((body?.children ?? []) as NotionBlock[]).map((block) => ({
                                ...block,
                                id: randomUUID()
                            }))
                        )
                        if (remote.loseAppendResponse) {
                            remote.loseAppendResponse = false
                            throw new Error('Append response lost after commit')
                        }
                        return list(page.blocks)
                    }
                    return list(page.blocks)
                }
                if (page) {
                    if (method === 'PATCH')
                        page.properties = { ...page.properties, ...(body?.properties as Record<string, unknown>) }
                    return json(page)
                }
                throw new Error(`Unexpected fixture request: ${method} ${url}`)
            })
    }
    return remote
}
