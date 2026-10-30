import type { Repository } from '../shared/model'
import { MorphSelect } from './components/arc/morph-select/morph-select'
import './project-filter.css'

export function ProjectFilter({
    repositories,
    value,
    onValueChange
}: {
    repositories: Repository[]
    value: string
    onValueChange: (value: string) => void
}) {
    const names = new Map<string, number>()
    for (const repo of repositories) names.set(repo.name, (names.get(repo.name) ?? 0) + 1)
    const label = (repo: Repository) =>
        (names.get(repo.name) ?? 0) > 1
            ? `${repo.name} (${repo.path || repo.remote || repo.id})`
            : repo.name || 'Unnamed repository'
    const projects = repositories.filter((repository) => !repository.removed)
    return (
        <div className="project-filter">
            <MorphSelect
                portal
                label="Projects"
                hideLabel
                className="project-chip"
                variant="ghost"
                size="sm"
                searchable
                searchPlaceholder="Find a project…"
                panelWidth={280}
                maxTriggerWidth={144}
                animateTriggerWidth={false}
                title={projects.find((project) => project.id === value)?.name ?? 'All projects'}
                value={value}
                onValueChange={onValueChange}
                items={[
                    { value: 'all', label: 'All Projects' },
                    ...projects.map((project) => ({ value: project.id, label: label(project), keywords: project.path }))
                ]}
            />
        </div>
    )
}
