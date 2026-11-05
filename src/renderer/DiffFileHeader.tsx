import { ChevronRight } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/motion-tokens'
import { Button } from './components/arc/button/button'
import { ChangeCounts } from './ChangeStatistics'
import { changeLabels } from './activity-details'
import { diffFileKind, FileChangeIcon } from './diff-file-presentation'
import { diffStats, type DiffFile } from './diff-model'

const DisclosureChevron = motion.create(ChevronRight)

export function DiffFileHeader({
    file,
    collapsed,
    onToggle,
    showLineCounts,
    actions
}: {
    file: DiffFile
    collapsed: boolean
    onToggle: (event: MouseEvent<HTMLButtonElement>) => void
    showLineCounts: boolean
    actions?: ReactNode
}) {
    const reduced = useReducedMotion()
    const [pointerToggle, setPointerToggle] = useState(false)
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
                    onClick={(event) => {
                        setPointerToggle(event.detail > 0)
                        onToggle(event)
                    }}
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${file.name}. ${changeLabels[kind]} file${file.prevName ? `. Previously ${file.prevName}` : ''}`}
                    title={file.prevName ? `${file.prevName} → ${file.name}` : file.name}
                >
                    <span className="diff-file-disclosure-content">
                        <DisclosureChevron
                            size={14}
                            strokeWidth={1.75}
                            aria-hidden="true"
                            initial={false}
                            animate={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                            transition={{
                                duration: reduced || !pointerToggle ? 0 : motionTokens.duration.instant,
                                ease: [...motionTokens.ease.enter]
                            }}
                        />
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
            {actions}
        </div>
    )
}
