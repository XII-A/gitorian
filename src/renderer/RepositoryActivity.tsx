import { useLayoutEffect, useRef } from 'react'
import { WaffleChart } from './components/arc/waffle-chart/waffle-chart'
import type { RepositorySummary } from './repository-markers'
import './repository-activity.css'

export function RepositoryActivity({
    project,
    onProjectChange,
    summary,
    hasRepositories,
    onHighlightChange
}: {
    project: string
    onProjectChange: (key: string) => void
    summary: RepositorySummary
    hasRepositories: boolean
    onHighlightChange?: (key: string | null) => void
}) {
    const card = useRef<HTMLElement>(null)
    useLayoutEffect(() => {
        const node = card.current
        if (!node) return
        const observer = new ResizeObserver(() =>
            node.style.setProperty('--repository-height', `${node.getBoundingClientRect().height}px`)
        )
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    const data = summary.chart
    const total = summary.total
    return (
        <section ref={card} className="repository-activity" aria-labelledby="repository-activity-title">
            <header>
                <h2 id="repository-activity-title">Activity by repository</h2>
            </header>
            {total > 0 ? (
                <div className="repository-chart">
                    <WaffleChart
                        data={data}
                        activeKey={project === 'all' ? null : project}
                        onActiveChange={(key) => onProjectChange(key ?? 'all')}
                        isSelectable={(key) => summary.byId.has(key)}
                        onPreviewChange={onHighlightChange}
                        fillOrder="rows"
                        compactLegend
                        label="Weekly activity by repository"
                        unit="activities"
                        singularUnit="activity"
                        decimals={1}
                        showValues
                    />
                </div>
            ) : (
                <p className="repository-empty">
                    {hasRepositories
                        ? 'No repository activity loaded for this week.'
                        : 'Connect a repository to load its activity.'}
                </p>
            )}
        </section>
    )
}
