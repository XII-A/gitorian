import { ConnectionError } from './connection-errors'
import { DurabilityError } from './durability-error'
import type { NotionRequestFailure } from './notion-request'
import { makeNotionRequests } from './notion-request'
import { fromNotion } from '../shared/notion-format'
import type { NotionBlock } from '../shared/notion-format'
import type { Destination, Entry, ConnectionProfile, NotionDiscoveryProgress } from '../shared/model'
import { Http } from './http'
import { Context, Effect, Layer } from 'effect'
import { HttpError, TransportError } from './http'
import type { JournalDatabase } from './journal-database'
import { downloadImage, UnsupportedImageError } from './images'
import type { JournalSetup } from './notion-connection'
import sharp from 'sharp'
import { discoverNotionPages, type NotionPageRead } from './notion-discovery'
import { retryNotionRateLimit, NotionReadCancelled } from './notion-rate-limit'
export interface Page {
    id: string
    url: string
    created_time: string
    properties: Record<
        string,
        {
            title?: {
                plain_text?: string
                text?: {
                    content: string
                }
            }[]
        }
    >
    icon?: {
        type: string
        emoji?: string
        external?: {
            url: string
        }
        file?: {
            url: string
        }
        custom_emoji?: {
            url: string
        }
    } | null
    parent?: {
        page_id?: string
    }
}
interface List<T> {
    results: T[]
    has_more: boolean
    next_cursor: string | null
}
const pageIcon = (page: Page) => {
    if (page.icon?.type === 'emoji') return page.icon.emoji
    const url = page.icon?.external?.url ?? page.icon?.file?.url ?? page.icon?.custom_emoji?.url
    return url?.startsWith('https://') ? url : undefined
}
export class NotionFailure extends Error {
    readonly _tag = 'NotionFailure'
}
export type NotionError = NotionFailure | NotionRequestFailure | NotionReadCancelled
export function isNotionError(error: unknown): error is NotionError {
    return (
        error instanceof NotionFailure ||
        error instanceof HttpError ||
        error instanceof TransportError ||
        error instanceof ConnectionError ||
        error instanceof DurabilityError ||
        error instanceof NotionReadCancelled
    )
}
export function toNotionError(error: unknown): NotionError {
    return isNotionError(error)
        ? error
        : new NotionFailure(error instanceof Error ? error.message : String(error), { cause: error })
}
export type Notion = ReturnType<typeof makeNotion>
export const Notion = Context.GenericTag<Notion>('gitorian/Notion')
type NotionToken = (refresh?: boolean, rejected?: string) => Effect.Effect<string, Error>
export const NotionLive = (
    getToken: NotionToken,
    images?: Pick<JournalDatabase, 'image' | 'importImage'>,
    imageDownload = downloadImage
) =>
    Layer.effect(
        Notion,
        Effect.map(Http, (http) => makeNotion(http, getToken, images, imageDownload))
    )
