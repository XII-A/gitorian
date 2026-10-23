import type { Activity } from '../shared/model'
import { summarizeChanges, type LineStats } from '../shared/change-statistics'
import { ChevronDown } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import './change-statistics.css'

const number = (value: number) => value.toLocaleString('en-US')
const lines = (value: number) => `${number(value)} ${value === 1 ? 'line' : 'lines'}`

export function ChangeCounts({ stats }: { stats: LineStats | null | undefined }) {
    if (stats === null) return <span className="line-counts-note">Binary</span>
    if (!stats) return <span className="line-counts-note">Line counts unavailable</span>
    return (
        <span
            className="line-counts"
            role="img"
            aria-label={`${lines(stats.additions)} added, ${lines(stats.deletions)} deleted`}
        >
            <span className="line-additions" aria-hidden="true">
                +{number(stats.additions)}
            </span>
            <span className="line-deletions" aria-hidden="true">
                −{number(stats.deletions)}
            </span>
        </span>
    )
}

/** One shared summary and accessible disclosure for hub and workspace file details. */
export function ChangeStatistics({ files }: { files: Activity['files'] }) {
    const summary = summarizeChanges(files)
    if (!summary.total) return <span className="line-counts-note">Line counts unavailable</span>
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    className="change-statistics-trigger"
                    variant="ghost"
                    size="sm"
                    aria-label="Show line change breakdown"
                >
                    <ChangeCounts stats={summary.total} />
                    <ChevronDown size={14} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="change-statistics-popover" align="end" aria-label="Line change breakdown">
                <table className="change-statistics-table">
                    <caption className="sr-only">Line changes by file category</caption>
                    <thead>
                        <tr>
                            <th scope="col">Area</th>
                            <th scope="col">Added</th>
                            <th scope="col">Deleted</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summary.groups.map((group) => (
                            <tr key={group.category}>
                                <th scope="row">{group.category}</th>
                                <td className="line-additions">+{number(group.additions)}</td>
                                <td className="line-deletions">−{number(group.deletions)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th scope="row">Total</th>
                            <td className="line-additions">+{number(summary.total.additions)}</td>
                            <td className="line-deletions">−{number(summary.total.deletions)}</td>
                        </tr>
                    </tfoot>
                </table>
                {summary.binaryFiles > 0 && (
                    <p>{`${summary.binaryFiles} binary ${summary.binaryFiles === 1 ? 'file' : 'files'} excluded from line counts.`}</p>
                )}
            </PopoverContent>
        </Popover>
    )
}
