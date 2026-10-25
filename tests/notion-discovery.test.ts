import { expect, it, vi } from 'vitest'
import { Notion } from '../src/main/notion'
import type { NotionDiscoveryProgress } from '../src/shared/model'
import { Http, HttpError } from '../src/main/http'
import { discoverNotionPages } from '../src/main/notion-discovery'

const urlOf = (input: Parameters<typeof fetch>[0]) => (input instanceof Request ? input.url : input.toString())

const page = (id: string, parent: object = { workspace: true }) => ({
    id,
    url: `https://www.notion.so/${id}`,
    parent,
    properties: { Name: { title: [{ plain_text: id }] } }
})

it('offers indexed destinations before a slow content scan and later includes unindexed descendants', async () => {
    let release!: () => void
    const blocked = new Promise<void>((done) => (release = done))
    const preview = vi.fn()
    const request = vi.fn(async (path: string) => {
        if (path === 'search') return { results: [page('parent')], has_more: false }
        if (path === 'blocks/parent/children?page_size=100') {
            await blocked
            return { results: [{ id: 'child', type: 'child_page' }], has_more: false }
        }
        if (path === 'pages/child') return page('child', { page_id: 'parent' })
        return { results: [], has_more: false }
    })
    const complete = discoverNotionPages(
        async (path) => JSON.parse(JSON.stringify(await request(path))),
        undefined,
        undefined,
        preview
    )
    await vi.waitFor(() => expect(preview).toHaveBeenCalledOnce())
    expect(preview.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'parent', kind: 'page', title: 'parent' })])
    expect(request.mock.calls.filter(([path]) => path === 'search')).toHaveLength(1)
    release()
    expect((await complete).find((node) => node.id === 'child')).toMatchObject({ parentId: 'parent' })
})

it('reports a provider wait while already discovered destinations remain usable', async () => {
    const updates: NotionDiscoveryProgress[] = []
    let throttled = false
    const request = vi.fn((path: string) =>
        Promise.resolve().then(() => {
            if (path === 'search') return { results: [page('parent')], has_more: false }
            if (!throttled) {
                throttled = true
                throw new HttpError(429, 'Limited', Date.now() + 10)
            }
            return { results: [], has_more: false }
        })
    )
    const preview = vi.fn()
    await discoverNotionPages(
        async (path) => JSON.parse(JSON.stringify(await request(path))),
        (update) => updates.push(update),
        undefined,
        preview
    )
    expect(preview).toHaveBeenCalledOnce()
    expect(updates).toContainEqual(expect.objectContaining({ stage: 'waiting', found: 1 }))
})

it('finishes a large discovery after a rate-limit reset without repeating completed reads', async () => {
    let resetAt = 0
    let throttles = 0
    const successes: string[] = []
    const transport = vi.fn<typeof fetch>((input, init) =>
        Promise.resolve().then(() => {
            const path = urlOf(input).replace('https://api.notion.com/v1/', '')
            if (!resetAt && successes.length === 180) resetAt = Date.now() + 1000
            if (Date.now() < resetAt) {
                throttles++
                return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
            }
            successes.push(path)
            if (path === 'search') {
                if (typeof init?.body !== 'string') throw new Error('Expected a search request body')
                const offset = JSON.parse(init.body).start_cursor ? 100 : 0
                return Response.json({
                    results: Array.from({ length: 100 }, (_, i) => page(`p${i + offset}`)),
                    has_more: offset === 0,
                    next_cursor: offset === 0 ? 'next' : null
                })
            }
            return Response.json({ results: [], has_more: false })
        })
    )
    const notion = new Notion(new Http(transport), () => 'fixture-token')
    const result = notion.accessiblePages().then(
        (nodes) => ({ nodes, error: undefined }),
        (error: unknown) => ({ nodes: undefined, error })
    )
    const completed = await result
    expect(completed.error).toBeUndefined()
    expect(completed.nodes).toHaveLength(200)
    expect(throttles).toBe(1)
    expect(successes.filter((path) => path === 'search')).toHaveLength(2)
    expect(successes.filter((path) => path.startsWith('blocks/'))).toHaveLength(200)
    expect(new Set(successes.filter((path) => path.startsWith('blocks/'))).size).toBe(200)
})

it('cancels discovery while waiting for a search rate-limit reset', async () => {
    const controller = new AbortController()
    const request = vi.fn(() => Promise.reject(new HttpError(429, 'Wait', Date.now() + 60000)))
    const result = discoverNotionPages(request, undefined, controller.signal).catch((error: unknown) => error)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    controller.abort(new Error('Discovery cancelled'))
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledOnce()
})

it('stops after bounded rate-limit retries instead of waiting forever', async () => {
    const request = vi.fn(() => Promise.reject(new HttpError(429, 'Still limited', Date.now())))
    const result = discoverNotionPages(request).catch((error: unknown) => error)
    expect(await result).toMatchObject({ status: 429 })
    expect(request).toHaveBeenCalledTimes(4)
})
function fixture(pages: object[], ancestors: Record<string, object | number>) {
    const transport = vi.fn<typeof fetch>((input, init) => {
        let path = urlOf(input).replace('https://api.notion.com/v1/', '')
        if (path.endsWith('/query') && typeof init?.body === 'string') {
            const cursor = JSON.parse(init.body).start_cursor
            if (cursor) path += `?start_cursor=${cursor}`
        }
        if (path === 'search') return Promise.resolve(new Response(JSON.stringify({ results: pages, has_more: false })))
        const result = ancestors[path] ?? (path.includes('/children?') ? { results: [], has_more: false } : undefined)
        if (result === undefined) throw new Error(`Unexpected request: ${path}`)
        return Promise.resolve(
            typeof result === 'number' ? new Response('{}', { status: result }) : new Response(JSON.stringify(result))
        )
    })
    return { notion: new Notion(new Http(transport), () => 'fixture-token'), transport }
}

