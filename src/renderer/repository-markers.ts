import type { Activity, State } from '../shared/model'

export interface RepositoryMarkerStyle {
    color: string
    shape: 'square' | 'round' | 'framed'
}

export function repositoryActivityData(repositories: State['repositories'], items: Activity[]) {
    return repositories
        .map((repo) => ({
            key: repo.id,
            label: repo.name,
            value: items.filter((item) => item.repositoryId === repo.id).length
        }))
        .filter((repo) => repo.value > 0)
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
        .map((repo, index) => ({ ...repo, ...repositoryMarkerStyle(index) }))
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
