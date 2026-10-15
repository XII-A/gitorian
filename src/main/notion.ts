import type { Destination, Entry, State } from '../shared/model'
import type { NotionBlock } from '../shared/notion-format'
import { fromNotion, toNotion } from '../shared/notion-format'
import type { Http } from './http'
import { HttpError } from './http'
import { cursorPages } from './pagination'

interface Page {
    id: string
    url: string
    created_time: string
    properties: Record<string, { title?: { plain_text?: string; text?: { content: string } }[] }>
}
interface List<T> {
    results: T[]
    has_more: boolean
    next_cursor: string | null
}
export class Notion {
    private readonly http: Http
    private readonly token: () => string
    constructor(http: Http, token: () => string) {
        this.http = http
        this.token = token
    }
    private async request<T>(path: string, init?: RequestInit): Promise<T> {
        const token = this.token()
        if (!token) {
            throw new Error('Connect Notion to publish or refresh')
        }
        return await this.http.request<T>(`https://api.notion.com/v1/${path}`, token, init)
    }
    async verify(): Promise<void> {
        await this.request('users/me')
    }
    async blocks(id: string): Promise<NotionBlock[]> {
        const blocks: NotionBlock[] = []
        for await (const results of cursorPages<NotionBlock>((cursor) =>
            this.request<List<NotionBlock>>(
                `blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
            )
        )) {
            for await (const block of results) {
                if (block.has_children && block.id && block.type !== 'child_page' && block.type !== 'child_database') {
                    block.children = await this.blocks(block.id)
                }
                blocks.push(block)
            }
        }
        return blocks
    }
    async pages(destination: Destination): Promise<Page[]> {
        if (destination.kind === 'database') {
            const pages: Page[] = []
            for await (const results of cursorPages<Page>((cursor) =>
                this.request<List<Page>>(`data_sources/${encodeURIComponent(destination.id)}/query`, {
                    body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
                    method: 'POST'
                })
            )) {
                pages.push(...results)
            }
            return pages
        }
        const blocks = await this.blocks(destination.id)
        const ids: string[] = []
        const visit = (items: NotionBlock[]) => {
            for (const block of items) {
                if (block.type === 'child_page' && block.id) {
                    ids.push(block.id)
                }
                visit(block.children ?? [])
            }
        }
        visit(blocks)
        const pages: Page[] = []
        for await (const id of ids) {
            pages.push(await this.request<Page>(`pages/${id}`))
        }
        return pages
    }
    async entry(page: Page): Promise<Entry> {
        const title =
            Object.values(page.properties)
                .find((property) => property.title)
                ?.title?.map((text) => text.plain_text ?? text.text?.content ?? '')
                .join('') ?? 'Untitled'
        return {
            body: fromNotion(await this.blocks(page.id)),
            date: page.created_time,
            id: page.id,
            refreshedAt: new Date().toISOString(),
            title,
            url: page.url
        }
    }
    async publish(save: State['saves'][number], checkpoint?: () => void): Promise<Entry> {
        if (!save.title.trim() || save.title.length > 2000) {
            throw new HttpError(400, 'Use a title between 1 and 2000 characters')
        }
        const children = toNotion(save.body)
        children.unshift({
            object: 'block',
            paragraph: {
                rich_text: [
                    {
                        text: {
                            content: 'Published with weekly-j',
                            link: { url: `https://github.com/XII-A/weekly-j#${save.marker}` }
                        },
                        type: 'text'
                    }
                ]
            },
            type: 'paragraph'
        })
        const batches = Notion.batches(children)
        const { destination } = save
        const properties: Record<string, unknown> = {
            [destination.kind === 'page' ? 'title' : destination.titleProperty]: {
                title: [{ text: { content: save.title } }]
            }
        }
        if (destination.kind === 'database' && destination.dateProperty) {
            properties[destination.dateProperty] = { date: { start: save.week ?? save.createdAt.slice(0, 10) } }
        }
        const page = await this.request<Page>('pages', {
            body: JSON.stringify({
                children: batches[0],
                parent: destination.kind === 'page' ? { page_id: destination.id } : { data_source_id: destination.id },
                properties
            }),
            method: 'POST'
        })
        save.entryId = page.id
        checkpoint?.()
        for await (const childrenValue of batches.slice(1)) {
            await this.request(`blocks/${page.id}/children`, {
                body: JSON.stringify({ children: childrenValue }),
                method: 'PATCH'
            })
        }
        return {
            body: save.body,
            date: save.createdAt,
            id: page.id,
            refreshedAt: new Date().toISOString(),
            title: save.title,
            url: page.url
        }
    }
    async reconcile(save: State['saves'][number]): Promise<Entry | undefined> {
        const pages = save.entryId
            ? [await this.request<Page>(`pages/${save.entryId}`)]
            : await this.pages(save.destination)
        for await (const page of pages) {
            const blocks = await this.blocks(page.id)
            const matches = blocks.some(
                (block) => block.type === 'paragraph' && JSON.stringify(block.paragraph).includes(save.marker)
            )
            if (matches) {
                const body = fromNotion(blocks)
                const actual = toNotion(body)
                const expected = toNotion(save.body)
                if (JSON.stringify(actual) === JSON.stringify(expected)) {
                    return { ...(await this.entry(page)), body }
                }
                if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length))) {
                    throw new Error(
                        'The possible saved page differs from the draft. Coverage remains pending; inspect it in Notion.'
                    )
                }
                // Re-read and verify an exact prefix before resuming a partial append.
                for await (const children of Notion.batches(expected.slice(actual.length))) {
                    await this.request(`blocks/${page.id}/children`, {
                        body: JSON.stringify({ children }),
                        method: 'PATCH'
                    })
                }
                return { ...(await this.entry(page)), body: save.body }
            }
        }
        return undefined
    }
    private static batches(blocks: NotionBlock[]): NotionBlock[][] {
        const batches: NotionBlock[][] = []
        let batch: NotionBlock[] = []
        let bytes = 0
        for (const block of blocks) {
            const size = Buffer.byteLength(JSON.stringify(block))
            if (size > 450_000) {
                throw new HttpError(
                    400,
                    'A journal block exceeds the Notion payload limit; split this block before publishing'
                )
            }
            if (batch.length >= 100 || bytes + size > 450_000) {
                batches.push(batch)
                batch = []
                bytes = 0
            }
            batch.push(block)
            bytes += size
        }
        if (batch.length) {
            batches.push(batch)
        }
        return batches
    }
}
