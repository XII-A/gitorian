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

it('opens a large indexed tree without reading page contents', async () => {
    const requests: string[] = []
    const transport = vi.fn<typeof fetch>((input, init) => {
        const path = urlOf(input).replace('https://api.notion.com/v1/', '')
        requests.push(path)
        if (path !== 'search') throw new Error(`Initial discovery crawled content: ${path}`)
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
        const offset = JSON.parse(init.body).start_cursor ? 100 : 0
        return Promise.resolve(
            Response.json({
                results: Array.from({ length: 100 }, (_, i) => page(`p${offset + i}`)),
                has_more: offset === 0,
                next_cursor: offset === 0 ? 'next' : null
            })
        )
    })
    const nodes = await new Notion(new Http(transport), () => 'fixture-token').accessiblePages()
    expect(nodes).toHaveLength(200)
    expect(requests).toEqual(['search', 'search'])
})

it('searches a specific page by title without enumerating unrelated content', async () => {
    const transport = vi.fn<typeof fetch>((input, init) => {
        const path = urlOf(input).replace('https://api.notion.com/v1/', '')
        if (path === 'search') {
            if (typeof init?.body !== 'string') throw new Error('Expected JSON request body')
            expect(JSON.parse(init.body).query).toBe('Decisions')
            return Promise.resolve(Response.json({ results: [page('result', { page_id: 'parent' })], has_more: false }))
        }
        if (path === 'pages/parent') return Promise.resolve(Response.json(page('parent')))
        throw new Error(`Search crawled unrelated content: ${path}`)
    })
    const nodes = await new Notion(new Http(transport), () => 'fixture-token').accessiblePages(undefined, undefined, {
        query: 'Decisions'
    })
    expect(nodes.find((node) => node.id === 'result')).toMatchObject({ parentId: 'parent' })
    expect(nodes.find((node) => node.id === 'parent')).toBeDefined()
    expect(transport).toHaveBeenCalledTimes(2)
})

it('looks up a pasted Notion page link directly when title search has not indexed it', async () => {
    const id = '12345678-1234-1234-1234-123456789abc'
    const transport = vi.fn<typeof fetch>((input) => {
        expect(urlOf(input)).toBe(`https://api.notion.com/v1/pages/${id}`)
        return Promise.resolve(Response.json(page(id)))
    })
    const nodes = await new Notion(new Http(transport), () => 'fixture-token').accessiblePages(undefined, undefined, {
        query: 'https://www.notion.so/Decisions-12345678123412341234123456789abc?source=copy_link'
    })
    expect(nodes.map((node) => node.id)).toEqual([id])
    expect(transport).toHaveBeenCalledOnce()
})

it('resumes the same branch after throttling without redoing search', async () => {
    let throttled = false
    const transport = vi.fn<typeof fetch>((input) => {
        const path = urlOf(input).replace('https://api.notion.com/v1/', '')
        if (path !== 'blocks/parent/children?page_size=100') throw new Error(`Unexpected read: ${path}`)
        if (!throttled) {
            throttled = true
            return Promise.resolve(new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }))
        }
        return Promise.resolve(Response.json({ results: [], has_more: false }))
    })
    const updates: NotionDiscoveryProgress[] = []
    const nodes = await new Notion(new Http(transport), () => 'fixture-token').accessiblePages(
        (update) => updates.push(update),
        undefined,
        { parent: { kind: 'page', id: 'parent', title: 'Parent', url: '' } }
    )
    expect(nodes.map((node) => node.id)).toEqual(['parent'])
    expect(transport).toHaveBeenCalledTimes(2)
    expect(updates).toContainEqual(expect.objectContaining({ stage: 'waiting' }))
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
    const nodes = await notion.accessiblePages(undefined, undefined, {
        parent: { kind: 'page', id: 'parent', title: 'parent', url: 'https://www.notion.so/parent' }
    })
    expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
        ['parent', undefined],
        ['child', 'parent'],
        ['nested', 'parent']
    ])
    const children = await notion.accessiblePages(undefined, undefined, {
        parent: nodes.find((node) => node.id === 'child')!
    })
    expect(children.find((node) => node.id === 'grandchild')).toMatchObject({ parentId: 'child' })
})

it('loads database groups first and queries only the expanded data source with pagination', async () => {
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
    const groups = await notion.accessiblePages(undefined, undefined, {
        parent: { kind: 'page', id: 'parent', title: 'parent', url: '' }
    })
    expect(groups.filter((node) => node.kind === 'data_source').map((node) => node.id)).toEqual(['notes', 'tasks'])
    expect(groups.some((node) => node.id === 'note')).toBe(false)
    const nodes = await notion.accessiblePages(undefined, undefined, {
        parent: groups.find((node) => node.id === 'notes')!
    })
    expect(nodes.find((node) => node.id === 'note')).toMatchObject({ parentId: 'notes' })
    expect(nodes.find((node) => node.id === 'next-note')).toMatchObject({ parentId: 'notes' })
    expect(nodes.some((node) => node.id === 'task')).toBe(false)
})

it('rejects a repeated child cursor instead of caching a partial tree or looping', async () => {
    const response = { results: [], has_more: true, next_cursor: 'same' }
    const { notion } = fixture([page('parent')], {
        'blocks/parent/children?page_size=100': response,
        'blocks/parent/children?page_size=100&start_cursor=same': response
    })
    await expect(
        notion.accessiblePages(undefined, undefined, {
            parent: { kind: 'page', id: 'parent', title: 'parent', url: '' }
        })
    ).rejects.toThrow()
})

it('keeps readable pages when a child is inaccessible but rejects incomplete discovery on a transient failure', async () => {
    const children = { results: [{ id: 'private', type: 'child_page' }], has_more: false }
    const allowed = fixture([page('parent')], {
        'blocks/parent/children?page_size=100': children,
        'pages/private': 404
    })
    expect(
        (
            await allowed.notion.accessiblePages(undefined, undefined, {
                parent: { kind: 'page', id: 'parent', title: 'parent', url: 'https://www.notion.so/parent' }
            })
        ).map((node) => node.id)
    ).toEqual(['parent'])
    const unavailable = fixture([page('parent')], {
        'blocks/parent/children?page_size=100': children,
        'pages/private': 500
    })
    await expect(
        unavailable.notion.accessiblePages(undefined, undefined, {
            parent: { kind: 'page', id: 'parent', title: 'parent', url: '' }
        })
    ).rejects.toThrow()
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
