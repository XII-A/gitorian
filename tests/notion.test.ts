import { expect, it, vi } from 'vitest'
import { Notion } from '../src/main/notion'
import { Http } from '../src/main/http'
import { Store } from '../src/main/store'
import type { Destination } from '../src/shared/model'
import { workspace } from './fixtures'

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

it.each([400, 401, 403, 404, 429, 500])('explains an unreachable destination (%s)', async (status) => {
    const transport = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status })))
    const notion = new Notion(new Http(transport), () => 'test-token')
    await expect(
        notion.verifyDestination({ kind: 'page', id: 'destination', titleProperty: 'Name', dateProperty: '' })
    ).rejects.toThrow(/Check|Reconnect/)
})

it.each(['page', 'database'] as const)('refreshes only app-published entries for a %s destination', async (kind) => {
    const app = await workspace()
    try {
        app.store.state.settings.destination!.kind = kind
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

it('drops previously imported entries on restore and restart while keeping app publications', async () => {
    const app = await workspace()
    try {
        await app.service.handle({ type: 'newDraft', week: '2026-10-05' })
        await app.service.handle({ type: 'publish', draftId: app.store.state.drafts[0].id })
        const published = structuredClone(app.store.state.entries[0])
        const unrelated = { ...published, id: 'unrelated' }
        app.store.state.entries.push(unrelated)
        app.store.state.coverage.push({ activityId: 'old-activity', entryId: unrelated.id })
        const backup = app.store.export()
        app.store.persist()
        const reopened = new Store(`${app.directory}/tracking.sqlite`)
        try {
            expect(reopened.state.entries).toEqual([published])
            expect(reopened.state.coverage).toEqual([])
        } finally {
            reopened.close()
        }
        app.store.restore(backup)
        expect(app.store.state.entries).toEqual([published])
        expect(app.store.state.coverage).toEqual([])
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
