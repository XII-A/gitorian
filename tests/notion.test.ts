import { expect, it, vi } from 'vitest'
import { Notion } from '../src/main/notion'
import { Http } from '../src/main/http'
import type { Destination } from '../src/shared/model'
import { journal } from './fixtures'

it('describes a saved page by its title and emoji and never stores an expired remote icon URL', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
            JSON.stringify({
                id: 'saved',
                url: 'https://www.notion.so/saved',
                icon: { type: 'emoji', emoji: '📓' },
                properties: { title: { title: [{ plain_text: 'Selected journal' }] } }
            })
        )
    )
    const notion = new Notion(
        new Http(transport),
        () => 'token',
        undefined,
        () => Promise.reject(new Error('Expired icon'))
    )
    const destination: Destination = { kind: 'page', id: 'saved', titleProperty: 'Name', dateProperty: '' }
    expect(await notion.describeDestination(destination)).toEqual({
        ...destination,
        title: 'Selected journal',
        icon: '📓',
        url: 'https://www.notion.so/saved'
    })
    expect(await notion.destinationIcon('https://example.com/expired.png')).toBeUndefined()
})

it('lists every accessible page by name across cursors, preserving duplicate titles and parent context', async () => {
    const page = (id: string, parent?: string) => ({
        id,
        url: `https://www.notion.so/${id}`,
        icon: { type: 'emoji', emoji: '📓' },
        parent: parent ? { type: 'page_id', page_id: parent } : { type: 'workspace', workspace: true },
        properties: { title: { title: [{ plain_text: 'Journal' }] } }
    })
    const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    results: [page('parent')],
                    has_more: true,
                    next_cursor: 'next-page'
                })
            )
        )
        .mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    results: [page('child', 'parent')],
                    has_more: false,
                    next_cursor: null
                })
            )
        )
    const notion = new Notion(new Http(transport), () => 'pending-token')
    expect(await notion.accessiblePages()).toEqual([
        {
            kind: 'page',
            id: 'parent',
            title: 'Journal',
            url: 'https://www.notion.so/parent',
            icon: '📓',
            parentId: undefined
        },
        {
            kind: 'page',
            id: 'child',
            title: 'Journal',
            url: 'https://www.notion.so/child',
            icon: '📓',
            parentId: 'parent'
        }
    ])
    expect(JSON.parse(transport.mock.calls[1][1]!.body as string).start_cursor).toBe('next-page')
    expect(transport.mock.calls.every(([, init]) => JSON.parse(init!.body as string).filter.value === 'page')).toBe(
        true
    )
})

it('never creates a page when a selected existing destination becomes inaccessible', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 }))
    const notion = new Notion(new Http(transport), () => 'pending-token')
    await expect(
        notion.prepareJournal({ id: 'setup', started: false }, vi.fn(), {
            kind: 'page',
            id: 'removed-page',
            titleProperty: 'Name',
            dateProperty: ''
        })
    ).rejects.toThrow()
    expect(transport.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET'])
})

it('checkpoints private journal creation before writing, then reuses the confirmed destination', async () => {
    const events: string[] = []
    const transport = vi.fn<typeof fetch>((url, init) => {
        events.push(`${init?.method ?? 'GET'} ${url instanceof Request ? url.url : url.toString()}`)
        return Promise.resolve(new Response(JSON.stringify({ id: 'private-journal' })))
    })
    const notion = new Notion(new Http(transport), () => 'oauth-token')
    const destination = await notion.prepareJournal({ id: 'setup-one', started: false }, (id) =>
        events.push(id ?? 'creating')
    )
    expect(destination).toEqual({ kind: 'page', id: 'private-journal', titleProperty: 'Name', dateProperty: '' })
    expect(events).toEqual(['creating', 'POST https://api.notion.com/v1/pages', 'private-journal'])
    const init = transport.mock.calls[0][1]!
    expect(new Headers(init.headers).get('Notion-Version')).toBe('2026-03-11')
    expect(JSON.parse(init.body as string).parent).toEqual({ type: 'workspace', workspace: true })
    expect(
        await notion.prepareJournal({ id: 'setup-one', started: true, pageId: 'private-journal' }, () => {
            throw new Error('Should reuse')
        })
    ).toEqual(destination)
    expect(transport).toHaveBeenCalledTimes(1)
})

