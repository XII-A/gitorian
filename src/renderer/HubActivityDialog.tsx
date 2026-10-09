import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { ArrowRight, GitBranch } from 'lucide-react'
import { localDate, type Activity, type State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

export interface HubActivityDialogHandle {
    open: (activity: Activity) => void
}

/** Detail selection/loading stays here so opening the dialog does not render the hub's activity list. */
export function HubActivityDialog({
    state,
    onActivity,
    ref
}: {
    state: State
    onActivity: (activity: Activity) => void
    ref: Ref<HubActivityDialogHandle>
}) {
    const [selected, setSelected] = useState<Activity>()
    const [details, setDetails] = useState<Activity>()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [attempt, setAttempt] = useState(0)
    useImperativeHandle(
        ref,
        () => ({
            open(activity) {
                setDetails(undefined)
                setError('')
                setBusy(true)
                setSelected(activity)
            }
        }),
        []
    )
    useEffect(() => {
        if (!selected) return
        let cancelled = false
        setBusy(true)
        setError('')
        // Details are read locally. The hub receives persisted changes on its next state refresh.
        void window.journal
            .invoke({ type: 'details', activityId: selected.id })
            .then((reply) => {
                if (!cancelled) setDetails(reply.state.activities.find((item) => item.id === selected.id))
            })
            .catch(() => {
                if (!cancelled) setError('Could not load activity details. Try again.')
            })
            .finally(() => {
                if (!cancelled) setBusy(false)
            })
        return () => {
            cancelled = true
        }
    }, [selected, attempt])
    const activity = details ?? selected
    const kind =
        activity &&
        { commit: 'Commit', pr: 'Pull request', review: 'Review', opened: 'Opened', merged: 'Merged' }[activity.kind]
    const date = activity && new Date(`${localDate(new Date(activity.date), state.settings.timezone)}T12:00:00`)
    return (
        <Dialog
            open={!!selected}
            onOpenChange={(open) => {
                if (!open) setSelected(undefined)
            }}
        >
            <DialogContent
                className="hub-detail-dialog"
                backdrop="dim"
                title={activity?.title ?? 'Activity details'}
                description={
                    activity
                        ? `${kind} in ${state.repositories.find((repo) => repo.id === activity.repositoryId)?.name ?? 'repository'}`
                        : undefined
                }
            >
                {activity && (
                    <>
                        <ScrollArea
                            className="hub-detail-scroll"
                            viewportClassName="hub-detail-viewport"
                            label="Activity details"
                            fade={16}
                        >
                            <div className="hub-detail-meta">
                                <span>
                                    <GitBranch size={14} aria-hidden="true" />
                                    {activity.branches.join(', ') || 'No branch'}
                                </span>
                                <span>
                                    {date?.toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        month: 'long',
                                        day: 'numeric',
                                        year: 'numeric'
                                    })}
                                </span>
                                <span>{activity.author}</span>
                            </div>
                            <p className="hub-detail-description">
                                {activity.description ||
                                    'Open the workspace to inspect the diff and add this change to your journal.'}
                            </p>
                            {busy ? (
                                <p role="status">Loading activity details…</p>
                            ) : error ? (
                                <div role="alert">
                                    <p>{error}</p>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setAttempt((value) => value + 1)}
                                    >
                                        Retry details
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <h3>Changed files</h3>
                                    {activity.files.length ? (
                                        <ul className="hub-detail-files">
                                            {activity.files.map((file) => (
                                                <li key={file.name}>
                                                    <span>{file.name}</span>
                                                    <small>{file.status}</small>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p>No changed files.</p>
                                    )}
                                </>
                            )}
                        </ScrollArea>
                        <footer className="hub-detail-footer">
                            <Button onClick={() => onActivity(activity)}>
                                Open in workspace
                                <ArrowRight size={15} aria-hidden="true" />
                            </Button>
                        </footer>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
