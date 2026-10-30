import type { Activity, State } from '../shared/model'

export interface RepositoryMarkerStyle {
    color: string
    shape: 'square' | 'round' | 'framed'
}
export function repositoryMarkerStyle(index: number): RepositoryMarkerStyle {
    const shapes = ['square', 'round', 'framed'] as const
    const shades = [40, 20, 30, 14]
    return {
        color:
            index < 4
                ? `oklch(from var(--series-${index + 1}) l calc(c * 0.85) h)`
                : `color-mix(in oklab, var(--foreground) ${shades[(index - 4) % shades.length]}%, var(--surface))`,
        shape: index === 0 ? 'square' : shapes[(index - 1) % shapes.length]
    }
}
export function summarizeRepositoryActivity(repositories: State['repositories'], items: Activity[]) {
    const counts = new Map<string, number>()
    const names = new Map<string, number>()
    for (const item of items) counts.set(item.repositoryId, (counts.get(item.repositoryId) ?? 0) + 1)
    for (const repo of repositories) names.set(repo.name, (names.get(repo.name) ?? 0) + 1)
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    const ranked = repositories
        .filter((repo) => counts.has(repo.id))
        .map((repo) => {
            const path = repo.path.replaceAll('\\', '/')
            const context = path || repo.remote || repo.id
            return {
                key: repo.id,
                name: repo.name || 'Unnamed repository',
                label:
                    names.get(repo.name)! > 1
                        ? `${repo.name || 'Unnamed repository'} (${context})`
                        : repo.name || 'Unnamed repository',
                path: context,
                value: counts.get(repo.id)!
            }
        })
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    const leading = ranked.slice(0, 6)
    const leadingKeys = new Set(leading.map((repo) => repo.key))
    const remainder = ranked.filter((repo) => !leadingKeys.has(repo.key))
    const other = {
        key: 'repository-other',
        label: `Other (${remainder.length})`,
        value: remainder.reduce((sum, repo) => sum + repo.value, 0),
        color: 'color-mix(in oklab, var(--foreground) 50%, var(--surface))',
        shape: 'framed' as const
    }
    const chart = leading.map((repo, index) => ({ ...repo, ...repositoryMarkerStyle(index) }))
    if (remainder.length) chart.push({ ...other, name: 'Other', path: '' })
    const markers = new Map(chart.map((repo) => [repo.key, repo]))
    const entries = ranked.map((repo) => {
        const group = leadingKeys.has(repo.key) ? repo.key : other.key
        const marker = markers.get(group)!
        return { ...repo, group, color: marker.color, shape: marker.shape }
    })
    return { entries, chart, total, byId: new Map(entries.map((repo) => [repo.key, repo])) }
}
export type RepositorySummary = ReturnType<typeof summarizeRepositoryActivity>
