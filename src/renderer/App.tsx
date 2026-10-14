import { useCallback, useEffect, useRef, useState } from 'react'

import type { Activity, Command, Reply } from '../shared/model'
import { localDate, weekOf } from '../shared/model'
import { AcquisitionStatus } from './acquisition-status'
import { unchangedStateReply } from './activity-cache'
import { BackgroundNotifications } from './background-notifications'
import { activityUpdating } from './background-work'
import { Button } from './components/arc/button/button'
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack'
import { CommandMenu } from './components/command-menu'
import { journalWeek } from './hub-model'
import { Settings } from './settings'
import { WeeklyHub } from './weekly-hub'
import { Workspace } from './workspace'
import { WorkspaceReference } from './workspace-reference'

const JournalApp = () => {
    const [screen, setScreen] = useState<'hub' | 'workspace'>('hub')
    const [reply, setReply] = useState<Reply>()
    const [remotes, setRemotes] = useState<Record<string, string[]>>({})
    const [error, setError] = useState('')
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(false)
    const [workspaceWeek, setWorkspaceWeek] = useState('')
    const [workspaceActivity, setWorkspaceActivity] = useState<string>()
    const [reference, setReference] = useState<{ kind: string; id: string }>()
    const [sourcesOpen, setSourcesOpen] = useState(false)
    const polling = useRef(false)
    const currentReply = useRef(reply)
    currentReply.current = reply
    const run = useCallback(async (command: Command): Promise<Reply | undefined> => {
        try {
            const result = await window.journal.invoke(command)
            setReply((current) => {
                if (unchangedStateReply(current, result, command)) {
                    return current
                }
                if (
                    current?.state.restoreId === result.state.restoreId &&
                    (current?.state.snapshotVersion ?? 0) > (result.state.snapshotVersion ?? 0)
                ) {
                    return current
                }
                const diffs = current?.state.restoreId === result.state.restoreId ? { ...current?.state.diffs } : {}
                if (command.type === 'details' && result.diff !== undefined) {
                    diffs[command.activityId] = result.diff
                }
                return { ...result, state: { ...result.state, diffs: { ...diffs, ...result.state.diffs } } }
            })
            if ('remotes' in result) {
                const next = result.remotes as Record<string, string[]>
                setRemotes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
            }
            setError('')
            return result
        } catch (error) {
            setError(String(error))
            return undefined
        }
    }, [])
    useEffect(() => {
        const parameters = new URLSearchParams(window.location.search)
        const referenceKind = parameters.get('reference')
        const referenceId = parameters.get('id')
        if (referenceKind && referenceId) {
            setReference({ id: referenceId, kind: referenceKind })
        }
        const requestedWeek = parameters.get('week')
        if (
            requestedWeek &&
            /^\d{4}-\d{2}-\d{2}$/u.test(requestedWeek) &&
            !Number.isNaN(new Date(`${requestedWeek}T12:00:00Z`).getTime())
        ) {
            setWorkspaceWeek(requestedWeek)
        }
        if (parameters.has('workspace') || parameters.has('reference')) {
            setScreen('workspace')
        }
        void run({ type: 'state' })
        let lastPoll = Date.now()
        const timer = setInterval(() => {
            if (polling.current) {
                return
            }
            const state = currentReply.current?.state
            const active = state?.repositoryImport?.status === 'running' || (!!state && activityUpdating(state))
            if (!active && Date.now() - lastPoll < 15_000) {
                return
            }
            lastPoll = Date.now()
            polling.current = true
            void run({ type: 'state' }).finally(() => {
                polling.current = false
            })
        }, 2000)
        return () => {
            clearInterval(timer)
        }
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
            ) {
                setScreen('hub')
            }
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
        return () => {
            window.removeEventListener('keydown', keyboard)
        }
    }, [screen, settingsOpen, commandsOpen, reference])
    const openWorkspace = (date?: string) => {
        setWorkspaceWeek(date ?? (reply ? weekOf(new Date(), reply.state.settings) : ''))
        setWorkspaceActivity(undefined)
        setScreen('workspace')
        window.scrollTo(0, 0)
    }
    const openActivity = (activity: Activity) => {
        if (!reply) {
            return
        }
        openWorkspace(
            journalWeek(
                localDate(new Date(activity.date), reply.state.settings.timezone),
                reply.state.settings.weekStart
            )
        )
        setWorkspaceActivity(activity.id)
    }
    const backToHub = (week?: string) => {
        if (week) {
            setWorkspaceWeek(week)
        }
        const url = new URL(window.location.href)
        for (const key of ['workspace', 'variant', 'data', 'week']) {
            url.searchParams.delete(key)
        }
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
                            setSettingsOpen(true)
                        }}
                    />
                    <BackgroundNotifications
                        state={reply.state}
                        run={run}
                        settingsOpen={settingsOpen}
                        onSources={() => {
                            setSourcesOpen(true)
                        }}
                    />
                </>
            )}
            {(() => {
                if (reference && reply) {
                    return <WorkspaceReference state={reply.state} run={run} kind={reference.kind} id={reference.id} />
                }
                if (screen === 'workspace' && reply) {
                    return (
                        <Workspace
                            state={reply.state}
                            notionConnected={reply.connections.notion}
                            run={run}
                            error={error}
                            initialWeek={workspaceWeek || weekOf(new Date(), reply.state.settings)}
                            initialActivity={workspaceActivity}
                            onBack={backToHub}
                            onSources={() => {
                                setSourcesOpen(true)
                            }}
                            onSettings={() => {
                                setSettingsOpen(true)
                            }}
                        />
                    )
                }
                if (reply && !reference) {
                    return (
                        <WeeklyHub
                            initialWeek={workspaceWeek}
                            state={reply.state}
                            run={run}
                            error={error}
                            onSources={() => {
                                setSourcesOpen(true)
                            }}
                            onSettings={() => {
                                setSettingsOpen(true)
                            }}
                            onWrite={openWorkspace}
                            onActivity={openActivity}
                        />
                    )
                }

                return (
                    <main className="loading">
                        <p role={error ? 'alert' : 'status'}>{error || 'Opening your journal…'}</p>
                        {error && <Button onClick={() => Promise.resolve(run({ type: 'state' }))}>Try again</Button>}
                    </main>
                )
            })()}
            {settingsOpen && reply && (
                <Settings
                    state={reply.state}
                    connections={reply.connections}
                    remotes={remotes}
                    run={run}
                    close={() => {
                        setSettingsOpen(false)
                    }}
                />
            )}
            {commandsOpen && (
                <CommandMenu
                    close={() => {
                        setCommandsOpen(false)
                    }}
                    commands={[
                        {
                            action: () => {
                                openWorkspace()
                            },
                            hint: 'Writing workspace',
                            name: 'Open journal'
                        },
                        { action: backToHub, hint: 'Weekly hub', name: 'Back to week' },
                        {
                            action: () => {
                                setSettingsOpen(true)
                            },
                            hint: 'Repositories and connections',
                            name: 'Open settings'
                        },
                        {
                            action: () => {
                                void run({ type: 'refresh' })
                            },
                            hint: 'Discover work',
                            name: 'Refresh activity'
                        }
                    ]}
                />
            )}
        </>
    )
}

export const App = () => (
    <ToastStackProvider>
        <JournalApp />
        <ToastStack className="journal-notifications" />
    </ToastStackProvider>
)
