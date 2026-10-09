import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { WorkspaceInspector } from './WorkspaceInspector'
import { sampleState } from './workspace-sample'
import { Button } from './components/arc/button/button'
import { Input } from './components/arc/input/input'
import { Editor } from './Editor'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import './workspace.css'

export function WorkspaceReference({
    state,
    run,
    kind,
    id
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    kind: string
    id: string
}) {
    const sampleWeek = /^sample:(\d{4}-\d{2}-\d{2}):/.exec(id)?.[1]
    const example = useMemo(() => (sampleWeek ? sampleState(sampleWeek) : undefined), [sampleWeek])
    const source = example ?? state
    const [selectedId, setSelectedId] = useState(id)
    const activity = source.activities.find((item) => item.id === selectedId)
    const entry = source.entries.find((item) => item.id === id)
    const [note, setNote] = useState('')
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const channel = useRef<BroadcastChannel | undefined>(undefined)
    const citationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(() => {
        const bus = new BroadcastChannel('weekly-j-workspace-reference')
        channel.current = bus
        bus.onmessage = (event: MessageEvent<unknown>) => {
            const data = event.data
            if (!data || typeof data !== 'object' || !('activityId' in data) || !('type' in data)) return
            if (data.type === 'close' && data.activityId === id) {
                bus.postMessage({ type: 'dock', activityId: id })
                window.close()
            }
            if (data.type === 'citation-result' && data.activityId === selectedId) {
                clearTimeout(citationTimer.current)
                setStatus(
                    'accepted' in data && data.accepted
                        ? 'Added to your entry.'
                        : 'Open an editable draft for this week in the workspace, then try again.'
                )
                if ('accepted' in data && data.accepted) setNote('')
            }
        }
        const dock = () => bus.postMessage({ type: 'dock', activityId: id })
        window.addEventListener('pagehide', dock)
        return () => {
            clearTimeout(citationTimer.current)
            window.removeEventListener('pagehide', dock)
            bus.close()
        }
    }, [id, selectedId])
    const inspect = useCallback(
        async (item: Activity) => {
            setSelectedId(item.id)
            if (example) return
            setLoading(true)
            setError('')
            const reply = await run({ type: 'details', activityId: item.id })
            if (!reply)
                setError('Could not load this diff. Retry loading it, or reconnect the repository in the workspace.')
            setLoading(false)
        },
        [example, run]
    )
    const loaded = useRef(false)
    useEffect(() => {
        if (activity && !loaded.current) {
            loaded.current = true
            void inspect(activity)
        }
    }, [activity, inspect])
    const cite = (withNote = false) => {
        if (!activity) return
        setStatus('Sending to your workspace…')
        clearTimeout(citationTimer.current)
        citationTimer.current = setTimeout(
            () => setStatus('No response from the workspace. Open your draft for this week, then try again.'),
            4000
        )
        channel.current?.postMessage({ type: 'cite', activityId: activity.id, ...(withNote ? { note } : {}) })
    }
    const dock = () => {
        channel.current?.postMessage({ type: 'dock', activityId: id })
        window.close()
    }
    return (
        <main className="ws-reference" aria-label="Detached reference window">
            {kind === 'entry' && entry ? (
                <ScrollArea className="ws-reference-entry-scroll" label="Published journal entry" fade={20}>
                    <section className="ws-reference-entry">
                        <header>
                            <h1>{entry.title}</h1>
                            <Button variant="secondary" size="sm" onClick={dock}>
                                Back to workspace
                            </Button>
                        </header>
                        <Editor value={entry.body} readOnly />
                        <Button variant="secondary" size="sm" onClick={() => run({ type: 'open', url: entry.url })}>
                            Open in Notion
                        </Button>
                    </section>
                </ScrollArea>
            ) : activity ? (
                <>
                    <WorkspaceInspector
                        state={source}
                        activity={activity}
                        run={
                            example
                                ? () =>
                                      Promise.resolve({
                                          state: source,
                                          connections: { github: false, notion: false, protectedStorage: false }
                                      })
                                : run
                        }
                        reference
                        loading={loading}
                        error={error}
                        canCite
                        onCite={() => cite()}
                        onClose={dock}
                        onInspect={(item) => void inspect(item)}
                    />
                    <form
                        className="ws-reference-note"
                        onSubmit={(event) => {
                            event.preventDefault()
                            cite(true)
                        }}
                    >
                        <Input
                            label="Note for your entry"
                            placeholder="What did this change teach you?"
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                        />
                        <Button variant="secondary" type="submit" disabled={!note.trim()}>
                            Add note
                        </Button>
                        <span role="status">
                            {status || 'Write here. Your note is added to the draft in your workspace.'}
                        </span>
                    </form>
                </>
            ) : (
                <div className="ws-activity-empty">
                    <h1>This reference is unavailable</h1>
                    <p>Return to the workspace and open the activity again.</p>
                    <Button variant="secondary" onClick={dock}>
                        Back to workspace
                    </Button>
                </div>
            )}
        </main>
    )
}
