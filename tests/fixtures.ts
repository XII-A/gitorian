import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { promisify } from 'node:util'

import { GitHub } from '../src/main/github'
import { Http } from '../src/main/http'
import { Notion } from '../src/main/notion'
import { JournalService } from '../src/main/service'
import { Store } from '../src/main/store'
import type { NotionBlock } from '../src/shared/notion-format'

const json = (value: unknown) => Response.json(value, { status: 200 })

const execute = promisify(execFile)
export const patch =
    'diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
export const transport = () => {
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
        authorDate: '2026-10-06T10:00:00Z',
        authorEmail: 'second@example.com',
        diffStatus: 200,
        failAppend: false,
        failCreate: false,
        failDiff: false,
        fetch: (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
            Promise.resolve(
                Promise.resolve().then(() => {
                    const url = input instanceof Request ? input.url : String(input)
                    const method = init.method ?? 'GET'
                    const body =
                        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
                    requests.push({ body, method, url })

                    const list = (results: unknown[]) => json({ has_more: false, next_cursor: null, results })
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
                            githubUpdatedAt = new Date(Date.now() + (revision += 1)).toISOString()
                        }
                        const pull = {
                            base: { ref: 'main', sha: 'b'.repeat(40) },
                            body: 'Context',
                            created_at: '2026-10-05T10:00:00Z',
                            head: { ref: 'feature', sha: remote.head },
                            html_url: 'https://github.com/example/project/pull/1',
                            merge_commit_sha: remote.merged ? 'c'.repeat(40) : null,
                            merged_at: remote.merged ? '2026-10-07T10:00:00Z' : null,
                            number: 1,
                            title: 'Improve work',
                            updated_at: githubUpdatedAt,
                            user: { login: 'someone-else' }
                        }
                        if (new Headers(init.headers).get('Accept') === 'application/vnd.github.diff') {
                            if (remote.failDiff) {
                                throw new Error('Diff connection unavailable')
                            }
                            if (remote.diffStatus !== 200) {
                                return Response.json(
                                    {
                                        errors: [{ code: 'too_large', field: 'diff', resource: 'PullRequest' }],
                                        message: 'Sorry, the diff exceeded the maximum number of lines.'
                                    },
                                    { status: remote.diffStatus, statusText: 'Not Acceptable' }
                                )
                            }
                            return new Response(
                                url.includes(`/commits/${'c'.repeat(40)}`) ? remote.finalPatch : remote.patch
                            )
                        }
                        if (/\/commits\/[a-f0-9]+/u.test(url)) {
                            return json({
                                files: [{ filename: 'a.ts', status: 'modified' }],
                                parents: remote.mergeParents.map((sha) => ({ sha }))
                            })
                        }
                        if (url.includes('/commits')) {
                            return json([
                                {
                                    commit: {
                                        author: { date: remote.authorDate, email: remote.authorEmail },
                                        message: 'My contribution'
                                    },
                                    sha: 'd'.repeat(40)
                                }
                            ])
                        }
                        if (url.includes('/reviews')) {
                            return json([
                                {
                                    body: 'Reviewed thoughtfully',
                                    html_url: 'https://github.com/example/project/pull/1#review-10',
                                    id: 10,
                                    state: 'APPROVED',
                                    submitted_at: '2026-10-07T11:00:00Z',
                                    user: { login: 'me' }
                                }
                            ])
                        }
                        if (url.includes('/files')) {
                            return json([{ filename: 'a.ts', status: 'modified' }])
                        }
                        if (url.includes('/pulls?')) {
                            return json([pull])
                        }
                        return json(pull)
                    }
                    if (url.endsWith('/pages') && method === 'POST') {
                        if (remote.failCreate) {
                            return new Response('{}', { status: 400, statusText: 'Bad Request' })
                        }
                        const page = {
                            blocks: body?.children as NotionBlock[],
                            created_time: new Date().toISOString(),
                            id: randomUUID(),
                            properties: body?.properties as Record<string, unknown>,
                            url: 'https://www.notion.so/entry'
                        }
                        pages.push(page)
                        if (remote.loseCreateResponse) {
                            remote.loseCreateResponse = false
                            throw new Error('Connection lost after server commit')
                        }
                        return json(page)
                    }
                    if (url.includes('/data_sources/') && url.endsWith('/query')) {
                        return list(pages)
                    }
                    if (url.includes('/blocks/parent/children')) {
                        return list([
                            {
                                has_children: true,
                                id: 'year-toggle',
                                toggle: { rich_text: [{ text: { content: '2026' }, type: 'text' }] },
                                type: 'toggle'
                            }
                        ])
                    }
                    if (url.includes('/blocks/year-toggle/children')) {
                        return list(
                            pages.map((page) => ({
                                child_page: { title: 'Saved entry' },
                                id: page.id,
                                type: 'child_page'
                            }))
                        )
                    }
                    const [, id] = /\/(?:blocks|pages)\/(?<group1>[^/?]+)/u.exec(url) ?? []
                    const page = pages.find((item) => item.id === id)
                    if (page && url.includes('/children')) {
                        if (method === 'PATCH') {
                            if (remote.failAppend) {
                                remote.failAppend = false
                                throw new Error('Append connection lost')
                            }
                            page.blocks.push(...(body?.children as NotionBlock[]))
                            return list(page.blocks)
                        }
                        return list(page.blocks)
                    }
                    if (page) {
                        return json(page)
                    }
                    throw new Error(`Unexpected fixture request: ${method} ${url}`)
                })
            ),
        finalPatch: patch,
        github: false,
        head: 'a'.repeat(40),
        loseCreateResponse: false,
        mergeParents: ['b'.repeat(40), 'a'.repeat(40)],
        merged: false,
        pages,
        patch,
        requests,
        token: ''
    }
    return remote
}

export const workspace = async () => {
    const directory = await mkdtemp(nodePath.join(tmpdir(), 'weekly-j-test-'))
    const git = async (...args: string[]) => {
        const awaited1 = await execute('git', args, { cwd: directory, windowsHide: true })
        return awaited1.stdout.trim()
    }
    await git('init', '-b', 'development')
    await git('config', 'user.name', 'Journal author')
    await git('config', 'user.email', 'first@example.com')
    await writeFile(nodePath.join(directory, 'work.txt'), 'initial\n')
    await git('add', 'work.txt')
    await git('commit', '-m', 'Initial work')
    await git('branch', 'main')
    const store = new Store(nodePath.join(directory, 'tracking.sqlite'))
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
    await service.addRepository(directory)
    const [repository] = store.state.repositories
    repository.remote = 'https://github.com/example/project.git'
    store.state.settings.githubLogin = 'me'
    store.state.settings.destination = { dateProperty: '', id: 'parent', kind: 'page', titleProperty: 'Name' }
    return {
        close: async () => {
            store.close()
            await rm(directory, { force: true, recursive: true })
        },
        directory,
        git,
        notion,
        remote,
        repository,
        service,
        store
    }
}
