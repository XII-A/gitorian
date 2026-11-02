import { Component, useEffect, useState, type ReactNode } from 'react'
import { Button } from './components/arc/button/button'
import { StartupRecovery } from './StartupRecovery'
import type { DiagnosticState } from '../shared/diagnostics'
import { checkpointWriting } from './writing-checkpoint'

export function DiagnosticActions() {
    const [status, setStatus] = useState('')
    const [pending, setPending] = useState(false)
    const [enabled, setEnabled] = useState(false)
    useEffect(() => setEnabled(!!window.journal.diagnostics), [])
    if (!enabled) return null
    const act = async (action: 'copy' | 'save') => {
        setPending(true)
        try {
            const completed = await window.journal.diagnostics!.act(action)
            setStatus(completed ? (action === 'copy' ? 'Diagnostic report copied' : 'Diagnostic report saved') : '')
        } catch {
            setStatus('Could not share the report. Try again.')
        } finally {
            setPending(false)
        }
    }
    return (
        <div className="diagnostic-actions">
            <Button variant="secondary" disabled={pending} onClick={() => act('copy')}>
                Copy diagnostic report
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => act('save')}>
                Save report
            </Button>
            <span aria-live="polite">{status}</span>
        </div>
    )
}

export function RecoveryNotice() {
    const [paused, setPaused] = useState(false)
    const [restartRequired, setRestartRequired] = useState(false)
    const [issue, setIssue] = useState('')
    useEffect(() => {
        const apply = (state: DiagnosticState) => {
            setPaused(state.recovery && !state.startupFailed)
            setRestartRequired(!!state.restartRequired)
        }
        void window.journal.diagnostics
            ?.state()
            .then(apply)
            .catch(() => undefined)
        return window.journal.diagnostics?.onState?.(apply)
    }, [])
    useEffect(
        () =>
            window.journal.diagnostics?.onRestart?.(async () => {
                await checkpointWriting()
            }),
        []
    )
    if (!paused) return null
    return (
        <section className="recovery-notice" aria-label="Recovery mode">
            <div>
                <strong>Gitorian is in recovery mode</strong>
                <p>
                    {restartRequired
                        ? 'The journal stopped responding. Reopen it to verify the last save.'
                        : 'The previous session ended unexpectedly. Saved writing is available. Automatic refresh is paused.'}
                </p>
            </div>
            <DiagnosticActions />
            <Button
                variant="secondary"
                onClick={async () => {
                    try {
                        await window.journal.diagnostics?.act(restartRequired ? 'restart' : 'continue')
                        if (!restartRequired) setPaused(false)
                    } catch {
                        setIssue('Could not resume. Try again.')
                    }
                }}
            >
                {restartRequired ? 'Reopen journal' : 'Continue normally'}
            </Button>
            {issue && <p role="alert">{issue}</p>}
        </section>
    )
}

export class WindowRecovery extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch() {
        window.journal.diagnostics?.error('render')
    }
    render() {
        return this.state.failed ? (
            <StartupRecovery
                error="The window could not be displayed. Reload it to try again."
                failures={1}
                pending={false}
                onRetry={() => {
                    window.location.reload()
                    return Promise.resolve()
                }}
            />
        ) : (
            this.props.children
        )
    }
}
