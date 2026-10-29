import { useMemo } from 'react'
import { Button } from './components/arc/button/button'
import { WaffleChart } from './components/arc/waffle-chart/waffle-chart'
import type { Activity, State } from '../shared/model'
import { repositoryActivityData } from './repository-markers'
import './repository-activity.css'

export function RepositoryActivity({
    repositories,
    items,
    hasRepositories,
    onHighlightChange,
    sample,
    onSampleChange
}: {
    repositories: State['repositories']
    items: Activity[]
    hasRepositories: boolean
    onHighlightChange?: (key: string | null) => void
    sample: boolean
    onSampleChange: (sample: boolean) => void
}) {
    const data = useMemo(() => repositoryActivityData(repositories, items), [repositories, items])
    const total = data.reduce((sum, repo) => sum + repo.value, 0)
    return (
        <>
            <section className="repository-activity" aria-labelledby="repository-activity-title">
                <header>
                    <h2 id="repository-activity-title">Activity by repository</h2>
                </header>
                {total > 0 ? (
                    <>
                        <div className="repository-chart">
                            <WaffleChart
                                data={data}
                                onPreviewChange={onHighlightChange}
                                fillOrder="rows"
                                compactLegend
                                label="Weekly activity by repository"
                                unit="activities"
                                showValues
                            />
                        </div>
                    </>
                ) : (
                    <p className="repository-empty">
                        {hasRepositories
                            ? 'No repository activity loaded for this week.'
                            : 'Connect a repository to load its activity.'}
                    </p>
                )}
            </section>
            {import.meta.env.DEV && (
                <div className="repository-sample-toggle">
                    <Button variant="secondary" size="sm" aria-pressed={sample} onClick={() => onSampleChange(!sample)}>
                        {sample ? 'Show real data' : 'Show sample data'}
                    </Button>
                </div>
            )}
        </>
    )
}
