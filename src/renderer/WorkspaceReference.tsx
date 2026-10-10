import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { WorkspaceInspector } from './WorkspaceInspector'
import { sampleState } from './workspace-sample'
import { Button } from './components/arc/button/button'
import { Editor } from './Editor'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { hasCachedDetails } from './activity-cache'
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
            setError('')
            if (example || hasCachedDetails(state, item)) {
                setLoading(false)
                return
            }
            setLoading(true)
            const reply = await run({ type: 'details', activityId: item.id })
            if (!reply || reply.detailError)
                setError(reply?.detailError ?? 'Could not load this diff. Retry loading it.')
            setLoading(false)
        },
        [example, run, state]
    )
    const loaded = useRef(false)
    useEffect(() => {
        if (activity && !loaded.current) {
            loaded.current = true
            void inspect(activity)
        }
    }, [activity, inspect])
    const cite = () => {
        if (!activity) return
        setStatus('Sending to your workspace…')
        clearTimeout(citationTimer.current)
        citationTimer.current = setTimeout(
            () => setStatus('No response from the workspace. Open your draft for this week, then try again.'),
            4000
        )
        channel.current?.postMessage({ type: 'cite', activityId: activity.id })
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
                        citationStatus={status}
                        onCite={() => cite()}
                        onClose={dock}
                        onInspect={(item) => void inspect(item)}
                    />
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
