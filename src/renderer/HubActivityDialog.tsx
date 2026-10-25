import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { ArrowRight, ExternalLink, GitCommitHorizontal, GitPullRequest } from 'lucide-react'
import { type Activity, type State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Badge } from './components/arc/badge/badge'
import { ActivityDetails } from './ActivityDetails'
import { PullRequestStatus } from './PullRequestLifecycle'
import { isPullRequest } from './pull-request'
import './activity-details.css'
import { hasFileStatistics } from '../shared/change-statistics'

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
    const [isOpen, setIsOpen] = useState(false)
    const [selected, setSelected] = useState<Activity>()
    const [details, setDetails] = useState<Activity>()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [attempt, setAttempt] = useState(0)
    const loadedDetails = useRef(new Map<string, Activity>())
    const returnFocus = useRef<HTMLElement | null>(null)
    useImperativeHandle(
        ref,
        () => ({
            open(activity) {
                returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
                const previous = loadedDetails.current.get(activity.id)
                const cached = hasFileStatistics(activity)
                    ? activity
                    : previous &&
                        hasFileStatistics(previous) &&
                        previous.sourceVersion === activity.sourceVersion &&
                        previous.sha === activity.sha
                      ? previous
                      : undefined
                setDetails(cached)
                setError('')
                setBusy(!cached)
                setSelected(cached ?? activity)
                setIsOpen(true)
            }
        }),
        []
    )
    useEffect(() => {
        if (!isOpen || !selected) return
        if (hasFileStatistics(selected)) {
            setDetails(selected)
            setBusy(false)
            return
        }
        let cancelled = false
        setBusy(true)
        setError('')
        // The hub needs file metadata, not a full patch or revision capture.
        void window.journal
            .invoke({ type: 'details', activityId: selected.id, content: 'files' })
            .then((reply) => {
                if (!cancelled) {
                    const activity = reply.state.activities.find((item) => item.id === selected.id)
                    setDetails(activity)
                    if (activity && hasFileStatistics(activity) && !reply.detailError) {
                        if (loadedDetails.current.size >= 32)
                            loadedDetails.current.delete(loadedDetails.current.keys().next().value!)
                        loadedDetails.current.set(activity.id, activity)
                    }
                    setError(reply.detailError ?? '')
                }
            })
            .catch((failure: unknown) => {
                if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
            })
            .finally(() => {
                if (!cancelled) setBusy(false)
            })
        return () => {
            cancelled = true
        }
    }, [isOpen, selected, attempt])
    const loaded = details ?? selected
    // Loaded files belong to the stored record; keep the hub's date-range placement and unified PR type.
    const activity =
        loaded && selected && isPullRequest(selected)
            ? { ...loaded, kind: 'pr' as const, title: selected.title, date: selected.date }
            : loaded
    const kind = activity?.kind === 'commit' ? 'Commit' : 'Review'
    const pullNumber = activity?.prId?.match(/(?:^|[:/])(\d+)$/)?.[1]
    const reference =
        activity?.kind === 'commit' ? activity.sha?.slice(0, 7) : pullNumber ? `#${pullNumber}` : undefined
    const Icon = activity?.kind === 'commit' ? GitCommitHorizontal : GitPullRequest
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent
                className="hub-detail-dialog"
                backdrop="dim"
                title={activity?.title ?? 'Activity details'}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    returnFocus.current?.focus()
                }}
                aria-describedby={undefined}
                headerContent={
                    activity && (
                        <>
                            {isPullRequest(activity) ? (
                                <PullRequestStatus activity={activity} activities={state.activities} />
                            ) : (
                                <Badge
                                    animateChanges={false}
                                    icon={<Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
                                >
                                    {kind}
                                </Badge>
                            )}
                            {reference && (
                                <Badge animateChanges={false}>
                                    <code title={activity.sha}>{reference}</code>
                                </Badge>
                            )}
                        </>
                    )
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
                            <ActivityDetails
                                activity={activity}
                                state={state}
                                loading={busy}
                                error={error}
                                onRetry={() => setAttempt((value) => value + 1)}
                            />
                        </ScrollArea>
                        <footer className="hub-detail-footer">
                            {activity.url && (
                                <a
                                    className="hub-detail-source-link"
                                    href={activity.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    View on GitHub
                                    <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
                                </a>
                            )}
                            <Button
                                onClick={() => {
                                    setIsOpen(false)
                                    onActivity(activity)
                                }}
                            >
                                Open in workspace
                                <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
                            </Button>
                        </footer>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
