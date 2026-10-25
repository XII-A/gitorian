import { expect, it, vi } from 'vitest'
import { Notion } from '../src/main/notion'
import type { NotionDiscoveryProgress } from '../src/shared/model'
import { Http } from '../src/main/http'

const urlOf = (input: Parameters<typeof fetch>[0]) => (input instanceof Request ? input.url : input.toString())

const page = (id: string, parent: object = { workspace: true }) => ({
    id,
    url: `https://www.notion.so/${id}`,
    parent,
    properties: { Name: { title: [{ plain_text: id }] } }
})
function fixture(pages: object[], ancestors: Record<string, object | number>) {
    const transport = vi.fn<typeof fetch>((input) => {
        const path = urlOf(input).replace('https://api.notion.com/v1/', '')
        if (path === 'search') return Promise.resolve(new Response(JSON.stringify({ results: pages, has_more: false })))
        const result = ancestors[path]
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
    expect(transport.mock.calls.filter(([url]) => urlOf(url).includes('/blocks/'))).toHaveLength(2)
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
    expect(transport.mock.calls.length).toBeLessThanOrEqual(34)
})
