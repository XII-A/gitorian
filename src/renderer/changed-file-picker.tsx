import { File } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { required } from '../shared/required'

import './changed-file-picker.css'
import type { MorphSelectTreeContext } from './components/arc/morph-select/morph-select'
import { MorphSelect } from './components/arc/morph-select/morph-select'
import type { TreeNode } from './components/arc/tree-view/tree-view'
import { TreeView } from './components/arc/tree-view/tree-view'

const fileTree = (paths: string[]): TreeNode[] => {
    const roots: TreeNode[] = []
    const directories = new Map<string, TreeNode>()
    for (const path of paths) {
        const parts = path.split('/')
        let children = roots
        let directory = ''
        for (const part of parts.slice(0, -1)) {
            directory = directory ? `${directory}/${part}` : part
            let node = directories.get(directory)
            if (!node) {
                node = { children: [], id: `directory:${directory}`, label: part, title: directory }
                directories.set(directory, node)
                children.push(node)
            }
            children = required(node.children)
        }
        children.push({ id: `file:${path}`, label: required(parts.at(-1)), title: path })
    }
    const compact = (nodes: TreeNode[]): TreeNode[] =>
        nodes
            .map((initialNode) => {
                let node = initialNode
                // Shared single-folder chains remain legible without spending a column on every level.
                while (node.children?.length === 1 && node.children[0].children) {
                    const [child] = node.children
                    node = { ...child, label: `${node.label}/${child.label}` }
                }
                return node.children ? { ...node, children: compact(node.children) } : node
            })
            .toSorted(
                (a, b) =>
                    Number(Boolean(b.children)) - Number(Boolean(a.children)) ||
                    (() => {
                        if (a.label < b.label) {
                            return -1
                        }
                        if (a.label > b.label) {
                            return 1
                        }
                        return 0
                    })()
            )
    return compact(roots)
}

const FileTree = ({ paths, context }: { paths: string[]; context: MorphSelectTreeContext }) => {
    const { id, query, selected, select } = context
    const needle = query.trim().toLowerCase()
    const matches = useMemo(() => paths.filter((path) => path.toLowerCase().includes(needle)), [paths, needle])
    const nodes = useMemo(() => fileTree(matches), [matches])
    const initialExpanded = useMemo(() => {
        const result: string[] = []
        const visit = (items: TreeNode[]) => {
            for (const item of items) {
                if (item.children) {
                    if (needle || selected?.startsWith(`${item.title}/`)) {
                        result.push(item.id)
                    }
                    visit(item.children)
                }
            }
        }
        visit(nodes)
        return result
    }, [nodes, selected, needle])
    const [expanded, setExpanded] = useState<string[]>(initialExpanded)
    return (
        <>
            <TreeView
                id={id}
                aria-label="Changed files"
                nodes={nodes}
                variant="plain"
                wrapLabels
                animateExpansion={false}
                onEscape={context.close}
                selectedId={selected ? `file:${selected}` : null}
                expandedIds={expanded}
                onExpandedChange={setExpanded}
                onSelect={(node) => {
                    if (!node.children) {
                        select(node.id.slice('file:'.length))
                    }
                }}
            />
            {!matches.length && <p className="file-picker-empty">No matching files.</p>}
            {selected && <code className="file-picker-path">{selected}</code>}
        </>
    )
}

export const ChangedFilePicker = ({
    paths,
    value,
    onValueChange
}: {
    paths: string[]
    value: string
    onValueChange: (value: string) => void
}) => {
    const root = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ list: 320, panel: 320, trigger: 240 })
    useLayoutEffect(() => {
        const field = root.current
        const toolbar = field?.closest<HTMLElement>('.ws-diff-tools')
        const panel = field?.closest<HTMLElement>("[role='tabpanel']")
        if (!field || !toolbar) {
            return
        }
        const read = () => {
            const style = getComputedStyle(toolbar)
            const panelWidth = toolbar.clientWidth - Number(style.paddingLeft) - Number(style.paddingRight)
            const listHeight = panel
                ? panel.getBoundingClientRect().bottom - field.getBoundingClientRect().bottom - 8
                : 320
            const next = {
                list: Math.max(80, Math.min(320, listHeight)),
                panel: Math.min(440, panelWidth),
                trigger: Math.max(80, field.clientWidth)
            }
            setSize((previous) =>
                previous.trigger === next.trigger && previous.panel === next.panel && previous.list === next.list
                    ? previous
                    : next
            )
        }
        read()
        const observer = new ResizeObserver(read)
        observer.observe(field)
        observer.observe(toolbar)
        if (panel) {
            observer.observe(panel)
        }
        return () => {
            observer.disconnect()
        }
    }, [])
    const items = useMemo(
        () =>
            paths.map((path) => ({
                icon: <File size={16} />,
                keywords: path,
                label: required(path.split('/').at(-1)),
                value: path
            })),
        [paths]
    )
    const treeKey = useMemo(() => JSON.stringify(paths), [paths])
    return (
        <div ref={root} className="changed-file-picker">
            <MorphSelect
                label="Changed file"
                hideLabel
                searchable
                searchPlaceholder="Find a file…"
                value={value}
                title={value}
                onValueChange={onValueChange}
                items={items}
                size="sm"
                maxTriggerWidth={size.trigger}
                panelWidth={size.panel}
                maxListHeight={size.list}
                renderTree={(context) => (
                    <FileTree key={`${treeKey}:${value}:${context.query}`} paths={paths} context={context} />
                )}
            />
        </div>
    )
}