it('places pages through shared nested blocks beneath their enclosing page with one read per ancestor', async () => {
    const { notion, transport } = fixture(
        [page('journal'), page('first', { block_id: 'inner' }), page('second', { block_id: 'inner' })],
        {
            'blocks/inner': { parent: { block_id: 'outer' } },
            'blocks/outer': { parent: { page_id: 'journal' } }
        }
    )
    const progress: NotionDiscoveryProgress[] = []
    const nodes = await notion.accessiblePages((update) => progress.push(update))
    expect(progress).toEqual([
        { stage: 'discovering', found: 0 },
        { stage: 'discovering', found: 3 },
        { stage: 'grouping', completed: 0, total: 3 },
        { stage: 'grouping', completed: 1, total: 3 },
        { stage: 'grouping', completed: 2, total: 3 },
        { stage: 'grouping', completed: 3, total: 3 }
    ])
    expect(nodes.filter((n) => n.parentId === 'journal').map((n) => n.id)).toEqual(['first', 'second'])
    expect(nodes.every((n) => n.kind === 'page')).toBe(true)
    expect(transport.mock.calls.filter(([url]) => /\/blocks\/(inner|outer)$/.test(urlOf(url)))).toHaveLength(2)
})

it('finds unindexed descendants through paginated children and nested blocks on the first connection', async () => {
    const { notion } = fixture([page('parent')], {
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
    const nodes = await notion.accessiblePages()
    expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
        ['parent', undefined],
        ['child', 'parent'],
        ['nested', 'parent'],
        ['grandchild', 'child']
    ])
})

it('finds unindexed entries in each data source of a nested database and follows query cursors', async () => {
    const { notion } = fixture([page('parent')], {
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
    const nodes = await notion.accessiblePages()
    expect(nodes.map((node) => node.id)).toContain('note')
    expect(nodes.find((node) => node.id === 'note')?.parentId).toBe('notes')
    expect(nodes.find((node) => node.id === 'task')?.parentId).toBe('tasks')
    expect(nodes.find((node) => node.id === 'next-note')?.parentId).toBe('notes')
})

it('rejects a repeated child cursor instead of caching a partial tree or looping', async () => {
    const response = { results: [], has_more: true, next_cursor: 'same' }
    const { notion } = fixture([page('parent')], {
        'blocks/parent/children?page_size=100': response,
        'blocks/parent/children?page_size=100&start_cursor=same': response
    })
    await expect(notion.accessiblePages()).rejects.toThrow()
})

it('keeps readable pages when a child is inaccessible but rejects incomplete discovery on a transient failure', async () => {
    const children = { results: [{ id: 'private', type: 'child_page' }], has_more: false }
    const allowed = fixture([page('parent')], {
        'blocks/parent/children?page_size=100': children,
        'pages/private': 404
    })
    expect((await allowed.notion.accessiblePages()).map((node) => node.id)).toEqual(['parent'])
    const unavailable = fixture([page('parent')], {
        'blocks/parent/children?page_size=100': children,
        'pages/private': 500
    })
    await expect(unavailable.notion.accessiblePages()).rejects.toThrow()
})

it('groups database entries by named data source and resolves a database inside a toggle', async () => {
    const { notion, transport } = fixture(
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
    const nodes = await notion.accessiblePages()
    expect(nodes.find((n) => n.id === 'entry')?.parentId).toBe('notes')
    expect(nodes.find((n) => n.id === 'task')?.parentId).toBe('tasks')
    expect(nodes.filter((n) => n.kind === 'data_source').map((n) => [n.title, n.parentId])).toEqual([
        ['Work journal', 'work'],
        ['Tasks', 'work']
    ])
    expect(nodes.some((n) => n.id === 'db')).toBe(false)
    expect(transport.mock.calls.filter(([url]) => urlOf(url).endsWith('/databases/db'))).toHaveLength(1)
})

it.each([403, 404])('keeps accessible pages visible when an ancestor returns %s', async (status) => {
    const { notion } = fixture([page('entry', { block_id: 'private' }), page('card', { data_source_id: 'private' })], {
        'blocks/private': status,
        'data_sources/private': status
    })
    expect((await notion.accessiblePages()).map((n) => [n.id, n.parentId])).toEqual([
        ['entry', undefined],
        ['card', undefined]
    ])
})

it('surfaces ancestor transport failures so the connection can retry', async () => {
    const { notion } = fixture([page('entry', { block_id: 'offline' })], { 'blocks/offline': 500 })
    await expect(notion.accessiblePages()).rejects.toThrow()
})

it('terminates cyclic and excessively deep ancestry without losing the discovered pages', async () => {
    const ancestors: Record<string, object> = { 'blocks/cycle': { parent: { block_id: 'cycle' } } }
    for (let i = 0; i < 40; i++) ancestors[`blocks/b${i}`] = { parent: { block_id: `b${i + 1}` } }
    const { notion, transport } = fixture(
        [page('cyclic', { block_id: 'cycle' }), page('deep', { block_id: 'b0' })],
        ancestors
    )
    expect((await notion.accessiblePages()).map((n) => [n.id, n.parentId])).toEqual([
        ['cyclic', undefined],
        ['deep', undefined]
    ])
    expect(transport.mock.calls.filter(([url]) => !urlOf(url).includes('/children?')).length).toBeLessThanOrEqual(34)
})
