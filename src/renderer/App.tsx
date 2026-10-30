import { activityUpdating } from './background-work'
import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import type { Command, Reply } from '../shared/model'
import { WeeklyHub } from './WeeklyHub'
import { Settings } from './Settings'
import { CommandMenu } from './components/CommandMenu'
import { StartupRecovery } from './StartupRecovery'
import { Workspace } from './Workspace'
import { WorkspaceReference } from './WorkspaceReference'
import { localDate, weekOf } from '../shared/model'
import type { Activity } from '../shared/model'
import { journalWeek } from './hub-model'
import { AcquisitionStatus } from './AcquisitionStatus'
import { BackgroundNotifications } from './BackgroundNotifications'
import { ToastStack, ToastStackProvider, useToastStack } from './components/arc/toast-stack/toast-stack'
import { reconcileReply } from './activity-cache'
import { expandReply, stateCursor } from '../shared/state-updates'
import { WindowTitleBar } from './WindowTitleBar'
import { useOnboarding } from './use-onboarding'
import type { SetupSection } from './GettingStarted'
import { AppUpdateNotifications } from './AppUpdates'

export function App() {
    return (
        <ToastStackProvider>
            <WindowTitleBar />
            <AppUpdateNotifications />
            <JournalApp />
            <ToastStack className="journal-notifications" />
        </ToastStackProvider>
    )
}

