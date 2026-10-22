import type { NotionPage } from '../shared/model'

export interface PageNode {
    id: string
    label: string
    icon?: string
    children?: PageNode[]
}

function parents(pages: NotionPage[]) {
    const byId = new Map(pages.map((page) => [page.id, page]))
    const result = new Map<string, string>()
    for (const page of byId.values()) {
        const seen = new Set([page.id])
        let parent = page.parentId
        let cyclic = false
        while (parent && byId.has(parent)) {
            if (seen.has(parent)) {
                cyclic = true
                break
            }
            seen.add(parent)
            parent = byId.get(parent)?.parentId
        }
        if (!cyclic && page.parentId && byId.has(page.parentId)) result.set(page.id, page.parentId)
    }
    return result
}

export function pageAncestors(pages: NotionPage[], selected?: string): string[] {
    const parentIds = parents(pages)
    const result: string[] = []
    let id = selected ? parentIds.get(selected) : undefined
    while (id) {
        result.unshift(id)
        id = parentIds.get(id)
    }
    return result
}

/** Names are presentation; stable page identities alone determine the hierarchy. */
export function notionPageTree(pages: NotionPage[], query = ''): PageNode[] {
    const parentIds = parents(pages)
    const nodes = new Map<string, PageNode>(
        pages.map((page) => [page.id, { id: page.id, label: page.title, icon: page.icon }])
    )
    const roots: PageNode[] = []
    for (const node of nodes.values()) {
        const parentId = parentIds.get(node.id)
        const parent = parentId ? nodes.get(parentId) : undefined
        if (parent) (parent.children ??= []).push(node)
        else roots.push(node)
    }
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return roots
    const filter = (items: PageNode[]): PageNode[] =>
        items.flatMap((node) => {
            if (node.label.toLocaleLowerCase().includes(needle)) return [node]
            const children = node.children ? filter(node.children) : []
            return children.length ? [{ ...node, children }] : []
        })
    return filter(roots)
}