it('recovers an uncertain journal creation only by its setup marker and never blindly creates again', async () => {
    const transport = vi.fn<typeof fetch>((url) =>
        Promise.resolve(
            new Response(
                JSON.stringify(
                    (url instanceof Request ? url.url : url.toString()).endsWith('/search')
                        ? {
                              results: [
                                  {
                                      id: 'matching',
                                      properties: { title: { title: [{ plain_text: 'Weekly Journal' }] } }
                                  }
                              ],
                              has_more: false
                          }
                        : {
                              results: [
                                  {
                                      type: 'paragraph',
                                      paragraph: { rich_text: [{ plain_text: 'gitorian setup: setup-one' }] }
                                  }
                              ],
                              has_more: false
                          }
                )
            )
        )
    )
    const notion = new Notion(new Http(transport), () => 'oauth-token')
    const checkpoint = vi.fn()
    expect((await notion.prepareJournal({ id: 'setup-one', started: true }, checkpoint)).id).toBe('matching')
    expect(checkpoint).toHaveBeenCalledWith('matching')
    expect(
        transport.mock.calls.some(([url]) => (url instanceof Request ? url.url : url.toString()).endsWith('/pages'))
    ).toBe(false)
    const empty = new Notion(
        new Http(() => Promise.resolve(new Response(JSON.stringify({ results: [], has_more: false })))),
        () => 'oauth-token'
    )
    await expect(empty.prepareJournal({ id: 'uncertain', started: true }, checkpoint)).rejects.toThrow(
        /confirm|existing/i
    )
})

it('returns the integration name and avatar without exposing other user details', async () => {
    const transport = vi.fn<typeof fetch>(() =>
        Promise.resolve(
            new Response(
                JSON.stringify({
                    name: 'Weekly journal',
                    avatar_url: 'https://example.com/bot.png',
                    id: 'bot-id',
                    bot: { owner: { workspace: true } }
                })
            )
        )
    )
    const notion = new Notion(new Http(transport), () => 'test-token')
    expect(await notion.profile()).toEqual({ name: 'Weekly journal', avatarUrl: 'https://example.com/bot.png' })
    expect(transport.mock.calls[0][0]).toBe('https://api.notion.com/v1/users/me')
})

it('handles an integration with no name or avatar', async () => {
    const transport: typeof fetch = () =>
        Promise.resolve(new Response(JSON.stringify({ name: null, avatar_url: null })))
    expect(await new Notion(new Http(transport), () => 'test-token').profile()).toEqual({ name: 'Notion integration' })
})

it.each(['page', 'database'] as const)(
    'tests a %s destination without listing or reading its entries',
    async (kind) => {
        const transport = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')))
        const notion = new Notion(new Http(transport), () => 'test-token')
        await notion.verifyDestination({ kind, id: 'destination', titleProperty: 'Name', dateProperty: '' })
        expect(transport).toHaveBeenCalledTimes(1)
        expect(transport.mock.calls[0][0]).toBe(
            `https://api.notion.com/v1/${kind === 'page' ? 'pages' : 'data_sources'}/destination`
        )
        expect(transport.mock.calls[0][1]?.method ?? 'GET').toBe('GET')
    }
)

it.each([400, 401, 404, 500])('explains an unreachable destination (%s)', async (status) => {
    const transport = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status })))
    const notion = new Notion(new Http(transport), () => 'test-token')
    await expect(
        notion.verifyDestination({ kind: 'page', id: 'destination', titleProperty: 'Name', dateProperty: '' })
    ).rejects.toThrow(/Check|Reconnect/)
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
        await app.service.handle({ type: 'refresh', source: 'notion' })
        expect(app.remote.requests).toEqual([])
        expect(app.store.state.entries).toEqual([])
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
        const published = app.remote.pages[1]
        published.properties = { title: { title: [{ text: { content: 'Updated in Notion' } }] } }
        app.remote.requests.length = 0
        // Published entries remain tracked when the user changes the publishing destination.
        app.store.state.settings.destination = undefined
        await app.service.handle({ type: 'refresh', source: 'notion' })
        expect(app.store.state.entries.map((entry) => entry.id)).toEqual([published.id])
        expect(app.store.state.entries[0].title).toBe('Updated in Notion')
        expect(app.remote.requests.map((request) => request.url)).toEqual([
            `https://api.notion.com/v1/pages/${published.id}`,
            `https://api.notion.com/v1/blocks/${published.id}/children?page_size=100`
        ])
    } finally {
        await app.close()
    }
})

it('rejects an empty destination before making a request', async () => {
    const transport = vi.fn<typeof fetch>()
    const notion = new Notion(new Http(transport), () => 'test-token')
    const destination: Destination = { kind: 'page', id: '  ', titleProperty: 'Name', dateProperty: '' }
    await expect(notion.verifyDestination(destination)).rejects.toThrow('Enter a destination ID')
    expect(transport).not.toHaveBeenCalled()
})
