import type { NotionPage } from '../shared/model'
import { HttpError } from './http'

interface Parent {
    page_id?: string
    block_id?: string
    data_source_id?: string
    database_id?: string
}
type RichText = { plain_text?: string; text?: { content: string } }[]
interface Entity {
    id: string
    url?: string
    parent?: Parent
    title?: RichText
    properties?: Record<string, { title?: RichText }>
    icon?: {
        type: string
        emoji?: string
        external?: { url: string }
        file?: { url: string }
        custom_emoji?: { url: string }
    } | null
}
interface List {
    results: Entity[]
    has_more: boolean
    next_cursor?: string | null
}
const text = (value?: RichText) =>
    value
        ?.map((part) => part.plain_text ?? part.text?.content ?? '')
        .join('')
        .trim()
const icon = (entity: Entity) => {
    if (entity.icon?.type === 'emoji') return entity.icon.emoji
    const url = entity.icon?.external?.url ?? entity.icon?.file?.url ?? entity.icon?.custom_emoji?.url
    return url?.startsWith('https://') ? url : undefined
}

/** Discovers selectable pages and the named source groups that own them. Blocks and databases only resolve ancestry. */
export async function discoverNotionPages(
    request: <T>(path: string, init?: RequestInit) => Promise<T>
): Promise<NotionPage[]> {
    const pages = new Map<string, Entity>()
    let cursor: string | null | undefined
    do {
        const result = await request<List>('search', {
            method: 'POST',
            body: JSON.stringify({
                filter: { value: 'page', property: 'object' },
                page_size: 100,
                ...(cursor ? { start_cursor: cursor } : {})
            })
        })
        for (const page of result.results) pages.set(page.id, page)
        cursor = result.has_more ? result.next_cursor : undefined
    } while (cursor)

    const nodes = new Map<string, NotionPage>(
        [...pages.values()].map((page) => [
            page.id,
            {
                kind: 'page',
                id: page.id,
                url: page.url ?? '',
                icon: icon(page),
                title:
                    text(Object.values(page.properties ?? {}).find((property) => property.title)?.title) || 'Untitled'
            }
        ])
    )
    // Cache raw metadata, not recursive resolutions: a malformed cycle must never await itself.
    const reads = new Map<string, Promise<Entity | undefined>>()
    function read(path: string) {
        let pending = reads.get(path)
        if (!pending) {
            pending = request<Entity>(path).catch((error: unknown) => {
                if (error instanceof HttpError && (error.status === 403 || error.status === 404) && !error.retryAt)
                    return undefined
                throw error
            })
            reads.set(path, pending)
        }
        return pending
    }
    async function parentId(parent?: Parent, seen = new Set<string>()): Promise<string | undefined> {
        if (!parent || seen.size >= 32) return undefined
        if (parent.page_id) return pages.has(parent.page_id) ? parent.page_id : undefined
        const path = parent.block_id
            ? `blocks/${encodeURIComponent(parent.block_id)}`
            : parent.data_source_id
              ? `data_sources/${encodeURIComponent(parent.data_source_id)}`
              : parent.database_id
                ? `databases/${encodeURIComponent(parent.database_id)}`
                : undefined
        if (!path || seen.has(path)) return undefined
        seen.add(path)
        const entity = await read(path)
        if (!entity) return undefined
        if (parent.data_source_id) {
            const id = parent.data_source_id
            if (nodes.has(id)) return id
            const group: NotionPage = {
                kind: 'data_source',
                id,
                title: text(entity.title) || 'Untitled database',
                url: entity.url ?? '',
                icon: icon(entity)
            }
            nodes.set(id, group)
            group.parentId = await parentId(entity.parent, seen)
            if (!text(entity.title) && entity.parent?.database_id) {
                const database = await read(`databases/${encodeURIComponent(entity.parent.database_id)}`)
                group.title = text(database?.title) || group.title
                group.icon ??= database ? icon(database) : undefined
            }
            return id
        }
        return parentId(entity.parent, seen)
    }
    for (const page of pages.values()) nodes.get(page.id)!.parentId = await parentId(page.parent)
    return [...nodes.values()]
}
