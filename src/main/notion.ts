import { fromNotion, toNotion } from '../shared/notion-format'
import type { NotionBlock } from '../shared/notion-format'
import type { Destination, Entry, ConnectionProfile, State } from '../shared/model'
import type { Http } from './http'
import { HttpError } from './http'
import type { Store } from './store'
import { downloadImage, UnsupportedImageError } from './images'
import { imageIds, imageExtension } from '../shared/images'

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
    constructor(
        private readonly http: Http,
        private readonly token: () => string,
        private readonly images?: Pick<Store, 'image' | 'importImage'>,
        private readonly imageDownload = downloadImage
    ) {}
    private request<T>(path: string, init?: RequestInit): Promise<T> {
        const token = this.token()
        if (!token) throw new Error('Connect Notion to publish or refresh')
        return this.http.request<T>(`https://api.notion.com/v1/${path}`, token, init)
    }
    async profile(): Promise<ConnectionProfile> {
        const user = await this.request<{ name?: string | null; avatar_url?: string | null }>('users/me')
        return {
            name: user.name?.trim() || 'Notion integration',
            avatarUrl: user.avatar_url?.startsWith('https://') ? user.avatar_url : undefined
        }
    }
    async verifyDestination(destination: Destination): Promise<void> {
        if (!destination.id.trim()) throw new Error('Enter a destination ID first.')
        const kind = destination.kind === 'page' ? 'Page' : 'Database data source'
        try {
            await this.request(
                `${destination.kind === 'page' ? 'pages' : 'data_sources'}/${encodeURIComponent(destination.id.trim())}`
            )
        } catch (error) {
            if (error instanceof HttpError) {
                if (error.status === 401)
                    throw new Error('Reconnect Notion with a valid integration token and try again.')
                if (error.status === 403 || error.status === 404)
                    throw new Error(
                        `${kind} could not be reached. Check the ID and share it with your Notion integration.`
                    )
                if (error.status === 400)
                    throw new Error(
                        `Check the ${destination.kind === 'page' ? 'page' : 'data source'} ID and try again.`
                    )
            }
            throw new Error('Could not test the destination. Check your connection and try again.')
        }
    }
    async refreshEntry(id: string): Promise<Entry> {
        return this.entry(await this.request<Page>(`pages/${encodeURIComponent(id)}`))
    }
    async blocks(id: string): Promise<NotionBlock[]> {
        const blocks: NotionBlock[] = []
        let cursor: string | null = null
        do {
            const response: List<NotionBlock> = await this.request(
                `blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
            )
            for (const block of response.results) {
                if (block.type === 'image' && this.images) {
                    const image = block.image as { type: string; file?: { url: string }; external?: { url: string } }
                    const url = image.type === 'file' ? image.file?.url : image.external?.url
                    if (!url) throw new Error('Could not retrieve the Notion image. Refresh again.')
                    try {
                        const downloaded = await this.imageDownload(url)
                        block.managedAssetId = await this.images.importImage(downloaded.bytes)
                    } catch (error) {
                        if (!(error instanceof UnsupportedImageError)) throw error
                        // Unsupported media cannot match a managed image during verification.
                    }
                }
                if (block.has_children && block.id && block.type !== 'child_page' && block.type !== 'child_database')
                    block.children = await this.blocks(block.id)
                blocks.push(block)
            }
            cursor = response.has_more ? response.next_cursor : null
        } while (cursor)
        return blocks
    }
    async pages(destination: Destination): Promise<Page[]> {
        if (destination.kind === 'database') {
            const pages: Page[] = []
            let cursor: string | null = null
            do {
                const response: List<Page> = await this.request(
                    `data_sources/${encodeURIComponent(destination.id)}/query`,
                    {
                        method: 'POST',
                        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
                    }
                )
                pages.push(...response.results)
                cursor = response.has_more ? response.next_cursor : null
            } while (cursor)
            return pages
        }
        const blocks = await this.blocks(destination.id)
        const ids: string[] = []
        const visit = (items: NotionBlock[]) => {
            for (const block of items) {
                if (block.type === 'child_page' && block.id) ids.push(block.id)
                visit(block.children ?? [])
            }
        }
        visit(blocks)
        const pages: Page[] = []
        for (const id of ids) pages.push(await this.request<Page>(`pages/${id}`))
        return pages
    }
    async entry(page: Page): Promise<Entry> {
        const title =
            Object.values(page.properties)
                .find((property) => property.title)
                ?.title?.map((text) => text.plain_text ?? text.text?.content ?? '')
                .join('') ?? 'Untitled'
        return {
            id: page.id,
            title,
            date: page.created_time,
            url: page.url,
            body: fromNotion(await this.blocks(page.id)),
            refreshedAt: new Date().toISOString()
        }
    }
    async publish(save: State['saves'][number], checkpoint?: () => void | Promise<void>): Promise<Entry> {
        if (!save.title.trim() || save.title.length > 2000)
            throw new HttpError(400, 'Use a title between 1 and 2000 characters')
        if (save.entryId) return this.update(save, checkpoint)
        const children = toNotion(save.body, await this.uploadImages(save, checkpoint))
        const batches = this.batches(children)
        const destination = save.destination
        const properties: Record<string, unknown> = {
            [destination.kind === 'page' ? 'title' : destination.titleProperty]: {
                title: [{ text: { content: save.title } }]
            }
        }
        if (destination.kind === 'database' && destination.dateProperty)
            properties[destination.dateProperty] = { date: { start: save.week ?? save.createdAt.slice(0, 10) } }
        const page = await this.request<Page>('pages', {
            method: 'POST',
            body: JSON.stringify({
                parent: destination.kind === 'page' ? { page_id: destination.id } : { data_source_id: destination.id },
                properties,
                children: batches[0] ?? []
            })
        })
        save.entryId = page.id
        await checkpoint?.()
        for (const children of batches.slice(1))
            await this.request(`blocks/${page.id}/children`, { method: 'PATCH', body: JSON.stringify({ children }) })
        return {
            id: page.id,
            url: page.url,
            title: save.title,
            date: save.createdAt,
            body: save.body,
            refreshedAt: new Date().toISOString()
        }
    }
    async reconcile(save: State['saves'][number], checkpoint?: () => void | Promise<void>): Promise<Entry | undefined> {
        if (save.updateExisting) return this.update(save, checkpoint)
        const pages = save.entryId
            ? [await this.request<Page>(`pages/${save.entryId}`)]
            : await this.pages(save.destination)
        const candidates: { page: Page; blocks: NotionBlock[] }[] = []
        for (const page of pages) {
            const blocks = await this.blocks(page.id)
            const legacyMarker = blocks.some(
                (block) => block.type === 'paragraph' && JSON.stringify(block.paragraph).includes(save.marker)
            )
            const title = Object.values(page.properties)
                .find((property) => property.title)
                ?.title?.map((text) => text.plain_text ?? text.text?.content ?? '')
                .join('')
            const elapsed = Date.parse(page.created_time) - Date.parse(save.createdAt)
            const body = fromNotion(blocks)
            // New pages contain only user writing. Without a checkpointed ID, adopt
            // only one complete matching page created during this publish attempt.
            if (
                save.entryId ||
                legacyMarker ||
                (title === save.title &&
                    elapsed >= -1000 &&
                    elapsed <= 120000 &&
                    JSON.stringify(toNotion(body)) === JSON.stringify(toNotion(save.body)))
            )
                candidates.push({ page, blocks })
        }
        if (candidates.length > 1)
            throw new Error(
                'More than one matching Notion page was found. Inspect them in Notion before retrying verification.'
            )
        for (const { page, blocks } of candidates) {
            const body = fromNotion(blocks)
            const actual = toNotion(body)
            const expected = toNotion(save.body)
            if (JSON.stringify(actual) === JSON.stringify(expected)) return { ...(await this.entry(page)), body }
            if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length)))
                throw new Error(
                    'The possible saved page differs from the draft. Coverage remains pending; inspect it in Notion.'
                )
            // A checkpointed ID (or legacy marker) identifies a partial page safely.
            const sending = toNotion(save.body, await this.uploadImages(save, checkpoint))
            for (const children of this.batches(sending.slice(actual.length)))
                await this.request(`blocks/${page.id}/children`, {
                    method: 'PATCH',
                    body: JSON.stringify({ children })
                })
            return { ...(await this.entry(page)), body: save.body }
        }
        return undefined
    }
    private async update(save: State['saves'][number], checkpoint?: () => void | Promise<void>): Promise<Entry> {
        const expected = toNotion(save.body)
        this.batches(expected)
        const sending = toNotion(save.body, await this.uploadImages(save, checkpoint))
        const blocks = await this.blocks(save.entryId!)
        if (!save.replacedBlockIds) {
            if (blocks.some((block) => !block.id))
                throw new Error('Notion did not return block IDs. Retry verification.')
            save.replacedBlockIds = blocks.map((block) => block.id!)
            // Persist the replacement boundary before mutating remote content, so a
            // lost response or restart cannot cause newly appended writing to be deleted.
            await checkpoint?.()
        }
        const oldIds = new Set(save.replacedBlockIds)
        const remaining = blocks.filter((block) => !oldIds.has(block.id!))
        const actual = remaining.length ? toNotion(fromNotion(remaining)) : []
        if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length)))
            throw new Error('The Notion page changed during publishing. Inspect it in Notion before verifying again.')
        const properties = {
            [save.destination.kind === 'page' ? 'title' : save.destination.titleProperty]: {
                title: [{ text: { content: save.title } }]
            }
        }
        const page = await this.request<Page>(`pages/${save.entryId}`, {
            method: 'PATCH',
            body: JSON.stringify({ properties })
        })
        for (const block of blocks.filter((block) => oldIds.has(block.id!)))
            await this.request(`blocks/${block.id}`, { method: 'DELETE' })
        for (const children of this.batches(sending.slice(actual.length)))
            await this.request(`blocks/${save.entryId}/children`, {
                method: 'PATCH',
                body: JSON.stringify({ children })
            })
        return {
            id: page.id,
            url: page.url,
            title: save.title,
            date: page.created_time,
            body: save.body,
            refreshedAt: new Date().toISOString()
        }
    }
    private async uploadImages(
        save: State['saves'][number],
        checkpoint?: () => void | Promise<void>
    ): Promise<Record<string, string>> {
        const uploads: Record<string, string> = {}
        try {
            for (const id of imageIds(save.body)) {
                const image = this.images?.image(id)
                if (!image)
                    throw new HttpError(400, 'A journal image is missing. Restore it from a backup before publishing.')
                const existing = save.imageUploads?.[id]
                if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now() + 60_000)) {
                    try {
                        const current = await this.request<{ status: string; expiry_time: string | null }>(
                            `file_uploads/${existing.id}`
                        )
                        if (current.status === 'uploaded') {
                            uploads[id] = existing.id
                            continue
                        }
                    } catch (error) {
                        if (!(error instanceof HttpError && error.status === 404)) throw error
                    }
                }
                const created = await this.request<{ id: string }>('file_uploads', {
                    method: 'POST',
                    body: JSON.stringify({
                        mode: 'single_part',
                        filename: `${id}.${imageExtension(image.mime)}`,
                        content_type: image.mime
                    })
                })
                const form = new FormData()
                form.append(
                    'file',
                    new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
                    `${id}.${imageExtension(image.mime)}`
                )
                const uploaded = await this.request<{ status: string; expiry_time: string | null }>(
                    `file_uploads/${created.id}/send`,
                    { method: 'POST', body: form }
                )
                if (uploaded.status !== 'uploaded')
                    throw new Error('Notion has not finished uploading an image. Try publishing again.')
                save.imageUploads ??= {}
                save.imageUploads[id] = { id: created.id, expiresAt: uploaded.expiry_time }
                await checkpoint?.()
                uploads[id] = created.id
            }
        } catch (error) {
            if (error instanceof HttpError && error.status >= 400 && error.status < 500) throw error
            throw new HttpError(
                400,
                'Could not upload images to Notion. Your page has not been changed. Try publishing again.'
            )
        }
        return uploads
    }
    private batches(blocks: NotionBlock[]): NotionBlock[][] {
        const batches: NotionBlock[][] = []
        let batch: NotionBlock[] = []
        let bytes = 0
        for (const block of blocks) {
            const size = Buffer.byteLength(JSON.stringify(block))
            if (size > 450000)
                throw new HttpError(
                    400,
                    'A journal block exceeds the Notion payload limit; split this block before publishing'
                )
            if (batch.length >= 100 || bytes + size > 450000) {
                batches.push(batch)
                batch = []
                bytes = 0
            }
            batch.push(block)
            bytes += size
        }
        if (batch.length) batches.push(batch)
        return batches
    }
}
