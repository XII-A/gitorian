import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { ChangeCounts } from './ChangeStatistics'
import { changeLabels } from './activity-details'
import { diffFileKind, FileChangeIcon } from './diff-file-presentation'
import { diffStats, type DiffFile } from './diff-model'

export function DiffFileHeader({
    file,
    collapsed,
    onToggle,
    showLineCounts
}: {
    file: DiffFile
    collapsed: boolean
    onToggle: () => void
    showLineCounts: boolean
}) {
    const Chevron = collapsed ? ChevronRight : ChevronDown
    const kind = diffFileKind(file)
    return (
        <div className="diff-stream-heading" data-file={file.name}>
            <h3 className="diff-stream-title">
                <Button
                    variant="ghost"
                    size="sm"
                    className="diff-file-disclosure"
                    contentLayout="stack"
                    animateContent={false}
                    onClick={onToggle}
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.name}. ${changeLabels[kind]} file${file.prevName ? `. Previously ${file.prevName}` : ''}`}
                    title={file.prevName ? `${file.prevName} → ${file.name}` : file.name}
                >
                    <span className="diff-file-disclosure-content">
                        <Chevron size={14} strokeWidth={1.75} aria-hidden="true" />
                        <FileChangeIcon kind={kind} />
                        <code>{file.name}</code>
                    </span>
                </Button>
            </h3>
            <span className="diff-stream-file-meta">
                {file.binary || !file.hunks.length ? (
                    <span
                        className="diff-stream-file-state"
                        title={
                            file.binary ? 'Binary file. No text preview available.' : 'Rename or metadata changes only.'
                        }
                    >
                        {file.binary ? 'Binary file' : 'No text changes'}
                    </span>
                ) : null}
                {showLineCounts && !file.binary && <ChangeCounts stats={diffStats(file)} />}
            </span>
        </div>
    )
}
