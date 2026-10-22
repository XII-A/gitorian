import { expect, it } from 'vitest'
import { notionPageTree, pageAncestors } from '../src/renderer/notion-page-tree'
import type { NotionPage } from '../src/shared/model'

const page = (id: string, title: string, parentId?: string): NotionPage => ({
    kind: 'page',
    id,
    title,
    parentId,
    url: `https://www.notion.so/${id}`
})

it('attaches later parents by identity without merging duplicate names or compacting selectable levels', () => {
    const pages = [
        page('leaf', 'Notes', 'child'),
        page('child', 'Notes', 'parent'),
        page('parent', 'Notes'),
        page('other', 'Notes')
    ]
    const tree = notionPageTree(pages)
    expect(tree.map((node) => node.id)).toEqual(['parent', 'other'])
    expect(tree[0].children?.[0].id).toBe('child')
    expect(tree[0].children?.[0].children?.[0].id).toBe('leaf')
    expect(pageAncestors(pages, 'leaf')).toEqual(['parent', 'child'])
})

it('keeps missing-parent and cyclic pages reachable without inventing page names', () => {
    const pages = [page('orphan', 'Orphan', 'missing'), page('a', 'First', 'b'), page('b', 'Second', 'a')]
    expect(
        notionPageTree(pages)
            .map((node) => node.label)
            .sort()
    ).toEqual(['First', 'Orphan', 'Second'])
    expect(pageAncestors(pages, 'orphan')).toEqual([])
})

it('searches names with ancestor context and never treats an internal ID as visible search text', () => {
    const pages = [
        page('internal-root', 'Personal'),
        page('internal-child', '日本語 notes', 'internal-root'),
        page('else', 'Work')
    ]
    const tree = notionPageTree(pages, '日本語')
    expect(tree.map((node) => node.label)).toEqual(['Personal'])
    expect(tree[0].children?.map((node) => node.label)).toEqual(['日本語 notes'])
    expect(notionPageTree(pages, 'internal-child')).toEqual([])
})
