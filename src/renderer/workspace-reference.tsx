import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Activity, Command, Reply, State } from '../shared/model'
import { hasCachedDetails } from './activity-cache'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Editor } from './editor'
import { WorkspaceInspector } from './workspace-inspector'
import { sampleState } from './workspace-sample'

import './workspace.css'

export const WorkspaceReference = ({
    state,
    run,
    kind,
    id
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    kind: string
    id: string
}) => {
    const [, sampleWeek] = /^sample:(?<group1>\d{4}-\d{2}-\d{2}):/u.exec(id) ?? []
    const example = useMemo(() => (sampleWeek ? sampleState(sampleWeek) : undefined), [sampleWeek])
    const source = example ?? state
    const [selectedId, setSelectedId] = useState(id)
    const [inspectionTab, setInspectionTab] = useState<'diff' | 'details'>('diff')
    const activity = source.activities.find((item) => item.id === selectedId)
    const entry = source.entries.find((item) => item.id === id)
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const requestId = useRef(0)
    const channel = useRef<BroadcastChannel | undefined | null>(null)
    const citationTimer = useRef<ReturnType<typeof setTimeout> | undefined | null>(null)
    useEffect(() => {
        const bus = new BroadcastChannel('weekly-j-workspace-reference')
        channel.current = bus
        bus.onmessage = (event: MessageEvent<unknown>) => {
            const { data } = event
            if (!data || typeof data !== 'object' || !('activityId' in data) || !('type' in data)) {
                return
            }
            if (data.type === 'close' && data.activityId === id) {
                bus.postMessage({ activityId: id, type: 'dock' })
                window.close()
            }
            if (data.type === 'citation-result' && data.activityId === selectedId) {
                clearTimeout(citationTimer.current ?? undefined)
                setStatus(
                    'accepted' in data && data.accepted
                        ? 'Added to your entry.'
                        : 'Open an editable draft for this week in the workspace, then try again.'
                )
            }
        }
        const dock = () => {
            bus.postMessage({ activityId: id, type: 'dock' })
        }
        window.addEventListener('pagehide', dock)
        return () => {
            clearTimeout(citationTimer.current ?? undefined)
            window.removeEventListener('pagehide', dock)
            bus.close()
        }
    }, [id, selectedId])
    const inspect = useCallback(
        async (item: Activity, tab: 'diff' | 'details' = 'diff') => {
            const request = (requestId.current += 1)
            setSelectedId(item.id)
            setInspectionTab(tab)
            setError('')
            if (example || hasCachedDetails(state, item, tab === 'details' ? 'files' : 'diff')) {
                setLoading(false)
                return
            }
            setLoading(true)
            const reply = await run({
                activityId: item.id,
                content: tab === 'details' ? 'files' : 'diff',
                type: 'details'
            })
            if (requestId.current !== request) {
                return
            }
            if (!reply || reply.detailError) {
                setError(reply?.detailError ?? 'Could not load this diff. Retry loading it.')
            }
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
        if (!activity) {
            return
        }
        setStatus('Sending to your workspace…')
        clearTimeout(citationTimer.current ?? undefined)
        citationTimer.current = setTimeout(() => {
            setStatus('No response from the workspace. Open your draft for this week, then try again.')
        }, 4000)
        channel.current?.postMessage({ activityId: activity.id, type: 'cite' })
    }
    const dock = () => {
        channel.current?.postMessage({ activityId: id, type: 'dock' })
        window.close()
    }
    return (
        <main className="ws-reference" aria-label="Detached reference window">
            {(() => {
                if (kind === 'entry' && entry) {
                    return (
                        <ScrollArea className="ws-reference-entry-scroll" label="Published journal entry" fade={20}>
                            <section className="ws-reference-entry">
                                <header>
                                    <h1>{entry.title}</h1>
                                    <Button variant="secondary" size="sm" onClick={dock}>
                                        Back to workspace
                                    </Button>
                                </header>
                                <Editor value={entry.body} readOnly />
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => Promise.resolve(run({ type: 'open', url: entry.url }))}
                                >
                                    Open in Notion
                                </Button>
                            </section>
                        </ScrollArea>
                    )
                }
                if (activity) {
                    return (
                        <WorkspaceInspector
                            state={source}
                            activity={activity}
                            run={
                                example
                                    ? () =>
                                          Promise.resolve({
                                              connections: { github: false, notion: false, protectedStorage: false },
                                              state: source
                                          })
                                    : run
                            }
                            reference
                            initialTab={inspectionTab}
                            loading={loading}
                            error={error}
                            canCite
                            citationStatus={status}
                            onCite={() => {
                                cite()
                            }}
                            onClose={dock}
                            onInspect={(item, tab) => void inspect(item, tab)}
                        />
                    )
                }
                return (
                    <div className="ws-activity-empty">
                        <h1>This reference is unavailable</h1>
                        <p>Return to the workspace and open the activity again.</p>
                        <Button variant="secondary" onClick={dock}>
                            Back to workspace
                        </Button>
                    </div>
                )
            })()}
        </main>
    )
}
