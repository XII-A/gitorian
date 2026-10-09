import type { Repository } from '../shared/model'
import { Select } from './components/arc/select/select'
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
            <Select
                label=""
                aria-label="Filter by project"
                className="project-chip"
                variant="ghost"
                contentMinWidth={240}
                value={value}
                onValueChange={onValueChange}
                options={[
                    { value: 'all', label: 'Projects', count: projects.length },
                    ...projects.map((project) => ({ value: project.id, label: project.name }))
                ]}
            />
        </div>
    )
}
