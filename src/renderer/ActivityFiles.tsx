import type { Activity } from '../shared/model'
import { useState } from 'react'
import { Badge, type BadgeTone } from './components/arc/badge/badge'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { changeKind, changeKinds, changeLabels, orderedFiles, type ChangeKind } from './activity-details'
import { ChangeCounts } from './ChangeStatistics'

const tones: Record<ChangeKind, BadgeTone> = {
    deleted: 'danger',
    added: 'success',
    renamed: 'info',
    modified: 'warning',
    copied: 'neutral',
    other: 'neutral'
}
const letters: Record<ChangeKind, string> = {
    deleted: 'D',
    added: 'A',
    renamed: 'R',
    modified: 'M',
    copied: 'C',
    other: '?'
}

export function ActivityFiles({ files }: { files: Activity['files'] }) {
    const [filter, setFilter] = useState('all')
    const counts = changeKinds.map((kind) => ({
        kind,
        count: files.filter((file) => changeKind(file.status) === kind).length
    }))
    const value = counts.some(({ kind, count }) => kind === filter && count > 0) ? filter : 'all'
    const visibleFiles = orderedFiles(files).filter((file) => value === 'all' || changeKind(file.status) === value)
    return (
        <>
            <SegmentedControl
                className="hub-detail-file-filters"
                label="Filter changed files"
                value={value}
                onValueChange={setFilter}
                options={[
                    {
                        value: 'all',
                        label: 'All',
                        accessory: <span className="hub-detail-filter-count">{files.length}</span>
                    },
                    ...counts
                        .filter(({ count }) => count > 0)
                        .map(({ kind, count }) => ({
                            value: kind,
                            label: changeLabels[kind],
                            accessory: <span className="hub-detail-filter-count">{count}</span>
                        }))
                ]}
            />
            <ul className="hub-detail-files" aria-label="Changed files ledger">
                {visibleFiles.map((file) => {
                    const kind = changeKind(file.status)
                    // Older local snapshots joined rename paths with a tab.
                    const legacyPaths = !file.previousName && kind === 'renamed' ? file.name.split('\t') : []
                    const name = legacyPaths.length === 2 ? legacyPaths[1] : file.name
                    const previousName = file.previousName ?? (legacyPaths.length === 2 ? legacyPaths[0] : undefined)
                    const slash = name.lastIndexOf('/')
                    return (
                        <li key={file.name} data-change={kind}>
                            <Badge className="hub-detail-file-chip" tone={tones[kind]} size="sm" animateChanges={false}>
                                <span aria-hidden="true">{letters[kind]}</span>
                                <span className="hub-sr-only">
                                    {kind === 'other' ? file.status : changeLabels[kind]}
                                </span>
                            </Badge>
                            <div className="hub-detail-file-path">
                                <span className="hub-detail-file-name">{name.slice(slash + 1)}</span>
                                {previousName ? (
                                    <span className="hub-detail-file-directory">
                                        <span>{previousName}</span>
                                        <span aria-label="to"> → </span>
                                        <span>{name}</span>
                                    </span>
                                ) : slash >= 0 ? (
                                    <span className="hub-detail-file-directory">{name.slice(0, slash + 1)}</span>
                                ) : null}
                            </div>
                            <ChangeCounts stats={file.lineStats} />
                        </li>
                    )
                })}
            </ul>
        </>
    )
}
