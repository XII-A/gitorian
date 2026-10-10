import { useCallback, useEffect, useState } from 'react'
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
    const run = useCallback(async (command: Command): Promise<Reply | undefined> => {
        try {
            const result = await window.journal.invoke(command)
            setReply(result)
            if ('remotes' in result) setRemotes(result.remotes as Record<string, string[]>)
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
        const timer = setInterval(() => {
            void run({ type: 'state' })
        }, 15000)
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
