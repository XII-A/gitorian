import { GitBranch } from 'lucide-react'
import type { Activity } from '../shared/model'
import { activityBranches } from './activity-details'
import { Badge } from './components/arc/badge/badge'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

export function ActivityBranches({ activity, activities }: { activity: Activity; activities: Activity[] }) {
    const { primary, remaining, label } = activityBranches(activity, activities)
    return (
        <div className="hub-detail-branches">
            <dt>
                <GitBranch size={16} strokeWidth={1.5} aria-hidden="true" />
                {label}
            </dt>
            <dd>
                {primary ? <code className="hub-detail-primary-branch">{primary}</code> : 'No branch recorded'}
                {remaining.length > 0 && (
                    <Popover>
                        <PopoverTrigger
                            className="hub-detail-branch-trigger"
                            aria-label={`Show ${remaining.length} other ${remaining.length === 1 ? 'branch' : 'branches'}`}
                        >
                            <Badge size="sm" animateChanges={false}>
                                +{remaining.length}
                            </Badge>
                        </PopoverTrigger>
                        <PopoverContent className="hub-detail-branch-popover" aria-label="Other branches" align="end">
                            <h3>Other branches</h3>
                            <ScrollArea className="hub-detail-branch-scroll" label="Other branches" fade={16}>
                                <ul className="hub-detail-branch-list">
                                    {remaining.map((branch) => (
                                        <li key={branch}>
                                            <code>{branch}</code>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </PopoverContent>
                    </Popover>
                )}
            </dd>
        </div>
    )
}
