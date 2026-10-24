import { useId } from 'react'
import { Folder, GitCommitHorizontal, GitPullRequest, GitBranch } from 'lucide-react'

const rows = [
    { id: 'commit', Icon: GitCommitHorizontal },
    { id: 'pull-request', Icon: GitPullRequest },
    { id: 'review', Icon: GitBranch }
]

/** A static illustration of the destination, separate from loading states and real journal records. */
export function OnboardingActivityPreview() {
    const heading = useId()
    return (
        <section className="hub-activity-preview" aria-labelledby={heading}>
            <div className="hub-preview-heading">
                <h2 id={heading}>Activity this week</h2>
                <p>Your commits, pull requests, and reviews will appear here.</p>
            </div>
            <div className="hub-preview-illustration" aria-hidden="true" inert>
                <div className="hub-preview-timeline">
                    <div className="hub-preview-filters">
                        {rows.map(({ id }) => (
                            <span className="hub-preview-filter" data-kind={id} key={id}>
                                <span className="hub-preview-filter-label" />
                                <span className="hub-preview-filter-count" />
                            </span>
                        ))}
                    </div>
                    {rows.map(({ id, Icon }) => (
                        <div className="hub-preview-row" data-kind={id} key={id}>
                            <span className="hub-preview-node">
                                <Icon size={14} strokeWidth={1.75} />
                            </span>
                            <div className="hub-preview-copy">
                                <span className="hub-preview-line hub-preview-title" />
                                <span className="hub-preview-line hub-preview-meta" />
                            </div>
                            <span className="hub-preview-reference" />
                        </div>
                    ))}
                </div>
                <div className="hub-preview-projects">
                    <span className="hub-preview-line hub-preview-project-heading" />
                    {rows.map(({ id }) => (
                        <div className="hub-preview-project" key={id}>
                            <Folder size={15} strokeWidth={1.75} />
                            <span className="hub-preview-line" />
                            <span className="hub-preview-reference" />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
