import { useMemo, useState } from 'react'
import { Database, FileText, Plus } from 'lucide-react'
import type { NotionPage } from '../shared/model'
import { Combobox, type ComboboxTreeContext } from './components/arc/combobox/combobox'
import { TreeView, type TreeNode } from './components/arc/tree-view/tree-view'
import { Button } from './components/arc/button/button'
import { notionPageTree, pageAncestors, type PageNode } from './notion-page-tree'

export function NotionPageIcon({ icon }: { icon?: string }) {
    const image = icon?.startsWith('https://') || icon?.startsWith('data:image/')
    return (
        <span className="notion-page-icon" aria-hidden="true">
            {image ? (
                <>
                    <FileText size={16} strokeWidth={1.5} />
                    <img
                        src={icon}
                        alt=""
                        onError={(event) => {
                            event.currentTarget.hidden = true
                        }}
                    />
                </>
            ) : (
                icon || <FileText size={16} strokeWidth={1.5} />
            )}
        </span>
    )
}

function PageTree({ pages, context }: { pages: NotionPage[]; context: ComboboxTreeContext }) {
    const [expanded, setExpanded] = useState(() => pageAncestors(pages, context.selected))
    const nodes = useMemo(() => {
        const convert = (items: PageNode[]): TreeNode[] =>
            items.map((node) => ({
                id: node.id,
                label: node.label,
                title: node.label,
                icon:
                    node.selectable || node.icon ? (
                        <NotionPageIcon icon={node.icon} />
                    ) : (
                        <Database size={16} strokeWidth={1.5} aria-hidden="true" />
                    ),
                selectable: node.selectable,
                children: node.children ? convert(node.children) : undefined
            }))
        return convert(notionPageTree(pages, context.query))
    }, [pages, context.query])
    const searchExpanded = useMemo(() => {
        const ids: string[] = []
        const visit = (items: TreeNode[]) =>
            items.forEach((node) => {
                if (node.children) {
                    ids.push(node.id)
                    visit(node.children)
                }
            })
        visit(nodes)
        return ids
    }, [nodes])
    const query = context.query.trim()
    const [search, setSearch] = useState({ query, expanded: searchExpanded })
    // Reset only the search tree when its query changes; preserve ordinary browsing.
    if (search.query !== query) setSearch({ query, expanded: searchExpanded })
    return (
        <>
            <Button size="sm" variant="ghost" className="notion-create-page" onClick={() => context.select('new')}>
                <Plus size={16} strokeWidth={1.5} />
                Create a new page
            </Button>
            <TreeView
                id={context.id}
                aria-label="Notion pages"
                nodes={nodes}
                variant="plain"
                wrapLabels
                animateExpansion={false}
                selectBranches
                selectedId={context.selected || null}
                expandedIds={query ? (search.query === query ? search.expanded : searchExpanded) : expanded}
                onExpandedChange={(ids) => (query ? setSearch({ query, expanded: ids }) : setExpanded(ids))}
                onEscape={context.close}
                onSelect={(node) => context.select(node.id)}
            />
            {!nodes.length && (
                <p className="notion-picker-empty" role="status">
                    {context.query.trim() ? 'No matching pages' : 'No pages shared'}
                </p>
            )}
        </>
    )
}

export function NotionPagePicker({
    pages,
    value,
    onChange
}: {
    pages: NotionPage[]
    value: string
    onChange: (id: string) => void
}) {
    return (
        <Combobox
            label="Journal page"
            hideLabel
            variant="inline"
            value={value}
            placeholder="Select a page"
            title={pages.find((page) => page.id === value)?.title}
            options={[
                { value: 'new', label: 'Create a new page' },
                ...pages.filter((page) => page.kind === 'page').map((page) => ({ value: page.id, label: page.title }))
            ]}
            onValueChange={onChange}
            renderTree={(context) => <PageTree pages={pages} context={context} />}
        />
    )
}
