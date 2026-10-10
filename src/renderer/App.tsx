import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command, Reply } from '../shared/model'
import { WeeklyHub } from './WeeklyHub'
import { Settings } from './Settings'
import { CommandMenu } from './components/CommandMenu'
import { Button } from './components/arc/button/button'
import { Workspace } from './Workspace'
import { WorkspaceReference } from './WorkspaceReference'
import { localDate, weekOf } from '../shared/model'
import type { Activity } from '../shared/model'
import { journalWeek } from './hub-model'
import { AcquisitionStatus } from './AcquisitionStatus'
import { unchangedStateReply } from './activity-cache'

export function App() {
    const [screen, setScreen] = useState<'hub' | 'workspace'>('hub')
    const [reply, setReply] = useState<Reply>()
    const [remotes, setRemotes] = useState<Record<string, string[]>>({})
    const [error, setError] = useState('')
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(false)
    const [workspaceWeek, setWorkspaceWeek] = useState('')
    const [workspaceActivity, setWorkspaceActivity] = useState<string>()
    const [reference, setReference] = useState<{ kind: string; id: string }>()
    const [dismissedImport, setDismissedImport] = useState('')
    const polling = useRef(false)
    const currentReply = useRef(reply)
    currentReply.current = reply
    const run = useCallback(async (command: Command): Promise<Reply | undefined> => {
        try {
            const result = await window.journal.invoke(command)
            setReply((current) => {
                if (unchangedStateReply(current, result, command)) return current
                if (
                    current?.state.restoreId === result.state.restoreId &&
                    (current?.state.snapshotVersion ?? 0) > (result.state.snapshotVersion ?? 0)
                )
                    return current
                const diffs = current?.state.restoreId === result.state.restoreId ? { ...current?.state.diffs } : {}
                if (command.type === 'details' && result.diff !== undefined) diffs[command.activityId] = result.diff
                return { ...result, state: { ...result.state, diffs: { ...diffs, ...result.state.diffs } } }
            })
            if ('remotes' in result) {
                const next = result.remotes as Record<string, string[]>
                setRemotes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
            }
            setError('')
            return result
        } catch (failure) {
            setError(String(failure))
            return undefined
        }
    }, [])
    useEffect(() => {
        const parameters = new URLSearchParams(window.location.search)
        const referenceKind = parameters.get('reference')
        const referenceId = parameters.get('id')
        if (referenceKind && referenceId) setReference({ kind: referenceKind, id: referenceId })
        const requestedWeek = parameters.get('week')
        if (
            requestedWeek &&
            /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) &&
            !Number.isNaN(new Date(`${requestedWeek}T12:00:00Z`).getTime())
        )
            setWorkspaceWeek(requestedWeek)
        if (parameters.has('workspace') || parameters.has('reference')) setScreen('workspace')
        void run({ type: 'state' })
        let lastPoll = Date.now()
        const timer = setInterval(() => {
            if (polling.current) return
            const state = currentReply.current?.state
            const active =
                state?.repositoryImport?.status === 'running' ||
                Object.values(state?.acquisition ?? {}).some(
                    (status) => status.status === 'running' || status.windowEnd
                )
            if (!active && Date.now() - lastPoll < 15000) return
            lastPoll = Date.now()
            polling.current = true
            void run({ type: 'state' }).finally(() => {
                polling.current = false
            })
        }, 2000)
        return () => clearInterval(timer)
    }, [run])
    useEffect(() => {
        const keyboard = (event: KeyboardEvent) => {
            const editing =
                event.target instanceof HTMLElement &&
                !!event.target.closest(
                    'input, textarea, [contenteditable="true"], [role="dialog"], [role="listbox"], [role="tree"]'
                )
            if (
                event.key === 'Escape' &&
                !event.defaultPrevented &&
                !editing &&
                !reference &&
                screen === 'workspace' &&
                !settingsOpen &&
                !commandsOpen
            )
                setScreen('hub')
            if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === 'k' &&
                !settingsOpen &&
                !editing &&
                !reference
            ) {
                event.preventDefault()
                setCommandsOpen((open) => !open)
            }
        }
        window.addEventListener('keydown', keyboard)
        return () => window.removeEventListener('keydown', keyboard)
    }, [screen, settingsOpen, commandsOpen, reference])
    const openWorkspace = (date?: string) => {
        setWorkspaceWeek(date ?? (reply ? weekOf(new Date(), reply.state.settings) : ''))
        setWorkspaceActivity(undefined)
        setScreen('workspace')
        window.scrollTo(0, 0)
    }
    const openActivity = (activity: Activity) => {
        if (!reply) return
        openWorkspace(
            journalWeek(
                localDate(new Date(activity.date), reply.state.settings.timezone),
                reply.state.settings.weekStart
            )
        )
        setWorkspaceActivity(activity.id)
    }
    const backToHub = (week?: string) => {
        if (week) setWorkspaceWeek(week)
        const url = new URL(window.location.href)
        for (const key of ['workspace', 'variant', 'data', 'week']) url.searchParams.delete(key)
        window.history.replaceState({}, '', url)
        setScreen('hub')
    }
    return (
        <>
            <div>
                {reply && !reference && <AcquisitionStatus state={reply.state} run={run} />}
                {!reference &&
                    reply?.state.repositoryImport &&
                    (reply.state.repositoryImport.status === 'running' ||
                        dismissedImport !== reply.state.repositoryImport.message) && (
                        <div className="acquisition-notice" role="status">
                            {reply.state.repositoryImport.status === 'running'
                                ? `Importing repositories ${reply.state.repositoryImport.completed}/${reply.state.repositoryImport.total || '…'}. You can keep writing.`
                                : reply.state.repositoryImport.message}
                            {reply.state.repositoryImport.status === 'running' ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => run({ type: 'stopWork', source: 'repositories' })}
                                >
                                    Stop import
                                </Button>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDismissedImport(reply.state.repositoryImport?.message ?? '')}
                                >
                                    Dismiss
                                </Button>
                            )}
                        </div>
                    )}
            </div>
            {reference && reply ? (
                <WorkspaceReference state={reply.state} run={run} kind={reference.kind} id={reference.id} />
            ) : screen === 'workspace' && reply ? (
                <Workspace
                    state={reply.state}
                    notionConnected={reply.connections.notion}
                    run={run}
                    error={error}
                    initialWeek={workspaceWeek || weekOf(new Date(), reply.state.settings)}
                    initialActivity={workspaceActivity}
                    onBack={backToHub}
                    onSettings={() => setSettingsOpen(true)}
                />
            ) : reply && !reference ? (
                <WeeklyHub
                    initialWeek={workspaceWeek}
                    state={reply.state}
                    run={run}
                    error={error}
                    onSettings={() => setSettingsOpen(true)}
                    onWrite={openWorkspace}
                    onActivity={openActivity}
                />
            ) : (
                <main className="loading">
                    <p role={error ? 'alert' : 'status'}>{error || 'Opening your journal…'}</p>
                    {error && <Button onClick={() => run({ type: 'state' })}>Try again</Button>}
                </main>
            )}
            {settingsOpen && reply && (
                <Settings
                    state={reply.state}
                    connections={reply.connections}
                    remotes={remotes}
                    run={run}
                    close={() => setSettingsOpen(false)}
                />
            )}
            {commandsOpen && (
                <CommandMenu
                    close={() => setCommandsOpen(false)}
                    commands={[
                        { name: 'Open journal', hint: 'Writing workspace', action: () => openWorkspace() },
                        { name: 'Back to week', hint: 'Weekly hub', action: backToHub },
                        {
                            name: 'Open settings',
                            hint: 'Repositories and connections',
                            action: () => setSettingsOpen(true)
                        },
                        {
                            name: 'Refresh activity',
                            hint: 'Discover work',
                            action: () => {
                                void run({ type: 'refresh' })
                            }
                        }
                    ]}
                />
            )}
        </>
    )
}
