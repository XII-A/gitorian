import { deferred } from './deferred'
import { run, notionClient, transportClient } from './effect-fixtures'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import type { NotionDiscoveryProgress } from '../src/shared/model'
const endpoint = 'https://api.notion.com/v1'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

async function discovery(respond: (path: string, request: Request) => Response | Promise<Response>) {
    const requests: string[] = []
    server.use(
        http.all(endpoint + '/*', ({ request }) => {
            const path = request.url.slice(endpoint.length + 1)
            requests.push(path)
            return respond(path, request)
        })
    )
    return { notion: notionClient(await transportClient(), () => 'fixture-token'), requests }
}
const page = (id: string, parent: object = { workspace: true }, title = id) => ({
    id,
    url: `https://www.notion.so/${id}`,
    parent,
    properties: { Name: { title: [{ plain_text: title }] } }
})
it('opens a large indexed tree without reading page contents', async () => {
    const { notion, requests } = await discovery(async (path, request) => {
        if (path !== 'search') return Response.json({}, { status: 500 })
        const offset = ((await request.json()) as { start_cursor?: string }).start_cursor ? 100 : 0
        return Response.json({
            results: Array.from({ length: 100 }, (_, index) => page('p' + String(offset + index))),
            has_more: offset === 0,
            next_cursor: offset === 0 ? 'next' : null
        })
    })
    expect(await run(notion.accessiblePages())).toHaveLength(200)
    expect(requests).toEqual(['search', 'search'])
})
it('searches a specific page by title without enumerating unrelated content', async () => {
    const { notion, requests } = await discovery(async (path, request) => {
        if (path === 'search' && ((await request.json()) as { query?: string }).query === 'Decisions')
            return Response.json({ results: [page('result', { page_id: 'parent' })], has_more: false })
        if (path === 'pages/parent') return Response.json(page('parent'))
        return Response.json({}, { status: 500 })
    })
    const nodes = await run(notion.accessiblePages(undefined, undefined, { query: 'Decisions' }))
    expect(nodes.find((node) => node.id === 'result')).toMatchObject({ parentId: 'parent' })
    expect(nodes.find((node) => node.id === 'parent')).toBeDefined()
    expect(requests).toEqual(['search', 'pages/parent'])
})
it('looks up a pasted Notion page link directly when title search has not indexed it', async () => {
    const id = '12345678-1234-1234-1234-123456789abc'
    const { notion, requests } = await discovery((path) =>
        path === 'pages/' + id ? Response.json(page(id)) : Response.json({}, { status: 500 })
    )
    const nodes = await run(
        notion.accessiblePages(undefined, undefined, {
            query: 'https://www.notion.so/Decisions-12345678123412341234123456789abc?source=copy_link'
        })
    )
    expect(nodes.map((node) => node.id)).toEqual([id])
    expect(requests).toEqual(['pages/' + id])
})
it('resumes the same branch after throttling without redoing search', async () => {
    const branch = 'blocks/parent/children?page_size=100'
    let throttled = false
    const { notion, requests } = await discovery((path) => {
        if (path !== branch) return Response.json({}, { status: 500 })
        if (!throttled) {
            throttled = true
            return Response.json({}, { status: 429, headers: { 'Retry-After': '1' } })
        }
        return Response.json({ results: [], has_more: false })
    })
    const updates: NotionDiscoveryProgress[] = []
    const nodes = await run(
        notion.accessiblePages((update) => updates.push(update), undefined, {
            parent: { kind: 'page', id: 'parent', title: 'Parent', url: '' }
        })
    )
    expect(nodes.map((node) => node.id)).toEqual(['parent'])
    expect(requests).toEqual([branch, branch])
    expect(updates).toContainEqual(expect.objectContaining({ stage: 'waiting' }))
})
it('cancels discovery while waiting for a search rate-limit reset', async () => {
    const controller = new AbortController()
    const waiting = deferred<undefined>()
    const { notion, requests } = await discovery(() =>
        Response.json({}, { status: 429, headers: { 'Retry-After': '60' } })
    )
    const result = run(
        notion.accessiblePages((update) => {
            if (update.stage === 'waiting') waiting.resolve(undefined)
        }, controller.signal)
    ).catch((error: unknown) => error)
    try {
        await Promise.race([
            waiting.promise,
            result.then(() => {
                throw new Error('Discovery ended before reporting a rate-limit wait')
            })
        ])
        controller.abort(new Error('Discovery cancelled'))
        expect(await result).toMatchObject({ name: 'AbortError' })
        expect(requests).toEqual(['search'])
    } finally {
        controller.abort()
        await result
    }
})
it('stops after bounded rate-limit retries instead of waiting forever', async () => {
    const { notion, requests } = await discovery(() =>
        Response.json({}, { status: 429, headers: { 'Retry-After': '1' } })
    )
    await expect(run(notion.accessiblePages())).rejects.toMatchObject({ status: 429 })
    expect(requests).toEqual(['search', 'search', 'search', 'search'])
})
async function fixture(pages: object[], ancestors: Record<string, object | number>) {
    return discovery(async (path, request) => {
        if (path.endsWith('/query')) {
            const cursor = (await request.json()).start_cursor
            if (typeof cursor === 'string') path += '?start_cursor=' + cursor
        }
        if (path === 'search') return Response.json({ results: pages, has_more: false })
        const result = ancestors[path] ?? (path.includes('/children?') ? { results: [], has_more: false } : undefined)
        if (result === undefined) return Response.json({}, { status: 500 })
        return typeof result === 'number' ? Response.json({}, { status: result }) : Response.json(result)
    })
}
it('keeps separate pages with the same title under their shared ancestor', async () => {
    const { notion, requests } = await fixture(
        [
            page('journal'),
            page('first', { block_id: 'inner' }, 'Notes'),
            page('second', { block_id: 'inner' }, 'Notes')
        ],
        {
            'blocks/inner': { parent: { block_id: 'outer' } },
            'blocks/outer': { parent: { page_id: 'journal' } }
        }
    )
    const progress: NotionDiscoveryProgress[] = []
    const nodes = await run(notion.accessiblePages((update) => progress.push(update)))
    expect(progress.at(-1)).toEqual({ stage: 'grouping', completed: 3, total: 3 })
    expect(nodes.filter((n) => n.parentId === 'journal')).toMatchObject([
        { id: 'first', title: 'Notes' },
        { id: 'second', title: 'Notes' }
    ])
    expect(nodes.every((n) => n.kind === 'page')).toBe(true)
    expect(requests.filter((path) => /^blocks\/(inner|outer)$/.test(path))).toEqual(['blocks/inner', 'blocks/outer'])
})
it('finds unindexed descendants through paginated children and nested blocks on the first connection', async () => {
    const { notion } = await fixture([page('parent')], {
        'blocks/parent/children?page_size=100': {
            results: [{ id: 'toggle', type: 'toggle', has_children: true }],
            has_more: true,
            next_cursor: 'next'
        },
        'blocks/parent/children?page_size=100&start_cursor=next': {
            results: [{ id: 'child', type: 'child_page' }],
            has_more: false
        },
        'blocks/toggle/children?page_size=100': { results: [{ id: 'nested', type: 'child_page' }], has_more: false },
        'pages/child': page('child', { page_id: 'parent' }),
        'pages/nested': page('nested', { block_id: 'toggle' }),
        'blocks/toggle': { parent: { page_id: 'parent' } },
        'blocks/child/children?page_size=100': { results: [{ id: 'grandchild', type: 'child_page' }], has_more: false },
        'pages/grandchild': page('grandchild', { page_id: 'child' })
    })
    const nodes = await run(
        notion.accessiblePages(undefined, undefined, {
            parent: { kind: 'page', id: 'parent', title: 'parent', url: 'https://www.notion.so/parent' }
        })
    )
    expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
        ['parent', undefined],
        ['child', 'parent'],
        ['nested', 'parent']
    ])
    const children = await run(
        notion.accessiblePages(undefined, undefined, {
            parent: nodes.find((node) => node.id === 'child')!
        })
    )
    expect(children.find((node) => node.id === 'grandchild')).toMatchObject({ parentId: 'child' })
})
it('loads database groups first and queries only the expanded data source with pagination', async () => {
    const { notion } = await fixture([page('parent')], {
        'blocks/parent/children?page_size=100': {
            results: [{ id: 'database', type: 'child_database' }],
            has_more: false
        },
        'databases/database': {
            id: 'database',
            parent: { page_id: 'parent' },
            data_sources: [{ id: 'notes' }, { id: 'tasks' }]
        },
        'data_sources/notes/query': {
            results: [page('note', { data_source_id: 'notes' })],
            has_more: true,
            next_cursor: 'next'
        },
        'data_sources/notes/query?start_cursor=next': {
            results: [page('next-note', { data_source_id: 'notes' })],
            has_more: false
        },
        'data_sources/tasks/query': { results: [page('task', { data_source_id: 'tasks' })], has_more: false },
        'data_sources/notes': { id: 'notes', title: [{ plain_text: 'Notes' }], parent: { database_id: 'database' } },
        'data_sources/tasks': { id: 'tasks', title: [{ plain_text: 'Tasks' }], parent: { database_id: 'database' } }
    })
    const groups = await run(
        notion.accessiblePages(undefined, undefined, {
            parent: { kind: 'page', id: 'parent', title: 'parent', url: '' }
        })
    )
    expect(groups.filter((node) => node.kind === 'data_source').map((node) => node.id)).toEqual(['notes', 'tasks'])
    expect(groups.some((node) => node.id === 'note')).toBe(false)
    const nodes = await run(
        notion.accessiblePages(undefined, undefined, {
            parent: groups.find((node) => node.id === 'notes')!
        })
    )
    expect(nodes.find((node) => node.id === 'note')).toMatchObject({ parentId: 'notes' })
    expect(nodes.find((node) => node.id === 'next-note')).toMatchObject({ parentId: 'notes' })
    expect(nodes.some((node) => node.id === 'task')).toBe(false)
})
it('rejects a repeated child cursor instead of caching a partial tree or looping', async () => {
    const response = { results: [], has_more: true, next_cursor: 'same' }
    const { notion } = await fixture([page('parent')], {
        'blocks/parent/children?page_size=100': response,
        'blocks/parent/children?page_size=100&start_cursor=same': response
    })
    await expect(
        run(
            notion.accessiblePages(undefined, undefined, {
                parent: { kind: 'page', id: 'parent', title: 'parent', url: '' }
            })
        )
    ).rejects.toThrow()
})
it('keeps readable pages when a child is inaccessible but rejects incomplete discovery on a transient failure', async () => {
    const children = { results: [{ id: 'private', type: 'child_page' }], has_more: false }
    const allowed = await fixture([page('parent')], {
        'blocks/parent/children?page_size=100': children,
        'pages/private': 404
    })
    expect(
        (
            await run(
                allowed.notion.accessiblePages(undefined, undefined, {
                    parent: { kind: 'page', id: 'parent', title: 'parent', url: 'https://www.notion.so/parent' }
                })
            )
        ).map((node) => node.id)
    ).toEqual(['parent'])
    const unavailable = await fixture([page('parent')], {
        'blocks/parent/children?page_size=100': children,
        'pages/private': 500
    })
    await expect(
        run(
            unavailable.notion.accessiblePages(undefined, undefined, {
                parent: { kind: 'page', id: 'parent', title: 'parent', url: '' }
            })
        )
    ).rejects.toThrow()
})
it('groups database entries by named data source and resolves a database inside a toggle', async () => {
    const { notion, requests } = await fixture(
        [
            page('work'),
            page('entry', { data_source_id: 'notes', database_id: 'db' }),
            page('task', { data_source_id: 'tasks', database_id: 'db' })
        ],
        {
            'data_sources/notes': {
                id: 'notes',
                title: [{ plain_text: 'Work journal' }],
                parent: { database_id: 'db' }
            },
            'data_sources/tasks': { id: 'tasks', title: [{ plain_text: 'Tasks' }], parent: { database_id: 'db' } },
            'databases/db': { title: [{ plain_text: 'Work database' }], parent: { block_id: 'toggle' } },
            'blocks/toggle': { parent: { page_id: 'work' } }
        }
    )
    const nodes = await run(notion.accessiblePages())
    expect(nodes.find((n) => n.id === 'entry')?.parentId).toBe('notes')
    expect(nodes.find((n) => n.id === 'task')?.parentId).toBe('tasks')
    expect(nodes.filter((n) => n.kind === 'data_source').map((n) => [n.title, n.parentId])).toEqual([
        ['Work journal', 'work'],
        ['Tasks', 'work']
    ])
    expect(nodes.some((n) => n.id === 'db')).toBe(false)
    expect(requests.filter((path) => path === 'databases/db')).toHaveLength(1)
})
it('keeps accessible pages visible when an ancestor is inaccessible', async () => {
    const { notion } = await fixture(
        [page('entry', { block_id: 'private' }), page('card', { data_source_id: 'private' })],
        {
            'blocks/private': 403,
            'data_sources/private': 404
        }
    )
    expect((await run(notion.accessiblePages())).map((n) => [n.id, n.parentId])).toEqual([
        ['entry', undefined],
        ['card', undefined]
    ])
})
it('surfaces ancestor transport failures so the connection can retry', async () => {
    const { notion } = await fixture([page('entry', { block_id: 'offline' })], { 'blocks/offline': 500 })
    await expect(run(notion.accessiblePages())).rejects.toThrow()
})
it('terminates cyclic and excessively deep ancestry without losing the discovered pages', async () => {
    const ancestors: Record<string, object> = { 'blocks/cycle': { parent: { block_id: 'cycle' } } }
    for (let i = 0; i < 40; i++) ancestors[`blocks/b${i}`] = { parent: { block_id: `b${i + 1}` } }
    const { notion, requests } = await fixture(
        [page('cyclic', { block_id: 'cycle' }), page('deep', { block_id: 'b0' })],
        ancestors
    )
    expect((await run(notion.accessiblePages())).map((n) => [n.id, n.parentId])).toEqual([
        ['cyclic', undefined],
        ['deep', undefined]
    ])
    expect(requests.filter((path) => !path.includes('/children?')).length).toBeLessThanOrEqual(34)
})
