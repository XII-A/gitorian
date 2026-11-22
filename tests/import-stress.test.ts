import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http as route } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { indexCommits } from '../src/main/git'
import { makeGitLab } from '../src/main/gitlab'
import { run, transportClient } from './effect-fixtures'

const repository = {
    id: 'stress',
    name: 'Stress',
    path: '',
    remote: '',
    base: 'main',
    emails: ['stress@example.com'],
    trackingStart: '2020-01-01',
    available: true,
    removed: false,
    branchBases: {},
    branches: []
}
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

it('bounds GitLab hydration reads for large unrelated merge requests', async () => {
    const api = 'https://gitlab.com/api/v4/'
    let reads = 0
    server.use(
        route.get(`${api}projects/:project/merge_requests`, ({ request }) => {
            reads++
            const recent = new URL(request.url).searchParams.get('per_page') === '5'
            return Response.json(
                Array.from({ length: recent ? 5 : 20 }, (_, i) => ({ iid: i + (recent ? 101 : 1), author: { id: 99 } }))
            )
        }),
        route.get(`${api}projects/:project/merge_requests/:iid/notes`, () => {
            reads++
            return Response.json([])
        }),
        route.get(`${api}projects/:project/merge_requests/:iid/commits`, ({ request }) => {
            reads++
            const page = Number(new URL(request.url).searchParams.get('page'))
            return Response.json(
                page <= 10 ? Array.from({ length: 100 }, () => ({ author_email: 'other@example.com' })) : []
            )
        })
    )
    const http = await transportClient()
    const gitlab = makeGitLab(<A>(path: string) => http.request<A>(api + path, 'fixture'), '42')
    await expect(
        run(gitlab.activities({ ...repository, remote: 'https://gitlab.com/example/project.git' }, 'stress', []))
    ).rejects.toMatchObject({ status: 429 })
    expect(reads).toBe(25)
})

it('retains a Git commit when its message exceeds the history read budget', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-git-message-'))
    try {
        const git = (args: string[], input?: string) => {
            const result = spawnSync('git', args, { cwd: directory, input, encoding: 'utf8', windowsHide: true })
            expect(result.status, result.stderr).toBe(0)
        }
        git(['init', '-b', 'main'])
        const message = 'x'.repeat(8_100_000) + '\n'
        git(
            ['fast-import', '--quiet'],
            `commit refs/heads/main\ncommitter Stress <stress@example.com> 1791280800 +0000\ndata ${Buffer.byteLength(message)}\n${message}\n`
        )
        const { items } = await indexCommits({ ...repository, path: directory }, {}, '2020-01-01')
        expect(items).toHaveLength(1)
        expect(items[0].description).toContain('preview limit')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
