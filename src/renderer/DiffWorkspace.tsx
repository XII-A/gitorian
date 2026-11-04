import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { FoldVertical, UnfoldVertical, X } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { ChangeCounts } from './ChangeStatistics'
import { DiffFileTree } from './DiffFileTree'
import { DiffDisplayOptions, type DiffDisplayPreferences } from './DiffDisplayOptions'
import type { DiffFileFilterControls } from './DiffFileFilters'
import { diffStats, type DiffFile } from './diff-model'
import './diff-workspace.css'

interface DiffWorkspaceProps extends DiffDisplayPreferences, DiffFileFilterControls {
    visibleFiles: DiffFile[]
    activeFile: string
    onSelectFile: (name: string) => void
    allCollapsed: boolean
    onToggleAll: () => void
    detached: boolean
    structured: boolean
    children: ReactNode
}

/** Atlas: a continuous reader with a compact explorer when the detached workspace has room. */
export function DiffWorkspace(props: DiffWorkspaceProps) {
    const { files, visibleFiles, detached, children } = props
    const root = useRef<HTMLDivElement>(null)
    const [wide, setWide] = useState(false)
    useLayoutEffect(() => {
        const element = root.current
        if (!element) return
        const read = () => setWide(detached && element.clientWidth >= 720)
        read()
        const observer = new ResizeObserver(read)
        observer.observe(element)
        return () => observer.disconnect()
    }, [detached])
    const totals = visibleFiles.reduce(
        (total, file) => {
            const stats = diffStats(file)
            return {
                additions: total.additions + (stats?.additions ?? 0),
                deletions: total.deletions + (stats?.deletions ?? 0)
            }
        },
        { additions: 0, deletions: 0 }
    )
    const FoldIcon = props.allCollapsed ? UnfoldVertical : FoldVertical
    const toggleLabel = props.allCollapsed ? 'Expand all files' : 'Collapse all files'
    const filtered = props.filter !== 'all' || props.exclusions.tests || props.exclusions.docs
    return (
        <div ref={root} className="diff-workspace" data-detached={detached} data-wide={wide}>
            {wide && (
                <aside className="diff-explorer" aria-label="Change navigator">
                    <DiffFileTree
                        files={files}
                        visibleFiles={visibleFiles}
                        activeFile={props.activeFile}
                        onSelectFile={props.onSelectFile}
                        filter={props.filter}
                        onFilterChange={props.onFilterChange}
                        exclusions={props.exclusions}
                        onExclusionsChange={props.onExclusionsChange}
                        onClearFilters={props.onClearFilters}
                        fileList={props.fileList}
                        onFileListChange={props.onFileListChange}
                        order={props.order}
                        onOrderChange={props.onOrderChange}
                    />
                </aside>
            )}
            <div className="diff-workspace-reader">
                <div className="diff-workspace-toolbar">
                    <div className="diff-workspace-summary">
                        <span>
                            {visibleFiles.length} {visibleFiles.length === 1 ? 'file' : 'files'}
                            {filtered ? ` of ${files.length}` : ' changed'}
                        </span>
                        {props.showLineCounts && visibleFiles.some((file) => !file.binary) && (
                            <ChangeCounts stats={totals} />
                        )}
                    </div>
                    <div className="diff-workspace-actions">
                        {!wide && filtered && (
                            <Button
                                className="diff-toolbar-icon"
                                variant="ghost"
                                size="sm"
                                aria-label="Clear file filters"
                                title="Show all files"
                                onClick={props.onClearFilters}
                            >
                                <X size={15} aria-hidden="true" />
                            </Button>
                        )}
                        <Button
                            className="diff-toolbar-icon"
                            variant="ghost"
                            size="sm"
                            aria-label={toggleLabel}
                            title={toggleLabel}
                            disabled={!visibleFiles.length}
                            animateContent={false}
                            onClick={props.onToggleAll}
                        >
                            <FoldIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                        </Button>
                        {props.structured && <DiffDisplayOptions {...props} />}
                    </div>
                </div>
                <div className="diff-workspace-stream">{children}</div>
            </div>
        </div>
    )
}
