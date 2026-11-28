import type { Activity } from '../shared/model'
import { useMemo, type ReactNode } from 'react'
import { weeklyLineStats, summarizeChanges, type LineStats } from '../shared/change-statistics'
import { ChevronDown } from 'lucide-react'
import { Accordion } from './components/arc/accordion/accordion'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
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

function BreakdownScrollArea({ children }: { children: ReactNode }) {
    return (
        <ScrollArea
            label="Breakdown details"
            maxHeight="min(var(--radix-popover-content-available-height), calc(100dvh - 24px))"
            fade={8}
        >
            {children}
        </ScrollArea>
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
                <BreakdownScrollArea>
                    <div className="change-statistics-body">
                        <BreakdownTable groups={summary.groups} total={summary.total} />
                        {summary.binaryFiles > 0 && (
                            <p>{`${summary.binaryFiles} binary ${summary.binaryFiles === 1 ? 'file' : 'files'} excluded from line counts.`}</p>
                        )}
                    </div>
                </BreakdownScrollArea>
            </PopoverContent>
        </Popover>
    )
}

function BreakdownTable({
    groups,
    total
}: {
    groups: ReturnType<typeof summarizeChanges>['groups']
    total: LineStats
}) {
    return (
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
                {groups.map((group) => (
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
                    <td className="line-additions">+{number(total.additions)}</td>
                    <td className="line-deletions">−{number(total.deletions)}</td>
                </tr>
            </tfoot>
        </table>
    )
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const metricNumber = (value: number) => (value < 10000 ? number(value) : compact.format(value).toLowerCase())

function WeeklyBreakdown({ summary }: { summary: ReturnType<typeof weeklyLineStats> }) {
    const { groups, total, commits, missing, excludedFiles, excludedAdditions, excludedDeletions, binaryFiles } =
        summary
    if (!total)
        return (
            <div className="change-statistics-body">
                <p>
                    Line counts unavailable for {number(missing)} of {number(commits)}{' '}
                    {commits === 1 ? 'commit' : 'commits'}.
                </p>
            </div>
        )

    const activeGroups = groups.filter((group) => group.files > 0)
    const excluded = excludedFiles + binaryFiles
    return (
        <>
            <div className="change-statistics-body">
                {activeGroups.length > 0 ? (
                    <BreakdownTable groups={activeGroups} total={total} />
                ) : (
                    <p>No code changes in counted files</p>
                )}
            </div>
            {excluded > 0 ? (
                <div className="change-statistics-footer">
                    <Accordion
                        variant="plain"
                        defaultOpen={-1}
                        triggerProps={{ className: 'change-statistics-disclosure' }}
                        items={[
                            {
                                title: `Excluded · ${number(excluded)} ${excluded === 1 ? 'file' : 'files'}${missing ? ` · ${number(missing)} unindexed` : ''}`,
                                content: (
                                    <dl className="change-statistics-details">
                                        {excludedFiles > 0 && (
                                            <>
                                                <dt>Generated &amp; assets</dt>
                                                <dd>
                                                    {number(excludedFiles)}{' '}
                                                    <span>
                                                        (+{metricNumber(excludedAdditions)} −
                                                        {metricNumber(excludedDeletions)})
                                                    </span>
                                                </dd>
                                            </>
                                        )}
                                        {binaryFiles > 0 && (
                                            <>
                                                <dt>Binary</dt>
                                                <dd>{number(binaryFiles)}</dd>
                                            </>
                                        )}
                                        {missing > 0 && (
                                            <>
                                                <dt>Unindexed commits</dt>
                                                <dd>
                                                    {number(missing)} / {number(commits)}
                                                </dd>
                                            </>
                                        )}
                                    </dl>
                                )
                            }
                        ]}
                    />
                </div>
            ) : (
                missing > 0 && (
                    <p className="change-statistics-footer">
                        {number(missing)} of {number(commits)} commits unindexed
                    </p>
                )
            )}
        </>
    )
}

export function WeeklyLineMetric({ activities }: { activities: Activity[] }) {
    const summary = useMemo(() => weeklyLineStats(activities), [activities])
    const { total, commits, missing } = summary
    if (!commits)
        return (
            <span className="hub-line-metric-empty" role="img" aria-label="0 lines added, 0 lines deleted">
                +0 −0
            </span>
        )
    if (!total) return <span className="line-counts-note">Line counts unavailable</span>
    const label = `${lines(total.additions)} added, ${lines(total.deletions)} deleted`
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    className="hub-line-metric change-statistics-trigger"
                    variant="ghost"
                    size="sm"
                    aria-label={`${label}${missing ? ' (partial)' : ''}. Show weekly breakdown`}
                >
                    <span className="line-counts" aria-hidden="true">
                        <span className="line-additions">+{metricNumber(total.additions)}</span>
                        <span className="line-deletions">−{metricNumber(total.deletions)}</span>
                    </span>
                    {missing > 0 && <span className="line-counts-note">(partial)</span>}
                    <ChevronDown size={14} aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="change-statistics-popover" align="end" aria-label="Weekly line change breakdown">
                <BreakdownScrollArea>
                    <WeeklyBreakdown summary={summary} />
                </BreakdownScrollArea>
            </PopoverContent>
        </Popover>
    )
}
