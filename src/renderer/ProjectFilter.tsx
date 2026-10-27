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
                    ...projects.map((project) => ({ value: project.id, label: project.name, keywords: project.path }))
                ]}
            />
        </div>
    )
}
