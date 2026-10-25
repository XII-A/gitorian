import type { NotionPage, NotionDiscoveryProgress } from '../shared/model'
import { HttpError } from './http'
import { retryNotionRateLimit } from './notion-rate-limit'

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

export interface NotionPageRead {
    query?: string
    parent?: NotionPage
}

/** Search reads the index; expansion reads one page's contents and stops at child pages. */
export async function discoverNotionPages(
    request: <T>(path: string, init?: RequestInit) => Promise<T>,
    progress: (update: NotionDiscoveryProgress) => void = () => {
        /* Discovery also serves non-UI callers. */
    },
    signal?: AbortSignal,
    options: NotionPageRead = {}
): Promise<NotionPage[]> {
    const pages = new Map<string, Entity>()
    const groups = new Map<string, Entity>()
    // Retry the failed read in place: restarting a large tree spends the same
    // request budget again and can never reach the remaining descendants.
    function limited<T>(path: string, init?: RequestInit): Promise<T> {
        return retryNotionRateLimit(
            () => request<T>(path, init),
            signal,
            (retryAt) => {
                progress({ stage: 'waiting', found: pages.size, retryAt })
            }
        )
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
    const queue: { kind: 'blocks' | 'databases' | 'data_sources'; id: string }[] = []
    const parent = options.parent
    if (parent) {
        const entity: Entity = {
            id: parent.id,
            properties: { Name: { title: [{ plain_text: parent.title }] } },
            title: [{ plain_text: parent.title }],
            url: parent.url
        }
        if (parent.kind === 'page') pages.set(parent.id, entity)
        else groups.set(parent.id, entity)
        queue.push({ kind: parent.kind === 'page' ? 'blocks' : 'data_sources', id: parent.id })
    } else {
        const query = options.query?.trim()
        let pageId: string | undefined
        if (query) {
            try {
                const url = new URL(query)
                if (url.protocol === 'https:' && /(^|\.)notion\.(so|site)$/.test(url.hostname)) {
                    const match =
                        /(?:^|[-/])([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(
                            url.pathname
                        )
                    if (match) {
                        const compact = match[1].replaceAll('-', '')
                        pageId = `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
                    }
                }
            } catch {
                /* Ordinary title queries are not URLs. */
            }
        }
        progress({ stage: 'discovering', found: 0 })
        if (pageId) {
            const page = await read(`pages/${encodeURIComponent(pageId)}`)
            if (page && !page.archived && !page.in_trash) pages.set(page.id, page)
        } else {
            let cursor: string | null | undefined
            const cursors = new Set<string>()
            do {
                const result = await limited<List>('search', {
                    method: 'POST',
                    body: JSON.stringify({
                        filter: { value: 'page', property: 'object' },
                        page_size: 100,
                        ...(query ? { query } : {}),
                        ...(cursor ? { start_cursor: cursor } : {})
                    })
                })
                for (const page of result.results) if (!page.archived && !page.in_trash) pages.set(page.id, page)
                progress({ stage: 'discovering', found: pages.size })
                if (result.has_more && (!result.next_cursor || cursors.has(result.next_cursor)))
                    throw new Error('Notion page search could not finish. Try again.')
                cursor = result.has_more ? result.next_cursor : undefined
                if (cursor) cursors.add(cursor)
            } while (cursor)
        }
    }
    const visited = new Set<string>()
    const addPage = (page: Entity) => {
        if (page.archived || page.in_trash || pages.has(page.id)) return
        pages.set(page.id, page)
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
            for (const source of database?.data_sources ?? []) {
                const group = await read(`data_sources/${encodeURIComponent(source.id)}`)
                if (group) groups.set(group.id, group)
            }
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

    return grouped()

    async function grouped(): Promise<NotionPage[]> {
        const nodes = new Map<string, NotionPage>(
            [...pages.values(), ...groups.values()].map((page) => [
                page.id,
                {
                    kind: groups.has(page.id) ? 'data_source' : 'page',
                    id: page.id,
                    url: page.url ?? '',
                    icon: icon(page),
                    title:
                        text(Object.values(page.properties ?? {}).find((property) => property.title)?.title) ||
                        text(page.title) ||
                        'Untitled'
                }
            ])
        )
        // Cache raw metadata, not recursive resolutions: a malformed cycle must never await itself.
        async function parentId(parent?: Parent, seen = new Set<string>()): Promise<string | undefined> {
            if (!parent || seen.size >= 32) return undefined
            if (parent.page_id) {
                const id = parent.page_id
                if (nodes.has(id)) return id
                const key = `pages/${encodeURIComponent(id)}`
                if (seen.has(key)) return undefined
                seen.add(key)
                const ancestor = await read(key)
                if (!ancestor || ancestor.archived || ancestor.in_trash) return undefined
                pages.set(id, ancestor)
                const node: NotionPage = {
                    kind: 'page',
                    id,
                    title: text(Object.values(ancestor.properties ?? {}).find((p) => p.title)?.title) || 'Untitled',
                    url: ancestor.url ?? '',
                    icon: icon(ancestor)
                }
                nodes.set(id, node)
                node.parentId = await parentId(ancestor.parent, seen)
                return id
            }
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
        progress({ stage: 'grouping', completed, total: pages.size + groups.size })
        for (const page of [...pages.values(), ...groups.values()]) {
            nodes.get(page.id)!.parentId = await parentId(page.parent)
            progress({ stage: 'grouping', completed: ++completed, total: pages.size + groups.size })
        }
        return [...nodes.values()].map((node) => (options.parent?.id === node.id ? options.parent : node))
    }
}
