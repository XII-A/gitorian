import { journalState } from './database-fixtures'
import { run, notionClient, transportClient } from './effect-fixtures'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { http as route } from 'msw'
import { setupServer } from 'msw/node'
import type { Destination } from '../src/shared/model'
import { journal } from './fixtures'
const endpoint = 'https://api.notion.com/v1'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
    server.resetHandlers()
    server.events.removeAllListeners()
})
afterAll(() => server.close())

it('describes a saved page by its title and emoji and never stores an expired remote icon URL', async () => {
    server.use(
        route.get(
            endpoint + '/pages/saved',
            () =>
                new Response(
                    JSON.stringify({
                        id: 'saved',
                        url: 'https://www.notion.so/saved',
                        icon: { type: 'emoji', emoji: '📓' },
                        properties: { title: { title: [{ plain_text: 'Selected journal' }] } }
                    })
                )
        )
    )
    const notion = notionClient(
        await transportClient(),
        () => 'token',
        undefined,
        () => Promise.reject(new Error('Expired icon'))
    )
    const destination: Destination = { kind: 'page', id: 'saved', titleProperty: 'Name', dateProperty: '' }
    expect(await run(notion.describeDestination(destination))).toEqual({
        ...destination,
        title: 'Selected journal',
        icon: '📓',
        url: 'https://www.notion.so/saved'
    })
    expect(await run(notion.destinationIcon('https://example.com/expired.png'))).toBeUndefined()
})
it('never creates a page when a selected existing destination becomes inaccessible', async () => {
    const requests: string[] = []
    server.events.on('request:start', ({ request }) => requests.push(request.method))
    server.use(route.get(endpoint + '/pages/removed-page', () => Response.json({}, { status: 404 })))
    const notion = notionClient(await transportClient(), () => 'pending-token')
    await expect(
        run(
            notion.prepareJournal({ id: 'setup', started: false }, vi.fn(), {
                kind: 'page',
                id: 'removed-page',
                titleProperty: 'Name',
                dateProperty: ''
            })
        )
    ).rejects.toThrow()
    expect(requests).toEqual(['GET'])
})
it.each(['existing', 'new'])(
    'saves a %s destination after the canceled scan has paused the shared provider budget',
    async (kind) => {
        const requests: string[] = []
        server.events.on('request:start', ({ request }) => requests.push(request.method))
        server.use(
            route.get(
                endpoint + '/blocks/parent/children',
                () => Response.json({}, { status: 429, headers: { 'Retry-After': '1' } }),
                { once: true }
            ),
            route.get(endpoint + '/blocks/parent/children', () => Response.json({ results: [], has_more: false })),
            route.get(endpoint + '/pages/parent', () => Response.json({ id: 'parent' })),
            route.post(endpoint + '/pages', () => Response.json({ id: 'parent' }))
        )
        const http = await transportClient()
        await expect(
            run(http.request('https://api.notion.com/v1/blocks/parent/children', 'token'))
        ).rejects.toMatchObject({
            status: 429
        })
        const notion = notionClient(http, () => 'token')
        await expect(
            run(
                notion.prepareJournal(
                    { id: 'setup', started: false },
                    vi.fn(),
                    kind === 'existing'
                        ? {
                              kind: 'page',
                              id: 'parent',
                              titleProperty: 'Name',
                              dateProperty: ''
                          }
                        : undefined
                )
            )
        ).resolves.toMatchObject({ id: 'parent' })
        expect(requests).toEqual(['GET', kind === 'existing' ? 'GET' : 'POST', ...(kind === 'new' ? ['GET'] : [])])
    }
)
it('checkpoints private journal creation before writing, then reuses the confirmed destination', async () => {
    const events: string[] = []
    server.events.on('request:start', ({ request }) => events.push(request.method + ' ' + request.url))
    server.use(
        route.post(endpoint + '/pages', async ({ request }) => {
            const body = (await request.json()) as { parent?: { type?: string; workspace?: boolean } }
            if (
                request.headers.get('Notion-Version') !== '2026-03-11' ||
                body.parent?.type !== 'workspace' ||
                body.parent.workspace !== true
            )
                return Response.json({}, { status: 400 })
            return Response.json({ id: 'private-journal' })
        }),
        route.get(endpoint + '/blocks/private-journal/children', () => Response.json({ results: [], has_more: false }))
    )
    const notion = notionClient(await transportClient(), () => 'oauth-token')
    const destination = await run(
        notion.prepareJournal({ id: 'setup-one', started: false }, (id) => events.push(id ?? 'creating'))
    )
    expect(destination).toEqual({ kind: 'page', id: 'private-journal', titleProperty: 'Name', dateProperty: '' })
    expect(events).toEqual([
        'creating',
        'POST https://api.notion.com/v1/pages',
        'private-journal',
        'GET https://api.notion.com/v1/blocks/private-journal/children?page_size=100'
    ])
    expect(
        await run(
            notion.prepareJournal({ id: 'setup-one', started: true, pageId: 'private-journal' }, () => {
                throw new Error('Should reuse')
            })
        )
    ).toEqual(destination)
    expect(events.filter((event) => event.startsWith('POST '))).toHaveLength(1)
})
it('recovers an uncertain journal creation only by its setup marker and never blindly creates again', async () => {
    const requests: string[] = []
    const checkpoints: (string | undefined)[] = []
    server.events.on('request:start', ({ request }) => requests.push(request.method + ' ' + request.url))
    server.use(
        route.post(endpoint + '/search', () =>
            Response.json({
                results: [{ id: 'matching', properties: { title: { title: [{ plain_text: 'Weekly Journal' }] } } }],
                has_more: false
            })
        ),
        route.delete(endpoint + '/blocks/marker', () =>
            Response.json({}, { status: checkpoints.includes('matching') ? 200 : 409 })
        ),
        route.get(endpoint + '/blocks/matching/children', () =>
            Response.json({
                results: [
                    {
                        id: 'marker',
                        type: 'paragraph',
                        paragraph: { rich_text: [{ plain_text: 'gitorian setup: setup-one' }] }
                    }
                ],
                has_more: false
            })
        )
    )
    const notion = notionClient(await transportClient(), () => 'oauth-token')
    expect(
        (await run(notion.prepareJournal({ id: 'setup-one', started: true }, (id) => checkpoints.push(id)))).id
    ).toBe('matching')
    expect(checkpoints).toContain('matching')
    server.use(route.post(endpoint + '/search', () => Response.json({ results: [], has_more: false })))
    await expect(run(notion.prepareJournal({ id: 'uncertain', started: true }, vi.fn()))).rejects.toThrow(
        /confirm|existing/i
    )
    expect(requests).not.toContain('POST ' + endpoint + '/pages')
})
it('returns the integration name and avatar without exposing other user details', async () => {
    server.use(
        route.get(endpoint + '/users/me', () =>
            Response.json({
                name: 'Weekly journal',
                avatar_url: 'https://example.com/bot.png',
                id: 'bot-id',
                bot: { owner: { workspace: true } }
            })
        )
    )
    const notion = notionClient(await transportClient(), () => 'test-token')
    expect(await run(notion.profile())).toEqual({ name: 'Weekly journal', avatarUrl: 'https://example.com/bot.png' })
})
it('handles an integration with no name or avatar', async () => {
    server.use(route.get(endpoint + '/users/me', () => Response.json({ name: null, avatar_url: null })))
    expect(await run(notionClient(await transportClient(), () => 'test-token').profile())).toEqual({
        name: 'Notion integration'
    })
})
it.each(['page', 'database'] as const)(
    'tests a %s destination without listing or reading its entries',
    async (kind) => {
        const url = endpoint + (kind === 'page' ? '/pages' : '/data_sources') + '/destination'
        const requests: string[] = []
        server.events.on('request:start', ({ request }) => requests.push(request.method + ' ' + request.url))
        server.use(route.get(url, () => Response.json({})))
        const notion = notionClient(await transportClient(), () => 'test-token')
        await run(notion.verifyDestination({ kind, id: 'destination', titleProperty: 'Name', dateProperty: '' }))
        expect(requests).toEqual(['GET ' + url])
    }
)
it.each([
    [400, 'Check the page ID and try again.'],
    [401, 'Reconnect Notion with a valid integration token and try again.'],
    [404, 'Page could not be reached. Check the ID and share it with your Notion integration.'],
    [500, 'Could not test the destination. Check your connection and try again.']
] as const)('gives the correct destination recovery guidance for HTTP %s', async (status, message) => {
    server.use(route.get(endpoint + '/pages/destination', () => Response.json({}, { status })))
    const notion = notionClient(await transportClient(), () => 'test-token')
    await expect(
        run(notion.verifyDestination({ kind: 'page', id: 'destination', titleProperty: 'Name', dateProperty: '' }))
    ).rejects.toMatchObject({ message })
})
it('refreshes only app-published entries even after the destination changes', async () => {
    const app = await journal()
    try {
        app.remote.pages.push({
            id: 'unrelated',
            url: 'https://notion.so/unrelated',
            created_time: new Date().toISOString(),
            properties: { title: { title: [{ text: { content: 'Existing Notion entry' } }] } },
            blocks: []
        })
        await run(app.service.handle({ type: 'refresh', source: 'notion' }))
        expect(app.remote.requests).toEqual([])
        expect((await journalState(app.store)).entries).toEqual([])
        await run(app.service.handle({ type: 'newDraft', week: '2026-10-05' }))
        await run(app.service.handle({ type: 'publish', draftId: (await journalState(app.store)).drafts[0].id }))
        const published = app.remote.pages[1]
        published.properties = { title: { title: [{ text: { content: 'Updated in Notion' } }] } }
        app.remote.requests.length = 0
        await app.store.setDestination(undefined)
        await run(app.service.handle({ type: 'refresh', source: 'notion' }))
        expect((await journalState(app.store)).entries.map((entry) => entry.id)).toEqual([published.id])
        expect((await journalState(app.store)).entries[0].title).toBe('Updated in Notion')
        expect(app.remote.requests.map((request) => request.url)).toEqual([
            `https://api.notion.com/v1/pages/${published.id}`,
            `https://api.notion.com/v1/blocks/${published.id}/children?page_size=100`
        ])
    } finally {
        await app.close()
    }
})
it('rejects an empty destination before making a request', async () => {
    const requests: string[] = []
    server.events.on('request:start', ({ request }) => requests.push(request.url))
    const notion = notionClient(await transportClient(), () => 'test-token')
    const destination: Destination = { kind: 'page', id: '  ', titleProperty: 'Name', dateProperty: '' }
    await expect(run(notion.verifyDestination(destination))).rejects.toThrow('Enter a destination ID')
    expect(requests).toEqual([])
})

