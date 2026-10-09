import { useCallback, useEffect, useState } from 'react'
import type { Command, Reply } from '../shared/model'
import { WeeklyHub } from './WeeklyHub'
import { Settings } from './Settings'
import { CommandMenu } from './components/CommandMenu'
import { Button } from './components/arc/button/button'
import { Workspace } from './Workspace'

export function App() {
    const [screen, setScreen] = useState<'hub' | 'workspace'>('hub')
    const [reply, setReply] = useState<Reply>()
    const [remotes, setRemotes] = useState<Record<string, string[]>>({})
    const [error, setError] = useState('')
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [commandsOpen, setCommandsOpen] = useState(false)
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
        if (parameters.has('workspace') || parameters.has('variant') || parameters.has('reference'))
            setScreen('workspace')
        void run({ type: 'state' })
        const timer = setInterval(() => {
            void run({ type: 'state' })
        }, 15000)
        return () => clearInterval(timer)
    }, [run])
    useEffect(() => {
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && screen === 'workspace' && !settingsOpen && !commandsOpen) setScreen('hub')
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !settingsOpen) {
                event.preventDefault()
                setCommandsOpen((open) => !open)
            }
        }
        window.addEventListener('keydown', keyboard)
        return () => window.removeEventListener('keydown', keyboard)
    }, [screen, settingsOpen, commandsOpen])
    const openWorkspace = () => {
        setScreen('workspace')
        window.scrollTo(0, 0)
    }
    return (
        <>
            {screen === 'workspace' ? (
                <Workspace />
            ) : reply ? (
                <WeeklyHub
                    state={reply.state}
                    run={run}
                    error={error}
                    onSettings={() => setSettingsOpen(true)}
                    onWrite={openWorkspace}
                    onActivity={openWorkspace}
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
                        { name: 'Open journal', hint: 'Writing workspace', action: openWorkspace },
                        { name: 'Back to week', hint: 'Weekly hub', action: () => setScreen('hub') },
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
