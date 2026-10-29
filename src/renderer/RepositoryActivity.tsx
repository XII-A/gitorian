import { useMemo, useState } from 'react'
import { Button } from './components/arc/button/button'
import { WaffleChart } from './components/arc/waffle-chart/waffle-chart'
import type { Activity, State } from '../shared/model'
import './repository-activity.css'

const sampleData = [
    { key: 'sample-weekly-j', label: 'weekly-j', value: 18 },
    { key: 'sample-design-system', label: 'design-system', value: 11 },
    { key: 'sample-api-service', label: 'api-service', value: 7 },
    { key: 'sample-docs-site', label: 'docs-site', value: 4 }
]

export function RepositoryActivity({
    repositories,
    items,
    hasRepositories
}: {
    repositories: State['repositories']
    items: Activity[]
    hasRepositories: boolean
}) {
    const [sample, setSample] = useState(false)
    const repositoryData = useMemo(
        () =>
            repositories
                .map((repo) => ({
                    key: repo.id,
                    label: repo.name,
                    value: items.filter((item) => item.repositoryId === repo.id).length
                }))
                .filter((repo) => repo.value > 0)
                .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
        [repositories, items]
    )
    const data = import.meta.env.DEV && sample ? sampleData : repositoryData
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
                                data={data.map((repo, index) => ({
                                    ...repo,
                                    color:
                                        index < 4
                                            ? `oklch(from var(--series-${index + 1}) l calc(c * 0.85) h)`
                                            : undefined
                                }))}
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
                    <Button
                        variant="secondary"
                        size="sm"
                        aria-pressed={sample}
                        onClick={() => setSample((current) => !current)}
                    >
                        {sample ? 'Show real data' : 'Show sample data'}
                    </Button>
                </div>
            )}
        </>
    )
}
