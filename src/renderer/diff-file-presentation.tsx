import { File, FileMinus2, FilePenLine, FilePlus2, FileSymlink } from 'lucide-react'
import { changeLabels, type ChangeKind } from './activity-details'
import type { DiffFile } from './diff-model'

export type DiffFileFilter = 'all' | 'added' | 'modified' | 'deleted' | 'renamed' | 'binary'
export type DiffFileList = 'tree' | 'list'
export type DiffFileOrder = 'path' | 'changes'

export function diffFileKind(file: DiffFile): ChangeKind {
    switch (file.type) {
        case 'new':
            return 'added'
        case 'deleted':
            return 'deleted'
        case 'rename-pure':
        case 'rename-changed':
            return 'renamed'
        default:
            return 'modified'
    }
}

export function matchesDiffFilter(file: DiffFile, filter: DiffFileFilter) {
    return filter === 'all' || (filter === 'binary' ? file.binary : diffFileKind(file) === filter)
}

/** The same status meanings and palette as the activity's changed-file ledger. */
export function FileChangeIcon({ kind }: { kind: ChangeKind }) {
    const Icon =
        kind === 'added'
            ? FilePlus2
            : kind === 'deleted'
              ? FileMinus2
              : kind === 'modified'
                ? FilePenLine
                : kind === 'renamed'
                  ? FileSymlink
                  : File
    return (
        <span className="diff-file-status" data-change={kind} role="img" aria-label={`${changeLabels[kind]} file`}>
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
    )
}
