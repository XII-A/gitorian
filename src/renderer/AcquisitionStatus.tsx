import { Check, Clock3, GitBranch, Pause, Play, RefreshCw, ArrowUpRight, X } from 'lucide-react'
import { pauseReason, type SourceStatus } from '../shared/acquisition'
import { providerName, providerRemote } from '../shared/provider-accounts'
import type { Command, Reply, State } from '../shared/model'
import { activitySources } from './background-work'
import { ConfirmMorph, type ConfirmMorphState } from './components/arc/confirm-morph/confirm-morph'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent, DialogClose } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Tooltip } from './components/arc/tooltip/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from './components/arc/popover/popover'
import styles from './AcquisitionStatus.module.css'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Repository } from '../shared/model'

interface SourceAction {
    type: 'settings' | 'refresh' | 'stop' | 'locate'
    label: string
}
type SourceView =
    | { kind: 'error' | 'stopped' | 'running' | 'done'; label: string; action?: SourceAction }
    | { kind: 'waiting'; label: string; detail: string; action: SourceAction }

function sourceView(status: SourceStatus): SourceView {
    if (status.status === 'paused' && status.pauseReason === 'folder')
        return { kind: 'error', label: 'Folder not found', action: { type: 'locate', label: 'Locate folder' } }
    if (status.status === 'error') {
        const error = status.error ?? ''
        if (/choose or reconnect|account for this repository|no connected account|account not assigned/i.test(error))
            return {
                kind: 'error',
                label: 'No account selected',
                action: { type: 'settings', label: 'Choose account' }
            }
        if (/401|unauthorized|credentials|authentication|expired.*token|invalid.*token/i.test(error))
            return {
                kind: 'error',
                label: 'Authentication failed',
                action: { type: 'settings', label: 'Reconnect' }
            }
        if (/403|forbidden|permission|access denied/i.test(error))
            return {
                kind: 'error',
                label: 'Access denied',
                action: { type: 'settings', label: 'Check access' }
            }
        if (/404|not found|no longer available|does not exist/i.test(error))
            return {
                kind: 'error',
                label: 'Repository unavailable',
                action: { type: 'settings', label: 'Open settings' }
            }
        return {
            kind: 'error',
            label: 'Refresh interrupted',
            action: { type: 'refresh', label: 'Retry' }
        }
    }
    if (status.status === 'cancelled')
        return {
            kind: 'stopped',
            label: 'Stopped',
            action: { type: 'refresh', label: 'Resume' }
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
            action: { type: 'stop', label: 'Stop refresh' }
        }
    }
    if (status.status === 'running' || status.windowEnd)
        return {
            kind: 'running',
            label: 'Collecting activity',
            action: { type: 'stop', label: 'Stop refresh' }
        }
    return { kind: 'done', label: 'Refreshed' }
}
function entriesFor(state: State, stopped: Repository[]) {
    const sources = activitySources(state)
    for (const repository of stopped) sources.push([`git:${repository.id}`, { status: 'idle' }])
    return sources.map(([key, status]) => {
        const [source, repositoryId] = key.split(':')
        const repo = state.repositories.find((item) => item.id === repositoryId)
        const remote = repo && providerRemote(repo.remote)
        const view: SourceView = repo?.removed ? { kind: 'done', label: 'Tracking stopped' } : sourceView(status)
        return {
            key,
            source,
            repositoryId,
            repository: repo,
            trackingStopped: !!repo?.removed,
            name: repo?.name ?? 'Notion journal',
            provider:
                source === 'notion'
                    ? 'Notion'
                    : source === 'git'
                      ? 'Local Git'
                      : remote
                        ? providerName(remote.provider)
                        : 'Remote',
            view
        }
    })
}
type Entry = ReturnType<typeof entriesFor>[number]
const rowOrder = ['error', 'running', 'waiting', 'stopped', 'done']
const progressOrder = ['done', 'running', 'waiting', 'stopped', 'error']
function StatusMark({ entry }: { entry: Entry }) {
    const view = entry.view
    const kind = view.kind
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
    if (view.kind === 'waiting')
        return (
            <Popover>
                <PopoverTrigger
                    className={styles.statusTrigger}
                    aria-label={`${entry.name}: ${entry.view.label}. Show reason`}
                >
                    {mark}
                </PopoverTrigger>
                <PopoverContent className={styles.reason}>{view.detail}</PopoverContent>
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
    const [stoppedRepositories, setStoppedRepositories] = useState<Repository[]>([])
    const stopped = stoppedRepositories.filter(
        (repository) => state.repositories.find((r) => r.id === repository.id)?.removed
    )
    const [busy, setBusy] = useState('')
    const [morph, setMorph] = useState<{ id: string; state: ConfirmMorphState }>()
    const confirmation = morph && ['confirming', 'pending', 'error'].includes(morph.state) ? morph.id : undefined
    const confirmationControls = useRef(new Map<string, HTMLDivElement>())
    const returnConfirmationFocus = useRef<string | undefined>(undefined)
    const pending = useRef(false)
    const header = useRef<HTMLElement>(null)
    const [focusTarget, setFocusTarget] = useState<string>()
    useLayoutEffect(() => {
        if (!focusTarget || !open) return
        const rows = header.current
            ?.closest('[role="dialog"]')
            ?.querySelectorAll<HTMLElement>('[data-resolved-repository]')
        const target = Array.from(rows ?? []).find((row) => row.dataset.resolvedRepository === focusTarget)
        if (target) {
            target.focus()
            setFocusTarget(undefined)
        }
    }, [focusTarget, open, state])
    const repositoryAction = async (id: string, operation: () => Promise<Reply | undefined>) => {
        if (pending.current) return
        pending.current = true
        setBusy(id)
        try {
            return await operation()
        } finally {
            pending.current = false
            setBusy('')
        }
    }
    const entries = entriesFor(state, stopped)
    const done = entries.filter((entry) => entry.view.kind === 'done').length
    const active = entries.some((entry) => entry.view.kind === 'running' || entry.view.kind === 'waiting')
    const failed = entries.filter((entry) => entry.view.kind === 'error')
    const local = entries.filter((entry) => entry.source === 'git' && !entry.trackingStopped)
    const localComplete = local.length > 0 && local.every((entry) => entry.view.kind === 'done')
    const act = (entry: Entry) => {
        const action = entry.view.action
        if (!action) return
        switch (action.type) {
            case 'locate':
                return repositoryAction(entry.repositoryId, () => run({ type: 'relocate', id: entry.repositoryId }))
            case 'settings':
                onSettings()
                return
            case 'stop':
                if (entry.source === 'notion') return
                return run({
                    type: 'stopWork',
                    source: entry.source === 'git' ? 'git' : 'remote',
                    repositoryId: entry.repositoryId
                })
            case 'refresh':
                return run({
                    type: 'refresh',
                    source: entry.source === 'git' ? 'git' : entry.source === 'notion' ? 'notion' : 'remote',
                    repositoryId: entry.repositoryId
                })
        }
    }
    const stopTracking = async (repository: Repository) => {
        const reply = await repositoryAction(repository.id, () =>
            run({ type: 'repositoryTracking', id: repository.id, tracked: false })
        )
        if (!reply) throw new Error('Tracking could not be stopped')
        setStoppedRepositories((current) => [...current.filter((r) => r.id !== repository.id), repository])
        setFocusTarget(repository.id)
    }
    const renderAction = (entry: Entry) => {
        const action = entry.view.action
        if (!action || (entry.source === 'notion' && action.type === 'stop')) return null
        if (action.type === 'stop')
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
                disabled={action.type === 'locate' && (!!busy || confirmation === entry.repositoryId)}
                data-recovery-id={action.type === 'locate' ? entry.repositoryId : undefined}
                data-recovery-action={action.type === 'locate' ? action.type : undefined}
                animateContent={false}
            >
                {entry.view.kind === 'stopped' ? (
                    <Play size={12} />
                ) : action.type !== 'refresh' ? null : (
                    <RefreshCw size={13} />
                )}
                {action.label}
                {action.type === 'settings' && <ArrowUpRight size={13} />}
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
                onEscapeKeyDown={(event) => {
                    if (morph?.state === 'confirming' || morph?.state === 'error') {
                        event.preventDefault()
                        returnConfirmationFocus.current = morph.id
                        setMorph({ id: morph.id, state: 'idle' })
                    }
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    const trigger =
                        document.querySelector<HTMLButtonElement>('[data-source-status]') ??
                        document.querySelector<HTMLButtonElement>('[aria-label="Refresh activity"]')
                    trigger?.focus()
                }}
            >
                <header className={styles.header} ref={header}>
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
                    stopped.length ? null : (
                        <div className={styles.empty}>
                            <GitBranch size={28} strokeWidth={1.5} aria-hidden="true" />
                            <h3>Start with a repository</h3>
                            <p>Your local and remote activity will appear here.</p>
                            <Button variant="secondary" onClick={onSettings}>
                                Add repository
                            </Button>
                        </div>
                    )
                ) : (
                    <>
                        <div className={styles.overview}>
                            <div className={styles.overviewLine}>
                                <span>
                                    {active
                                        ? 'Refreshing your week'
                                        : done === entries.length
                                          ? stopped.length
                                              ? 'All issues resolved'
                                              : 'Everything is up to date'
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
                                aria-label={stopped.length ? 'Sources resolved' : 'Sources refreshed'}
                                aria-valuenow={done}
                                aria-valuemin={0}
                                aria-valuemax={entries.length}
                                aria-valuetext={`${done} of ${entries.length} sources ${stopped.length ? 'resolved' : 'refreshed'}`}
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
                                    .filter(
                                        (entry) => !(localComplete && entry.source === 'git' && !entry.trackingStopped)
                                    )
                                    .sort((a, b) => rowOrder.indexOf(a.view.kind) - rowOrder.indexOf(b.view.kind))
                                    .map((entry) => (
                                        <article
                                            className={styles.row}
                                            data-kind={entry.view.kind}
                                            key={entry.key}
                                            tabIndex={entry.trackingStopped ? -1 : undefined}
                                            data-resolved-repository={
                                                entry.trackingStopped ? entry.repositoryId : undefined
                                            }
                                            aria-label={`${entry.name} / ${entry.provider}`}
                                        >
                                            <StatusMark entry={entry} />
                                            <div className={styles.identity}>
                                                <h3>
                                                    <bdi>{entry.name}</bdi>
                                                </h3>
                                                <p role={entry.trackingStopped ? 'status' : undefined}>
                                                    {entry.view.kind === 'error' || entry.trackingStopped
                                                        ? `${entry.provider} · ${entry.view.label}`
                                                        : entry.provider}
                                                </p>
                                                {entry.view.action?.type === 'locate' && (
                                                    <p className={styles.path}>
                                                        {entry.repository?.path || 'Folder not located'}
                                                    </p>
                                                )}
                                            </div>
                                            {entry.view.action?.type === 'locate' && entry.repository ? (
                                                <div className={styles.actions}>
                                                    {renderAction(entry)}
                                                    <ConfirmMorph
                                                        ref={(node) => {
                                                            if (node)
                                                                confirmationControls.current.set(
                                                                    entry.repositoryId,
                                                                    node
                                                                )
                                                            else confirmationControls.current.delete(entry.repositoryId)
                                                        }}
                                                        label="Stop tracking"
                                                        prompt={
                                                            <span className={styles.confirmPrompt}>Stop tracking?</span>
                                                        }
                                                        confirmLabel="Confirm"
                                                        confirmMode="hold"
                                                        tone="danger"
                                                        variant={
                                                            morph?.id === entry.repositoryId && morph.state !== 'idle'
                                                                ? 'secondary'
                                                                : 'ghost'
                                                        }
                                                        pendingLabel="Stopping tracking"
                                                        doneLabel="Tracking stopped"
                                                        errorLabel="Could not stop tracking"
                                                        errorCancelLabel="Cancel"
                                                        disabled={!!busy}
                                                        state={morph?.id === entry.repositoryId ? morph.state : 'idle'}
                                                        onWidthSettled={(face) => {
                                                            if (
                                                                face !== 'idle' ||
                                                                returnConfirmationFocus.current !== entry.repositoryId
                                                            )
                                                                return
                                                            const button = confirmationControls.current
                                                                .get(entry.repositoryId)
                                                                ?.querySelector<HTMLButtonElement>(
                                                                    '[data-face="idle"]:not([inert]) button'
                                                                )
                                                            if (button) {
                                                                returnConfirmationFocus.current = undefined
                                                                button.focus({ preventScroll: true })
                                                            }
                                                        }}
                                                        onStateChange={(next) =>
                                                            setMorph(
                                                                next === 'done'
                                                                    ? undefined
                                                                    : { id: entry.repositoryId, state: next }
                                                            )
                                                        }
                                                        onConfirm={() => stopTracking(entry.repository!)}
                                                    />
                                                </div>
                                            ) : (
                                                renderAction(entry)
                                            )}
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