function JournalApp() {
    const [screen, setScreen] = useState<'hub' | 'workspace'>('hub')
    const [reply, setReply] = useState<Reply>()
    const [remotes, setRemotes] = useState<Record<string, string[]>>({})
    const [error, setError] = useState('')
    const [startupPending, setStartupPending] = useState(false)
    const [startupFailures, setStartupFailures] = useState(0)
    const startupInFlight = useRef(false)
    const startupFocus = useRef(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settingsSection, setSettingsSection] = useState<SetupSection>('repositories')
    const onboarding = useOnboarding(reply)
    const [commandsOpen, setCommandsOpen] = useState(false)
    const [workspaceWeek, setWorkspaceWeek] = useState('')
    const [workspaceActivity, setWorkspaceActivity] = useState<string>()
    const [workspaceWriting, setWorkspaceWriting] = useState(false)
    const [reference, setReference] = useState<{ kind: string; id: string }>()
    const [sourcesOpen, setSourcesOpen] = useState(false)
    const { toast, update, dismiss } = useToastStack()
    const commandSurfaceVisible = useRef(false)
    commandSurfaceVisible.current = !settingsOpen && !reference
    const polling = useRef(false)
    const currentReply = useRef(reply)
    currentReply.current = reply
    const run = useCallback(
        async (command: Command): Promise<Reply | undefined> => {
            const startup = !currentReply.current
            if (startup && startupInFlight.current) return undefined
            if (startup) {
                startupInFlight.current = true
                setStartupPending(true)
            }
            try {
                const base = currentReply.current?.state
                const result = window.journal.updates
                    ? expandReply(await window.journal.updates(command, base && stateCursor(base)), base)
                    : await window.journal.invoke(command)
                startTransition(() => setReply((current) => reconcileReply(current, result, command)))
                if ('remotes' in result) {
                    const next = result.remotes as Record<string, string[]>
                    setRemotes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
                }
                if (command.type !== 'state') dismiss(`journal-command:${command.type}`)
                setError('')
                return result
            } catch (failure) {
                if (startup) setStartupFailures((count) => count + 1)
                if (['draft', 'publish', 'reconcile'].includes(command.type)) {
                    // The writing pane owns save recovery. A refreshed snapshot is not
                    // a draftSaved acknowledgment; it lets the pane detect stale versions.
                    try {
                        const refreshed = await window.journal.invoke({ type: 'state' })
                        startTransition(() =>
                            setReply((current) => reconcileReply(current, refreshed, { type: 'state' }))
                        )
                        setError('')
                        return refreshed
                    } catch {
                        /* Keep the current draft available. */
                    }
                    setError('')
                } else if (commandSurfaceVisible.current && currentReply.current) {
                    // These surfaces own their recovery. Polling must not replay notifications.
                    if (!['state', 'details', 'history'].includes(command.type)) {
                        const refresh = command.type === 'refresh'
                        toast({
                            id: `journal-command:${command.type}`,
                            type: 'error',
                            duration: 0,
                            title: refresh ? 'Could not refresh activity' : 'Could not complete action',
                            action: {
                                label: refresh ? 'Retry refresh' : 'Retry action',
                                onClick: (id) => {
                                    update(id, { type: 'loading', title: 'Retrying?', action: undefined })
                                    void run(command)
                                }
                            }
                        })
                    }
                } else setError(String(failure))
                return undefined
            } finally {
                if (startup) {
                    startupInFlight.current = false
                    setStartupPending(false)
                }
            }
        },
        [toast, update, dismiss]
    )
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
            // A failed startup waits for explicit recovery; polling must not race Retry.
            if (polling.current || !currentReply.current) return
            const state = currentReply.current?.state
            const active = state?.repositoryImport?.status === 'running' || (!!state && activityUpdating(state))
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
    useEffect(() => {
        if (!reply || !startupFocus.current) return
        startupFocus.current = false
        // The recovery action has unmounted. Preserve focus on surviving controls.
        if (document.activeElement !== document.body) return
        const heading = document.querySelector<HTMLElement>('main h1, main h2, main h3')
        if (heading) {
            heading.tabIndex = -1
            heading.focus({ preventScroll: true })
        }
    }, [reply])
    const openWorkspace = (date?: string, writing = false) => {
        setWorkspaceWeek(date ?? (reply ? weekOf(new Date(), reply.state.settings) : ''))
        setWorkspaceActivity(undefined)
        setWorkspaceWriting(writing)
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
            {reply && !reference && (
                <>
                    <AcquisitionStatus
                        state={reply.state}
                        run={run}
                        open={sourcesOpen}
                        onOpenChange={setSourcesOpen}
                        onSettings={() => {
                            setSourcesOpen(false)
                            setSettingsSection('repositories')
                            setSettingsOpen(true)
                        }}
                    />
                    <BackgroundNotifications
                        state={reply.state}
                        run={run}
                        settingsOpen={settingsOpen}
                        onSources={() => {
                            dismiss('activity-problems')
                            setSourcesOpen(true)
                        }}
                    />
                </>
            )}
            {reference && reply ? (
                <WorkspaceReference state={reply.state} run={run} kind={reference.kind} id={reference.id} />
            ) : screen === 'workspace' && reply ? (
                <Workspace
                    state={reply.state}
                    notionConnected={reply.connections.notion}
                    run={run}
                    initialWeek={workspaceWeek || weekOf(new Date(), reply.state.settings)}
                    initialActivity={workspaceActivity}
                    initialWrite={workspaceWriting}
                    onBack={backToHub}
                    onSources={() => {
                        dismiss('activity-problems')
                        setSourcesOpen(true)
                    }}
                    onSettings={() => setSettingsOpen(true)}
                />
            ) : reply && !reference ? (
                <WeeklyHub
                    initialWeek={workspaceWeek}
                    state={reply.state}
                    run={run}
                    error={error}
                    onSources={() => {
                        dismiss('activity-problems')
                        setSourcesOpen(true)
                    }}
                    onSettings={() => setSettingsOpen(true)}
                    onWrite={(date) => openWorkspace(date, true)}
                    onActivity={openActivity}
                    onboarding={onboarding}
                    settingsOpen={settingsOpen}
                    onSetup={(section) => {
                        setSettingsSection(section)
                        setSettingsOpen(true)
                    }}
                />
            ) : (
                <StartupRecovery
                    error={error}
                    pending={startupPending}
                    failures={startupFailures}
                    onRetry={() => {
                        startupFocus.current = true
                        return run({ type: 'state' })
                    }}
                />
            )}
            {settingsOpen && reply && (
                <Settings
                    key={reply.state.restoreId ?? 'local'}
                    state={reply.state}
                    connections={reply.connections}
                    initialSection={settingsSection}
                    remotes={remotes}
                    run={run}
                    close={() => setSettingsOpen(false)}
                />
            )}
            {commandsOpen && reply && (
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
