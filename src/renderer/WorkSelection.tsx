import { useState } from 'react'
import { GitCommitHorizontal, GitPullRequest, GitMerge } from 'lucide-react'
import type { Activity, Draft, State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Checkbox } from './components/arc/checkbox/checkbox'
import SegmentedControl from './components/arc/segmented-control/segmented-control'

interface Props {
    items: Activity[]
    state: State
    draft?: Draft
    selectedId: string
    pending: boolean
    onInspect: (item: Activity) => Promise<void>
    onSelection: (items: Activity[], included: boolean) => Promise<void>
}

export function WorkSelection({ items, state, draft, selectedId, pending, onInspect, onSelection }: Props) {
    const [view, setView] = useState('all')
    const selected = new Set(draft?.selections.map((item) => item.activityId))
    const included = items.filter((item) => selected.has(item.id))
    const excluded = items.filter((item) => !selected.has(item.id))
    const visible = view === 'included' ? included : view === 'excluded' ? excluded : items
    const canSelect = !!draft && !draft.publishedEntryId && !pending
    return (
        <div className="work-selection" aria-busy={pending}>
            <div className="work-selection-toolbar">
                <SegmentedControl
                    label="Work in this draft"
                    value={view}
                    onValueChange={setView}
                    options={[
                        { value: 'all', label: 'All', accessory: <span>{items.length}</span> },
                        { value: 'included', label: 'Included', accessory: <span>{included.length}</span> },
                        { value: 'excluded', label: 'Excluded', accessory: <span>{excluded.length}</span> }
                    ]}
                />
                <p className="work-selection-help">Check to include. Open a title to review changes.</p>
                {!draft && <p className="work-selection-help">Create a draft to start choosing work.</p>}
                {draft?.publishedEntryId && (
                    <p className="work-selection-help">
                        This entry is published. Create a new draft to change its included work.
                    </p>
                )}
                <div className="work-bulk-actions">
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canSelect || !visible.some((item) => !selected.has(item.id))}
                        onClick={() =>
                            onSelection(
                                visible.filter((item) => !selected.has(item.id)),
                                true
                            )
                        }
                    >
                        Include visible
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canSelect || !visible.some((item) => selected.has(item.id))}
                        onClick={() =>
                            onSelection(
                                visible.filter((item) => selected.has(item.id)),
                                false
                            )
                        }
                    >
                        Exclude visible
                    </Button>
                </div>
            </div>
            <div className="activity-list" role="list" aria-label="Git activity">
                {visible.map((item) => {
                    const Icon =
                        item.kind === 'commit'
                            ? GitCommitHorizontal
                            : item.kind === 'merged'
                              ? GitMerge
                              : GitPullRequest
                    return (
                        <div
                            role="listitem"
                            className={`work-row ${selectedId === item.id ? 'inspecting' : ''}`}
                            key={item.id}
                            data-included={selected.has(item.id)}
                        >
                            <Checkbox
                                aria-label={`Include ${item.title} in draft`}
                                checked={selected.has(item.id)}
                                disabled={!canSelect}
                                onCheckedChange={(value) => {
                                    void onSelection([item], value === true)
                                }}
                            />
                            <Button
                                variant="ghost"
                                contentLayout="stack"
                                className="work-row-inspect"
                                aria-pressed={selectedId === item.id}
                                onClick={() => onInspect(item)}
                            >
                                <span className="git-work-title">
                                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                                    <span>{item.title}</span>
                                </span>
                                <span className="git-work-meta">
                                    <span>
                                        {state.repositories.find((repo) => repo.id === item.repositoryId)?.name ??
                                            'Removed project'}
                                    </span>
                                    <code>
                                        {item.kind === 'commit'
                                            ? item.sha?.slice(0, 7)
                                            : item.prId
                                              ? '#' + (item.prId.split('/').at(-1) ?? '')
                                              : item.kind}
                                    </code>
                                    <time dateTime={item.date}>
                                        {new Date(item.date).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            timeZone: state.settings.timezone
                                        })}
                                    </time>
                                </span>
                                <span className="git-work-branch" title={item.branches.join(', ')}>
                                    {item.branches[0]}
                                </span>
                            </Button>
                        </div>
                    )
                })}
                {!visible.length && (
                    <div className="work-empty">
                        <p>
                            {view === 'included'
                                ? 'No work included yet'
                                : view === 'excluded'
                                  ? 'All matching work is included'
                                  : 'No matching work'}
                        </p>
                        <span>
                            {view === 'included'
                                ? 'Choose work from All to link it to this draft.'
                                : view === 'excluded'
                                  ? 'Switch to Included to review your selection.'
                                  : 'Try another project, search, or week.'}
                        </span>
                    </div>
                )}
            </div>
            <p className="work-selection-status" role="status">
                {pending
                    ? 'Saving your selection…'
                    : `${selected.size} included in this draft. Unchecked work is excluded.`}
            </p>
        </div>
    )
}
