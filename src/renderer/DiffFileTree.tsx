import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, FlaskConicalOff } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { ChangeCounts } from './ChangeStatistics'
import { ExpandingSearch } from './components/arc/expanding-search/expanding-search'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Tooltip } from './components/arc/tooltip/tooltip'
import { TreeView, type TreeNode } from './components/arc/tree-view/tree-view'
import { changeLabels } from './activity-details'
import { diffFileKind, FileChangeIcon } from './diff-file-presentation'
import { DiffFileFilters, type DiffFileFilterControls } from './DiffFileFilters'
import { diffStats, type DiffFile } from './diff-model'

interface DiffFileTreeProps extends DiffFileFilterControls {
    visibleFiles: DiffFile[]
    activeFile: string
    onSelectFile: (name: string) => void
}

/** Search narrows navigation; status filters and ordering apply to the complete reading workspace. */
export function DiffFileTree(props: DiffFileTreeProps) {
    const { visibleFiles, activeFile, onSelectFile, fileList, order } = props
    const [query, setQuery] = useState('')
    const [searchExpanded, setSearchExpanded] = useState(false)
    const [expanded, setExpanded] = useState<string[]>()
    const viewport = useRef<HTMLDivElement>(null)
    const tree = useMemo(() => {
        const roots: TreeNode[] = []
        const folders = new Map<string, TreeNode>()
        const totals = new Map<string, { additions: number; deletions: number; binary: number }>()
        const needle = query.trim().toLowerCase()
        let matches = 0
        for (const file of visibleFiles) {
            const parts = file.name.split('/')
            const match =
                file.name.toLowerCase().includes(needle) || Boolean(file.prevName?.toLowerCase().includes(needle))
            const stats = diffStats(file)
            let path = ''
            let children = roots
            if (fileList === 'tree')
                for (const part of parts.slice(0, -1)) {
                    path = path ? `${path}/${part}` : part
                    const total = totals.get(path) ?? { additions: 0, deletions: 0, binary: 0 }
                    total.additions += stats?.additions ?? 0
                    total.deletions += stats?.deletions ?? 0
                    total.binary += file.binary ? 1 : 0
                    totals.set(path, total)
                    if (!match) continue
                    let folder = folders.get(path)
                    if (!folder) {
                        folder = { id: `directory:${path}`, label: part, title: path, children: [], selectable: false }
                        folders.set(path, folder)
                        children.push(folder)
                    }
                    children = folder.children!
                }
            if (match) {
                matches++
                const kind = diffFileKind(file)
                children.push({
                    id: `file:${file.name}`,
                    label: fileList === 'list' ? file.name : parts.at(-1)!,
                    title: file.prevName ? `${file.prevName} → ${file.name}` : file.name,
                    ariaLabel: `${changeLabels[kind]} ${file.name}. ${file.binary ? 'Binary file' : `${stats?.additions ?? 0} lines added, ${stats?.deletions ?? 0} lines deleted`}`,
                    icon: <FileChangeIcon kind={kind} />,
                    status: <ChangeCounts stats={stats} />
                })
            }
        }
        for (const [path, folder] of folders) {
            const total = totals.get(path)!
            folder.status = (
                <span className="diff-tree-folder-counts">
                    {(total.additions > 0 || total.deletions > 0 || total.binary === 0) && (
                        <ChangeCounts stats={total} />
                    )}
                    {total.binary > 0 && (
                        <span className="line-counts-note">
                            {total.additions || total.deletions ? ' · ' : ''}
                            {total.binary} binary
                        </span>
                    )}
                </span>
            )
        }
        const scores = new Map<string, number>(
            visibleFiles.map((file) => {
                const stats = diffStats(file)
                return [`file:${file.name}`, (stats?.additions ?? 0) + (stats?.deletions ?? 0)] as const
            })
        )
        const score = (node: TreeNode): number => {
            const cached = scores.get(node.id)
            if (cached !== undefined) return cached
            const value = node.children?.reduce((total, child) => total + score(child), 0) ?? 0
            scores.set(node.id, value)
            return value
        }
        const sort = (nodes: TreeNode[]) => {
            nodes.sort(
                (a, b) =>
                    Number(Boolean(b.children)) - Number(Boolean(a.children)) ||
                    (order === 'changes' ? score(b) - score(a) : 0) ||
                    a.label.localeCompare(b.label)
            )
            for (const node of nodes) {
                // Collapse single-directory chains, as in a source editor's explorer.
                while (node.children?.length === 1 && node.children[0].children) {
                    const child = node.children[0]
                    node.label += '/' + child.label
                    node.id = child.id
                    node.title = child.title
                    node.children = child.children
                }
                if (node.children) sort(node.children)
            }
        }
        sort(roots)
        return { roots, matches, directories: [...folders.values()].map((node) => node.id) }
    }, [visibleFiles, query, fileList, order])
    useLayoutEffect(() => {
        const parts = activeFile.split('/')
        const ancestors = parts.slice(0, -1).map((_, index) => `directory:${parts.slice(0, index + 1).join('/')}`)
        setExpanded((previous) => (previous ? [...new Set([...previous, ...ancestors])] : previous))
    }, [activeFile])
    useLayoutEffect(() => {
        const root = viewport.current
        const selected = root?.querySelector<HTMLElement>('[aria-selected="true"]')
        if (!root || !selected) return
        const item = selected.getBoundingClientRect()
        const frame = root.getBoundingClientRect()
        const treeRoot = selected.closest('[role="tree"]')
        const rowHeight = treeRoot
            ? parseFloat(getComputedStyle(treeRoot).getPropertyValue('--tree-row-height')) || 0
            : 0
        const pinnedHeight = (Number(selected.getAttribute('aria-level')) - 1) * rowHeight
        if (item.top < frame.top + pinnedHeight) root.scrollTop += item.top - frame.top - pinnedHeight
        else if (item.bottom > frame.bottom) root.scrollTop += item.bottom - frame.bottom
    }, [activeFile, expanded, query, fileList])
    const expandedIds = query.trim() ? tree.directories : (expanded ?? tree.directories)
    return (
        <div className="diff-file-tree">
            <div className="diff-explorer-heading" data-search-expanded={searchExpanded}>
                <h3>
                    Files <span>{visibleFiles.length}</span>
                </h3>
                <div className="diff-explorer-actions">
                    <div className="diff-explorer-tools" inert={searchExpanded}>
                        <Tooltip content="Hide tests">
                            <Button
                                className="diff-toolbar-icon"
                                variant="ghost"
                                size="sm"
                                aria-label="Hide tests"
                                aria-pressed={props.exclusions.tests}
                                data-active={props.exclusions.tests}
                                onClick={() =>
                                    props.onExclusionsChange({ ...props.exclusions, tests: !props.exclusions.tests })
                                }
                            >
                                <FlaskConicalOff size={16} strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </Tooltip>
                        <Tooltip content="Hide docs">
                            <Button
                                className="diff-toolbar-icon"
                                variant="ghost"
                                size="sm"
                                aria-label="Hide docs"
                                aria-pressed={props.exclusions.docs}
                                data-active={props.exclusions.docs}
                                onClick={() =>
                                    props.onExclusionsChange({ ...props.exclusions, docs: !props.exclusions.docs })
                                }
                            >
                                <BookOpen size={16} strokeWidth={1.75} aria-hidden="true">
                                    <path d="m2 2 20 20" />
                                </BookOpen>
                            </Button>
                        </Tooltip>
                        <DiffFileFilters {...props} />
                    </div>
                    <div className="diff-explorer-search-slot">
                        <ExpandingSearch
                            className="diff-explorer-search"
                            label="Find a file"
                            placeholder="Find a file…"
                            variant="filter"
                            appearance="ghost"
                            size="sm"
                            expandedWidth="container"
                            value={query}
                            onValueChange={setQuery}
                            onExpandedChange={setSearchExpanded}
                        />
                    </div>
                </div>
            </div>
            <ScrollArea
                className="diff-tree-scroll"
                label="Changed file navigation"
                viewportRef={viewport}
                fade={0}
                scrollbars="hover"
            >
                <TreeView
                    aria-label="Changed files"
                    nodes={tree.roots}
                    variant="plain"
                    density="compact"
                    animateExpansion={false}
                    stickyFolders={fileList === 'tree'}
                    selectedId={`file:${activeFile}`}
                    expandedIds={expandedIds}
                    onExpandedChange={setExpanded}
                    onSelect={(node) => {
                        if (node.id.startsWith('file:')) onSelectFile(node.id.slice(5))
                    }}
                />
                {!tree.roots.length && (
                    <div className="diff-tree-empty">
                        <p>No matching files</p>
                        {query ? (
                            <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                                Clear search
                            </Button>
                        ) : null}
                    </div>
                )}
            </ScrollArea>
            <span className="sr-only" role="status">
                {query ? `${tree.matches} matching files` : ''}
            </span>
        </div>
    )
}
