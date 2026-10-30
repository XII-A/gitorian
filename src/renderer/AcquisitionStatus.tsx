import { Check, Clock3, GitBranch, Pause, Play, RefreshCw, ArrowUpRight, X } from 'lucide-react'
import { pauseReason, type SourceStatus } from '../shared/acquisition'
import { providerName, providerRemote } from '../shared/provider-accounts'
import type { Command, Reply, State } from '../shared/model'
import { activitySources } from './background-work'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent, DialogClose } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Tooltip } from './components/arc/tooltip/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from './components/arc/popover/popover'
import styles from './AcquisitionStatus.module.css'

function sourceView(status: SourceStatus) {
    if (status.status === 'error') {
        const error = status.error ?? ''
        if (/choose or reconnect|account for this repository|no connected account|account not assigned/i.test(error))
            return {
                kind: 'error',
                label: 'No account selected',
                detail: 'Choose a connected account for this repository.',
                action: 'Choose account'
            }
        if (/401|unauthorized|credentials|authentication|expired.*token|invalid.*token/i.test(error))
            return {
                kind: 'error',
                label: 'Authentication failed',
                detail: 'Reconnect your account to collect remote activity.',
                action: 'Reconnect'
            }
        if (/403|forbidden|permission|access denied/i.test(error))
            return {
                kind: 'error',
                label: 'Access denied',
                detail: 'Check that your account has access to this repository in Settings.',
                action: 'Check access'
            }
        if (/404|not found|no longer available|does not exist/i.test(error))
            return {
                kind: 'error',
                label: 'Repository unavailable',
                detail: 'Check the repository location and account access in Settings.',
                action: 'Open settings'
            }
        return {
            kind: 'error',
            label: 'Refresh interrupted',
            detail: 'Could not collect activity. Try this source again.',
            action: 'Retry'
        }
    }
    if (status.status === 'cancelled')
        return {
            kind: 'stopped',
            label: 'Stopped',
            detail: 'Resume to collect the remaining activity.',
            action: 'Resume'
        }
    if (status.status === 'paused') {
        const reason = pauseReason(status)
        return {
            kind: 'waiting',
            label: reason === 'queue' ? 'Queued' : reason === 'connection' ? 'Reconnecting' : 'Waiting to resume',
            detail:
                reason === 'queue'
                    ? 'Starts automatically when another repository finishes.'
                    : reason === 'connection'
                      ? 'Connection interrupted. Retrying automatically.'
                      : reason === 'allowance'
                        ? 'Taking a short break between requests. Resumes automatically.'
                        : 'The provider is limiting requests. Resumes automatically when available.',
            action: 'Stop refresh'
        }
    }
    if (status.status === 'running' || status.windowEnd)
        return {
            kind: 'running',
            label: 'Collecting activity',
            detail: 'Collecting activity in the background.',
            action: 'Stop refresh'
        }
    return { kind: 'done', label: 'Refreshed', detail: 'Latest refresh complete.', action: '' }
}
function entriesFor(state: State) {
    return activitySources(state).map(([key, status]) => {
        const [source, repositoryId] = key.split(':')
        const repo = state.repositories.find((item) => item.id === repositoryId)
        const remote = repo && providerRemote(repo.remote)
        return {
            key,
            source,
            repositoryId,
            name: repo?.name ?? 'Notion journal',
            provider:
                source === 'notion'
                    ? 'Notion'
                    : source === 'git'
                      ? 'Local Git'
                      : remote
                        ? providerName(remote.provider)
                        : 'Remote',
            view: sourceView(status)
        }
    })
}
type Entry = ReturnType<typeof entriesFor>[number]
const rowOrder = ['error', 'running', 'waiting', 'stopped', 'done']
const progressOrder = ['done', 'running', 'waiting', 'stopped', 'error']
function StatusMark({ entry }: { entry: Entry }) {
    const kind = entry.view.kind
    const mark = (
        <span className={styles.mark} data-kind={kind} role="img" aria-label={entry.view.label}>
            {kind === 'done' ? (
                <Check size={13} strokeWidth={2} aria-hidden="true" />
            ) : kind === 'error' ? (
                <span aria-hidden="true">!</span>
            ) : kind === 'stopped' ? (
                <Pause size={12} aria-hidden="true" />
            ) : kind === 'waiting' ? (
                <Clock3 size={15} strokeWidth={1.5} aria-hidden="true" />
            ) : (
                <span className={styles.orbit} aria-hidden="true" />
            )}
        </span>
    )
    if (kind === 'waiting')
        return (
            <Popover>
                <PopoverTrigger
                    className={styles.statusTrigger}
                    aria-label={`${entry.name}: ${entry.view.label}. Show reason`}
                >
                    {mark}
                </PopoverTrigger>
                <PopoverContent className={styles.reason}>{entry.view.detail}</PopoverContent>
            </Popover>
        )
    return <Tooltip content={entry.view.label}>{mark}</Tooltip>
}
export function AcquisitionStatus({
    state,
    run,
    open,
    onOpenChange,
    onSettings
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    open: boolean
    onOpenChange: (open: boolean) => void
    onSettings: () => void
}) {
    const entries = entriesFor(state)
    const done = entries.filter((entry) => entry.view.kind === 'done').length
    const active = entries.some((entry) => entry.view.kind === 'running' || entry.view.kind === 'waiting')
    const failed = entries.filter((entry) => entry.view.kind === 'error')
    const local = entries.filter((entry) => entry.source === 'git')
    const localComplete = local.length > 0 && local.every((entry) => entry.view.kind === 'done')
    const act = (entry: Entry) => {
        if (entry.view.kind === 'error' && entry.view.action !== 'Retry') {
            onSettings()
            return
        }
        if (entry.view.action === 'Stop refresh' && entry.source !== 'notion')
            return run({
                type: 'stopWork',
                source: entry.source === 'git' ? 'git' : 'remote',
                repositoryId: entry.repositoryId
            })
        return run({
            type: 'refresh',
            source: entry.source === 'git' ? 'git' : entry.source === 'notion' ? 'notion' : 'remote',
            repositoryId: entry.repositoryId
        })
    }
    const action = (entry: Entry) => {
        if (!entry.view.action || (entry.source === 'notion' && entry.view.action === 'Stop refresh')) return null
        if (entry.view.kind === 'running' || entry.view.kind === 'waiting')
            return (
                <Tooltip content="Stop refresh">
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Stop refresh for ${entry.name}`}
                        onClick={() => act(entry)}
                        animateContent={false}
                    >
                        <Pause size={14} strokeWidth={1.5} />
                    </Button>
                </Tooltip>
            )
        return (
            <Button
                variant={entry.key === failed[0]?.key ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => act(entry)}
                animateContent={false}
            >
                {entry.view.kind === 'stopped' ? (
                    <Play size={12} />
                ) : entry.view.action !== 'Retry' ? null : (
                    <RefreshCw size={13} />
                )}
                {entry.view.action}
                {entry.view.kind === 'error' && entry.view.action !== 'Retry' && <ArrowUpRight size={13} />}
            </Button>
        )
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                title="Activity sources"
                hideHeader
                backdrop="dim"
                className={styles.dialog}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    const trigger =
                        document.querySelector<HTMLButtonElement>('[data-source-status]') ??
                        document.querySelector<HTMLButtonElement>('[aria-label="Refresh activity"]')
                    trigger?.focus()
                }}
            >
                <header className={styles.header}>
                    <div className={styles.headerIdentity}>
                        <RefreshCw size={19} strokeWidth={1.5} aria-hidden="true" />
                        <h2>Activity sync</h2>
                    </div>
                    <DialogClose asChild>
                        <Button variant="ghost" size="sm" aria-label="Close dialog" animateContent={false}>
                            <X size={18} strokeWidth={1.5} />
                        </Button>
                    </DialogClose>
                </header>
                {!entries.length ? (
                    <div className={styles.empty}>
                        <GitBranch size={28} strokeWidth={1.5} aria-hidden="true" />
                        <h3>Start with a repository</h3>
                        <p>Your local and remote activity will appear here.</p>
                        <Button variant="secondary" onClick={onSettings}>
                            Add repository
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className={styles.overview}>
                            <div className={styles.overviewLine}>
                                <span>
                                    {active
                                        ? 'Refreshing your week'
                                        : done === entries.length
                                          ? 'Everything is up to date'
                                          : failed.length
                                            ? 'Refresh incomplete'
                                            : 'Refresh paused'}
                                </span>
                                <span className={styles.count}>
                                    <strong>{done}</strong> / {entries.length}
                                    <span> sources</span>
                                </span>
                            </div>
                            <div
                                className={styles.progress}
                                role="progressbar"
                                aria-label="Sources refreshed"
                                aria-valuenow={done}
                                aria-valuemin={0}
                                aria-valuemax={entries.length}
                                aria-valuetext={`${done} of ${entries.length} sources refreshed`}
                            >
                                {[...entries]
                                    .sort(
                                        (a, b) =>
                                            progressOrder.indexOf(a.view.kind) - progressOrder.indexOf(b.view.kind)
                                    )
                                    .map((entry) => (
                                        <span key={entry.key} data-kind={entry.view.kind} />
                                    ))}
                            </div>
                        </div>
                        <ScrollArea
                            maxHeight="min(54vh, 480px, calc(100dvh - 200px))"
                            label="Activity source progress"
                            fade={12}
                        >
                            <div className={styles.queue}>
                                {entries
                                    .filter((entry) => !(localComplete && entry.source === 'git'))
                                    .sort((a, b) => rowOrder.indexOf(a.view.kind) - rowOrder.indexOf(b.view.kind))
                                    .map((entry) => (
                                        <article
                                            className={styles.row}
                                            data-kind={entry.view.kind}
                                            key={entry.key}
                                            aria-label={`${entry.name} / ${entry.provider}`}
                                        >
                                            <StatusMark entry={entry} />
                                            <div className={styles.identity}>
                                                <h3>
                                                    <bdi>{entry.name}</bdi>
                                                </h3>
                                                <p>
                                                    {entry.view.kind === 'error'
                                                        ? `${entry.provider} · ${entry.view.label}`
                                                        : entry.provider}
                                                </p>
                                            </div>
                                            {action(entry)}
                                        </article>
                                    ))}
                                {localComplete && (
                                    <div className={styles.localSummary}>
                                        <StatusMark entry={local[0]} />
                                        <div>
                                            <span>Local Git</span>
                                            <span>
                                                {local.length} {local.length === 1 ? 'repository' : 'repositories'}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
