import type { NotionPage, NotionDiscoveryProgress } from '../shared/model'
import { HttpError } from './http'
import { setTimeout as delay } from 'node:timers/promises'

interface Parent {
    page_id?: string
    block_id?: string
    data_source_id?: string
    database_id?: string
}
type RichText = { plain_text?: string; text?: { content: string } }[]
interface Entity {
    id: string
    type?: string
    has_children?: boolean
    archived?: boolean
    in_trash?: boolean
    data_sources?: { id: string }[]
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

/** Search supplies shared roots; child lists and data-source queries enumerate descendants independently of indexing. */
export async function discoverNotionPages(
    request: <T>(path: string, init?: RequestInit) => Promise<T>,
    progress: (update: NotionDiscoveryProgress) => void = () => {
        /* Discovery also serves non-UI callers. */
    },
    signal?: AbortSignal
): Promise<NotionPage[]> {
    const pages = new Map<string, Entity>()
    // Retry the failed read in place: restarting a large tree spends the same
    // request budget again and can never reach the remaining descendants.
    async function limited<T>(path: string, init?: RequestInit): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            signal?.throwIfAborted()
            try {
                return await request<T>(path, init)
            } catch (error) {
                if (!(error instanceof HttpError) || error.status !== 429 || !error.retryAt || attempt >= 3) throw error
                await delay(Math.max(0, error.retryAt - Date.now()), undefined, { signal })
            }
        }
    }
    async function accessible<T>(path: string, init?: RequestInit): Promise<T | undefined> {
        try {
            return await limited<T>(path, init)
        } catch (error) {
            if (error instanceof HttpError && (error.status === 403 || error.status === 404) && !error.retryAt)
                return undefined
            throw error
        }
    }
    // Reuse metadata for descendant reads and later ancestry resolution.
    const reads = new Map<string, Promise<Entity | undefined>>()
    function read(path: string) {
        let pending = reads.get(path)
        if (!pending) {
            pending = accessible<Entity>(path)
            reads.set(path, pending)
        }
        return pending
    }
    let cursor: string | null | undefined
    progress({ stage: 'discovering', found: 0 })
    do {
        const result = await limited<List>('search', {
            method: 'POST',
            body: JSON.stringify({
                filter: { value: 'page', property: 'object' },
                page_size: 100,
                ...(cursor ? { start_cursor: cursor } : {})
            })
        })
        for (const page of result.results) pages.set(page.id, page)
        progress({ stage: 'discovering', found: pages.size })
        cursor = result.has_more ? result.next_cursor : undefined
    } while (cursor)

    const queue: { kind: 'blocks' | 'databases' | 'data_sources'; id: string }[] = [...pages.keys()].map((id) => ({
        kind: 'blocks',
        id
    }))
    const visited = new Set<string>()
    const addPage = (page: Entity) => {
        if (page.archived || page.in_trash || pages.has(page.id)) return
        pages.set(page.id, page)
        queue.push({ kind: 'blocks', id: page.id })
        progress({ stage: 'discovering', found: pages.size })
    }
    for (const { kind, id } of queue) {
        const key = `${kind}/${id}`
        if (visited.has(key)) continue
        visited.add(key)
        // Fail rather than mark a truncated discovery as complete.
        if (visited.size > 100000)
            throw new Error('Notion page discovery is too large. Choose a smaller shared parent and try again.')
        if (kind === 'databases') {
            const database = await read(`databases/${encodeURIComponent(id)}`)
            for (const source of database?.data_sources ?? []) queue.push({ kind: 'data_sources', id: source.id })
            continue
        }
        let next: string | undefined
        const cursors = new Set<string>()
        do {
            const result = await accessible<List>(
                kind === 'blocks'
                    ? `blocks/${encodeURIComponent(id)}/children?page_size=100${next ? `&start_cursor=${encodeURIComponent(next)}` : ''}`
                    : `data_sources/${encodeURIComponent(id)}/query`,
                kind === 'data_sources'
                    ? {
                          method: 'POST',
                          body: JSON.stringify({ page_size: 100, ...(next ? { start_cursor: next } : {}) })
                      }
                    : undefined
            )
            if (!result) break
            for (const entity of result.results) {
                if (entity.archived || entity.in_trash) continue
                if (kind === 'data_sources') addPage(entity)
                else if (entity.type === 'child_page') {
                    if (!pages.has(entity.id)) {
                        const page = await read(`pages/${encodeURIComponent(entity.id)}`)
                        if (page) addPage(page)
                    }
                } else if (entity.type === 'child_database') queue.push({ kind: 'databases', id: entity.id })
                else if (entity.has_children) queue.push({ kind: 'blocks', id: entity.id })
            }
            if (result.has_more && (!result.next_cursor || cursors.has(result.next_cursor)))
                throw new Error('Notion page discovery could not finish. Try again.')
            next = result.has_more ? (result.next_cursor ?? undefined) : undefined
            if (next) cursors.add(next)
        } while (next)
    }

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
    let completed = 0
    progress({ stage: 'grouping', completed, total: pages.size })
    for (const page of pages.values()) {
        nodes.get(page.id)!.parentId = await parentId(page.parent)
        progress({ stage: 'grouping', completed: ++completed, total: pages.size })
    }
    return [...nodes.values()]
}
