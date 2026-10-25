import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, FileText, Plus } from 'lucide-react'
import type { NotionPage, NotionDiscoveryProgress } from '../shared/model'
import { Combobox, type ComboboxTreeContext } from './components/arc/combobox/combobox'
import { TreeView, type TreeNode } from './components/arc/tree-view/tree-view'
import { Button } from './components/arc/button/button'
import { notionPageTree, pageAncestors, type PageNode } from './notion-page-tree'
import { NotionDiscoveryStatus } from './NotionDiscoveryStatus'

export interface NotionPickerActivity {
    progress: NotionDiscoveryProgress
    error: boolean
}
interface DiscoveryProps {
    activity?: NotionPickerActivity
    branches: Record<string, NotionPickerActivity>
    loadedParents: string[]
    searchResults: string[]
    onExpand: (id: string) => void
    onRetry: () => void
    onQueryChange: (query: string) => void
}

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

function PageTree({
    pages,
    context,
    activity,
    branches,
    loadedParents,
    searchResults,
    onExpand,
    onRetry
}: { pages: NotionPage[]; context: ComboboxTreeContext } & Omit<DiscoveryProps, 'onQueryChange'>) {
    const initialized = useRef(false)
    useEffect(() => {
        if (initialized.current || !context.selected || !pages.some((page) => page.id === context.selected)) return
        initialized.current = true
        setExpanded((ids) => [...new Set([...ids, ...pageAncestors(pages, context.selected)])])
    }, [pages, context.selected])
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
                hasChildren: !loadedParents.includes(node.id) || !!node.children?.length,
                status: branches[node.id] ? (
                    branches[node.id].error ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Retry loading ${node.label}`}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                            }}
                            onClick={(event) => {
                                event.stopPropagation()
                                onExpand(node.id)
                            }}
                        >
                            Retry
                        </Button>
                    ) : (
                        <span role="status">
                            {branches[node.id].progress.stage === 'waiting' ? 'Waiting' : 'Loading'}
                        </span>
                    )
                ) : undefined,
                children: node.children ? convert(node.children) : undefined
            }))
        const linked = /^https:\/\//i.test(context.query.trim())
        return convert(
            notionPageTree(
                linked ? pages.filter((page) => searchResults.includes(page.id)) : pages,
                linked ? '' : context.query
            )
        )
    }, [pages, context.query, branches, loadedParents, searchResults, onExpand])
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
    const [search, setSearch] = useState<{ query: string; expanded: string[]; collapsed: string[] }>({
        query,
        expanded: [],
        collapsed: []
    })
    const expandedSearch = [...new Set([...searchExpanded, ...search.expanded])].filter(
        (id) => !search.collapsed.includes(id)
    )
    // Reset only the search tree when its query changes; preserve ordinary browsing.
    if (search.query !== query) setSearch({ query, expanded: [], collapsed: [] })
    return (
        <>
            <Button size="sm" variant="ghost" className="notion-create-page" onClick={() => context.select('new')}>
                <Plus size={16} strokeWidth={1.5} />
                Create a new page
            </Button>
            {activity && (
                <div className="notion-picker-status" role="status">
                    {activity.error ? (
                        <>
                            <span>Could not load pages.</span>
                            <Button variant="ghost" size="sm" onClick={onRetry}>
                                Retry search
                            </Button>
                        </>
                    ) : (
                        <NotionDiscoveryStatus progress={activity.progress} />
                    )}
                </div>
            )}
            <TreeView
                id={context.id}
                aria-label="Notion pages"
                nodes={nodes}
                variant="plain"
                wrapLabels
                animateExpansion={false}
                selectBranches
                selectedId={context.selected || null}
                expandedIds={query ? (search.query === query ? expandedSearch : searchExpanded) : expanded}
                onExpandedChange={(ids) => {
                    const previous = query ? expandedSearch : expanded
                    if (query)
                        setSearch({ query, expanded: ids, collapsed: searchExpanded.filter((id) => !ids.includes(id)) })
                    else setExpanded(ids)
                    for (const id of ids) if (!previous.includes(id) && !loadedParents.includes(id)) onExpand(id)
                }}
                onEscape={context.close}
                onSelect={(node) => context.select(node.id)}
            />
            {!nodes.length && !activity && (
                <p className="notion-picker-empty" role="status">
                    {context.query.trim()
                        ? 'No matching pages. Try a page link if it was just shared.'
                        : 'No pages found yet. Search by name or paste a page link.'}
                </p>
            )}
        </>
    )
}

export function NotionPagePicker({
    pages,
    value,
    onChange,
    activity,
    branches,
    loadedParents,
    searchResults,
    onExpand,
    onRetry,
    onQueryChange
}: {
    pages: NotionPage[]
    value: string
    onChange: (id: string) => void
} & DiscoveryProps) {
    return (
        <Combobox
            label="Journal page"
            hideLabel
            variant="inline"
            value={value}
            placeholder="Search or select a page"
            maxLength={2000}
            onQueryChange={onQueryChange}
            title={pages.find((page) => page.id === value)?.title}
            options={[
                { value: 'new', label: 'Create a new page' },
                ...pages.filter((page) => page.kind === 'page').map((page) => ({ value: page.id, label: page.title }))
            ]}
            onValueChange={onChange}
            renderTree={(context) => (
                <PageTree
                    pages={pages}
                    context={context}
                    activity={activity}
                    branches={branches}
                    loadedParents={loadedParents}
                    searchResults={searchResults}
                    onExpand={onExpand}
                    onRetry={onRetry}
                />
            )}
        />
    )
}
