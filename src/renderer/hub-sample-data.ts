import type { Activity, Repository } from '../shared/model'

const samples = [
    { name: 'weekly-j', count: 18, title: 'Polish the weekly overview' },
    { name: 'design-system', count: 11, title: 'Refine chart interactions' },
    { name: 'api-service', count: 7, title: 'Improve request validation' },
    { name: 'docs-site', count: 4, title: 'Document the new workflow' }
]

/** In-memory preview only. IDs never refer to stored repositories or activities. */
export function hubSampleData(week: string) {
    const repositories: Repository[] = samples.map((sample) => ({
        id: `sample-${sample.name}`,
        name: sample.name,
        path: '',
        remote: '',
        base: 'main',
        trackingStart: week,
        emails: [],
        available: true,
        removed: false,
        branchBases: {},
        branches: ['main']
    }))
    const activities: Activity[] = []
    // Interleave repositories so all four appear in the first five visible rows.
    for (let index = 0; index < 18; index++) {
        samples.forEach((sample, repoIndex) => {
            if (index >= sample.count) return
            const kind = index % 5 === 1 ? 'change-request' : index % 5 === 2 ? 'review' : 'commit'
            activities.push({
                id: `sample-activity-${repoIndex}-${index}`,
                repositoryId: repositories[repoIndex].id,
                kind,
                title: `${sample.title}${index ? ` (${index + 1})` : ''}`,
                date: week,
                author: 'Sample developer',
                branches: ['feature/hub-refresh'],
                sha: kind === 'commit' ? (repoIndex * 100 + index + 1).toString(16).padStart(40, '0') : undefined,
                changeRequestId: kind !== 'commit' ? `sample/pr/${repoIndex * 100 + index + 1}` : undefined,
                description: 'Sample activity for previewing repository highlighting.',
                files: []
            })
        })
    }
    return { repositories, activities }
}