it('removes only its own setup marker after the durable checkpoint and resumes failed cleanup without creating again', async () => {
    let saved: string | undefined
    let fail = true
    const deleted: string[] = []
    let creates = 0
    server.use(
        route.post(endpoint + '/pages', () => {
            creates++
            return Response.json({ id: 'journal' })
        }),
        route.delete(endpoint + '/blocks/:id', ({ request }) => {
            if (saved !== 'journal' || fail) return Response.json({}, { status: 403 })
            deleted.push(new URL(request.url).pathname)
            return Response.json({})
        }),
        route.get(endpoint + '/blocks/journal/children', () =>
            Response.json({
                results: [
                    {
                        id: 'mine',
                        type: 'paragraph',
                        paragraph: { rich_text: [{ plain_text: 'gitorian setup: mine' }] }
                    },
                    {
                        id: 'other',
                        type: 'paragraph',
                        paragraph: { rich_text: [{ plain_text: 'gitorian setup: other' }] }
                    },
                    { id: 'content', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'My journal' }] } }
                ],
                has_more: false
            })
        )
    )
    const notion = notionClient(await transportClient(), () => 'token')
    await expect(
        run(
            notion.prepareJournal({ id: 'mine', started: false }, (id) => {
                saved = id
            })
        )
    ).rejects.toThrow()
    expect(saved).toBe('journal')
    fail = false
    await expect(
        run(notion.prepareJournal({ id: 'mine', started: true, pageId: saved }, vi.fn()))
    ).resolves.toMatchObject({ id: 'journal' })
    expect(deleted).toEqual(['/v1/blocks/mine'])
    expect(creates).toBe(1)
})