export function makeNotion(
    http: Http,
    getToken: NotionToken,
    images?: Pick<JournalDatabase, 'image' | 'importImage'>,
    imageDownload = downloadImage
) {
    const removeSetupMarker = (pageId: string, setupId: string) =>
        Effect.gen(function* () {
            let cursor: string | null = null
            do {
                const children: List<{
                    id: string
                    type: string
                    paragraph?: { rich_text: { plain_text?: string; text?: { content: string } }[] }
                }> = yield* setupRequest<
                    List<{
                        id: string
                        type: string
                        paragraph?: { rich_text: { plain_text?: string; text?: { content: string } }[] }
                    }>
                >(
                    `blocks/${encodeURIComponent(pageId)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`
                )
                for (const block of children.results) {
                    if (
                        block.type === 'paragraph' &&
                        block.paragraph?.rich_text
                            .map((text) => text.plain_text ?? text.text?.content ?? '')
                            .join('') === `gitorian setup: ${setupId}`
                    ) {
                        yield* setupRequest(`blocks/${encodeURIComponent(block.id)}`, { method: 'DELETE' })
                    }
                }
                cursor = children.has_more ? children.next_cursor : null
            } while (cursor)
        })
    const prepareJournal = (
        setup: JournalSetup,
        checkpoint: (pageId?: string) => void,
        existing?: Destination
    ): Effect.Effect<Destination, Error> =>
        Effect.gen(function* () {
            const destination = (id: string): Destination => ({
                kind: 'page',
                id,
                titleProperty: 'Name',
                dateProperty: ''
            })
            if (existing?.id) {
                if (existing.id === setup.pageId) {
                    yield* removeSetupMarker(setup.pageId, setup.id)
                    return existing
                }
                yield* verifyDestination(existing)
                yield* Effect.try({
                    try: () => checkpoint(existing.id),
                    catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
                })
                return existing
            }
            const title = setup.title ?? 'Weekly Journal'
            if (setup.pageId) {
                yield* removeSetupMarker(setup.pageId, setup.id)
                return { ...destination(setup.pageId), ...(setup.title ? { title } : {}) }
            }
            const marker = `gitorian setup: ${setup.id}`
            if (setup.started) {
                const matches: string[] = []
                let cursor: string | null = null
                do {
                    const pages: List<Page> = yield* setupRequest<List<Page>>('search', {
                        method: 'POST',
                        body: JSON.stringify({
                            query: title,
                            filter: { value: 'page', property: 'object' },
                            ...(cursor ? { start_cursor: cursor } : {})
                        })
                    })
                    for (const page of pages.results) {
                        const pageTitle = Object.values(page.properties)
                            .find((property) => property.title)
                            ?.title?.map((text) => text.plain_text ?? text.text?.content ?? '')
                            .join('')
                        if (pageTitle !== title) continue
                        const children = yield* setupRequest<{
                            results: {
                                type: string
                                paragraph?: {
                                    rich_text: {
                                        plain_text?: string
                                        text?: {
                                            content: string
                                        }
                                    }[]
                                }
                            }[]
                        }>(`blocks/${page.id}/children?page_size=100`)
                        if (
                            children.results.some(
                                (block) =>
                                    block.type === 'paragraph' &&
                                    block.paragraph?.rich_text
                                        .map((text) => text.plain_text ?? text.text?.content ?? '')
                                        .join('') === marker
                            )
                        )
                            matches.push(page.id)
                    }
                    cursor = pages.has_more ? pages.next_cursor : null
                } while (cursor)
                if (matches.length !== 1)
                    return yield* Effect.fail(
                        new NotionFailure('Could not confirm page creation. Retry or choose an existing page.')
                    )
                yield* Effect.try({
                    try: () => checkpoint(matches[0]),
                    catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
                })
                yield* removeSetupMarker(matches[0], setup.id)
                return { ...destination(matches[0]), ...(setup.title ? { title } : {}) }
            }
            yield* Effect.try({
                try: () => checkpoint(),
                catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
            })
            const page = yield* setupRequest<{
                id: string
                url?: string
            }>('pages', {
                method: 'POST',
                headers: { 'Notion-Version': '2026-03-11' },
                body: JSON.stringify({
                    parent: { type: 'workspace', workspace: true },
                    properties: { title: { title: [{ text: { content: title } }] } },
                    children: [
                        {
                            object: 'block',
                            type: 'paragraph',
                            paragraph: { rich_text: [{ type: 'text', text: { content: marker } }] }
                        }
                    ]
                })
            })
            if (typeof page.id !== 'string' || !page.id)
                return yield* Effect.fail(
                    new NotionFailure('Journal setup could not be confirmed. Connect again to check the saved journal.')
                )
            yield* Effect.try({
                try: () => checkpoint(page.id),
                catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
            })
            yield* removeSetupMarker(page.id, setup.id)
            return {
                ...destination(page.id),
                ...(setup.title ? { title, icon: '' } : {}),
                ...(page.url ? { url: page.url } : {})
            }
        })
    const describeDestination = (destination: Destination): Effect.Effect<Destination, Error> =>
        Effect.gen(function* () {
            if (destination.kind !== 'page') return destination
            const page = yield* request<Page>(`pages/${encodeURIComponent(destination.id)}`)
            const title = Object.values(page.properties ?? {})
                .find((property) => property.title)
                ?.title?.map((text) => text.plain_text ?? text.text?.content ?? '')
                .join('')
                .trim()
            return {
                ...destination,
                title: title || destination.title || 'Untitled',
                url: page.url ?? destination.url,
                icon:
                    page.icon === undefined
                        ? (destination.icon ?? '')
                        : ((yield* destinationIcon(pageIcon(page))) ?? '')
            }
        })
    const profile = (): Effect.Effect<ConnectionProfile, Error> =>
        Effect.gen(function* () {
            const user = yield* request<{
                name?: string | null
                avatar_url?: string | null
            }>('users/me')
            return {
                name: user.name?.trim() || 'Notion integration',
                avatarUrl: user.avatar_url?.startsWith('https://') ? user.avatar_url : undefined
            }
        })
    const refreshEntry = (id: string): Effect.Effect<Entry, Error> =>
        Effect.gen(function* () {
            return yield* readEntry(yield* request<Page>(`pages/${encodeURIComponent(id)}`))
        })
    const loadPages = (destination: Destination): Effect.Effect<Page[], Error> =>
        Effect.gen(function* () {
            if (destination.kind === 'database') {
                const pages: Page[] = []
                let cursor: string | null = null
                do {
                    const response: List<Page> = yield* request<List<Page>>(
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
            const blocks = yield* loadBlocks(destination.id)
            const ids: string[] = []
            const visit = (items: NotionBlock[]) => {
                for (const block of items) {
                    if (block.type === 'child_page' && block.id) ids.push(block.id)
                    visit(block.children ?? [])
                }
            }
            visit(blocks)
            const pages: Page[] = []
            for (const id of ids) pages.push(yield* request<Page>(`pages/${id}`))
            return pages
        })
    const readEntry = (page: Page): Effect.Effect<Entry, Error> =>
        Effect.gen(function* () {
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
                body: fromNotion(yield* loadBlocks(page.id)),
                refreshedAt: new Date().toISOString()
            }
        })
    const { request } = makeNotionRequests(http, getToken)
    const setupRequest = <T>(path: string, init?: RequestInit) => retryNotionRateLimit(request<T>(path, init))
    const accessiblePages = (
        progress?: (update: NotionDiscoveryProgress) => void,
        signal?: AbortSignal,
        options?: NotionPageRead
    ) =>
        discoverNotionPages(
            <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, ...(signal ? { signal } : {}) }),
            progress,
            signal,
            options
        )
    const destinationIcon = (icon?: string): Effect.Effect<string | undefined> => {
        if (!icon?.startsWith('https://')) return Effect.succeed(icon)
        return Effect.gen(function* () {
            const image = yield* Effect.tryPromise({ try: () => imageDownload(icon), catch: (error) => error })
            const bytes = yield* Effect.tryPromise({
                try: () => sharp(image.bytes).resize(32, 32, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(),
                catch: (error) => error
            })
            return 'data:image/webp;base64,' + bytes.toString('base64')
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    }
    const verifyDestination = (destination: Destination): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
            if (!destination.id.trim()) return yield* Effect.fail(new NotionFailure('Enter a destination ID first.'))
            const kind = destination.kind === 'page' ? 'Page' : 'Database data source'
            yield* setupRequest(
                (destination.kind === 'page' ? 'pages' : 'data_sources') +
                    '/' +
                    encodeURIComponent(destination.id.trim())
            ).pipe(
                Effect.mapError((error) => {
                    if (error instanceof HttpError) {
                        if (error.status === 401)
                            return new NotionFailure('Reconnect Notion with a valid integration token and try again.')
                        if (error.status === 403 || error.status === 404)
                            return new NotionFailure(
                                kind + ' could not be reached. Check the ID and share it with your Notion integration.'
                            )
                        if (error.status === 400)
                            return new NotionFailure(
                                'Check the ' +
                                    (destination.kind === 'page' ? 'page' : 'data source') +
                                    ' ID and try again.'
                            )
                    }
                    return new NotionFailure('Could not test the destination. Check your connection and try again.')
                })
            )
        })
    const loadBlocks = (id: string): Effect.Effect<NotionBlock[], Error> =>
        Effect.gen(function* () {
            const blocks: NotionBlock[] = []
            let cursor: string | null = null
            do {
                const response: List<NotionBlock> = yield* request<List<NotionBlock>>(
                    'blocks/' +
                        encodeURIComponent(id) +
                        '/children?page_size=100' +
                        (cursor ? '&start_cursor=' + cursor : '')
                )
                for (const block of response.results) {
                    if (block.type === 'image' && images) {
                        const image = block.image as {
                            type: string
                            file?: {
                                url: string
                            }
                            external?: {
                                url: string
                            }
                        }
                        const url = image.type === 'file' ? image.file?.url : image.external?.url
                        if (!url)
                            return yield* Effect.fail(
                                new NotionFailure('Could not retrieve the Notion image. Refresh again.')
                            )
                        yield* Effect.gen(function* () {
                            const downloaded = yield* Effect.tryPromise({
                                try: () => imageDownload(url),
                                catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
                            })
                            block.managedAssetId = yield* Effect.tryPromise({
                                try: () => images.importImage(downloaded.bytes),
                                catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
                            })
                        }).pipe(
                            Effect.catchAll((error) =>
                                error instanceof UnsupportedImageError ? Effect.void : Effect.fail(error)
                            )
                        )
                    }
                    if (
                        block.has_children &&
                        block.id &&
                        block.type !== 'child_page' &&
                        block.type !== 'child_database'
                    )
                        block.children = yield* loadBlocks(block.id)
                    blocks.push(block)
                }
                cursor = response.has_more ? response.next_cursor : null
            } while (cursor)
            return blocks
        })
    return {
        prepareJournal: Effect.fn('Notion.prepareJournal')(prepareJournal, Effect.mapError(toNotionError)),
        accessiblePages: Effect.fn('Notion.accessiblePages')(accessiblePages, Effect.mapError(toNotionError)),
        destinationIcon: Effect.fn('Notion.destinationIcon')(destinationIcon, Effect.mapError(toNotionError)),
        describeDestination: Effect.fn('Notion.describeDestination')(
            describeDestination,
            Effect.mapError(toNotionError)
        ),
        profile: Effect.fn('Notion.profile')(profile, Effect.mapError(toNotionError)),
        verifyDestination: Effect.fn('Notion.verifyDestination')(verifyDestination, Effect.mapError(toNotionError)),
        refreshEntry: Effect.fn('Notion.refreshEntry')(refreshEntry, Effect.mapError(toNotionError)),
        blocks: Effect.fn('Notion.blocks')(loadBlocks, Effect.mapError(toNotionError)),
        pages: Effect.fn('Notion.pages')(loadPages, Effect.mapError(toNotionError)),
        entry: Effect.fn('Notion.entry')(readEntry, Effect.mapError(toNotionError))
    }
}
