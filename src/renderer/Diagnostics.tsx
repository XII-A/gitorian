import {
    Component,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react'
import { Button } from './components/arc/button/button'
import { StartupRecovery } from './StartupRecovery'
import type { DiagnosticState } from '../shared/diagnostics'
import { checkpointWriting } from './writing-checkpoint'
import { useToastStack } from './components/arc/toast-stack/toast-stack'

export function DiagnosticReportButton() {
    const [status, setStatus] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle')
    const [enabled, setEnabled] = useState(false)
    useEffect(() => setEnabled(!!window.journal.diagnostics), [])
    if (!enabled) return null
    const copy = async () => {
        setStatus('pending')
        try {
            setStatus((await window.journal.diagnostics!.act('copy')) ? 'copied' : 'failed')
        } catch {
            setStatus('failed')
        }
    }
    return (
        <>
            <Button variant="ghost" size="sm" loading={status === 'pending'} onClick={copy}>
                {status === 'copied'
                    ? 'Diagnostic report copied'
                    : status === 'failed'
                      ? 'Retry copying report'
                      : 'Copy diagnostic report'}
            </Button>
            <span className="sr-only" role="status">
                {status === 'copied'
                    ? 'Diagnostic report copied'
                    : status === 'failed'
                      ? 'Could not copy the report. Try again.'
                      : ''}
            </span>
        </>
    )
}

const RecoveryContext = createContext({
    refreshLabel: 'Refresh activity',
    prepareRefresh: () => Promise.resolve(true)
})

export const useRecovery = () => useContext(RecoveryContext)

/** Keep recovery admission independent of notification dismissal and ordinary journal reads. */
export function RecoveryProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<DiagnosticState>()
    const announced = useRef<string | undefined>(undefined)
    const { toast, update, dismiss } = useToastStack()
    useEffect(() => {
        void window.journal.diagnostics
            ?.state()
            .then(setState)
            .catch(() => undefined)
        return window.journal.diagnostics?.onState?.(setState)
    }, [])
    useEffect(
        () =>
            window.journal.diagnostics?.onRestart?.(async () => {
                await checkpointWriting()
            }),
        []
    )
    useEffect(() => {
        const id = 'journal-recovery'
        if (!state?.recovery || state.startupFailed) {
            dismiss(id)
            return
        }
        const notice = state.recoveryNoticeId
        if (!notice || announced.current === notice) return
        announced.current = notice
        try {
            if (localStorage.getItem('gitorian:last-recovery-notice') === notice) return
            localStorage.setItem('gitorian:last-recovery-notice', notice)
        } catch {
            // Restricted browser storage must not prevent recovery or repeat within this mount.
        }
        const copy = () => {
            // Updating synchronously keeps the toast open until the native clipboard confirms success.
            update(id, { type: 'loading', title: 'Copying diagnostic report', action: undefined, duration: Infinity })
            void window.journal.diagnostics!.act('copy').then(
                (copied) => {
                    if (copied)
                        update(id, {
                            type: 'success',
                            title: 'Diagnostic report copied',
                            description: 'Paste it into your bug report.',
                            action: undefined,
                            duration: 4000
                        })
                    else failed()
                },
                () => failed()
            )
        }
        const failed = () =>
            update(id, {
                type: 'error',
                title: 'Could not copy the report',
                description: 'Try copying it again.',
                action: { label: 'Copy diagnostic report', onClick: copy },
                duration: Infinity
            })
        toast({
            id,
            type: 'warning',
            title: state.restartRequired ? 'Journal stopped responding' : 'Your last session closed unexpectedly',
            description: state.restartRequired
                ? 'Use the refresh button to reopen and verify the last save.'
                : 'Your journal is open. Resume automatic refresh when you’re ready.',
            actionPlacement: 'below',
            action: { label: 'Copy diagnostic report', onClick: copy },
            duration: Infinity
        })
    }, [state?.recovery, state?.startupFailed, state?.restartRequired, state?.recoveryNoticeId, toast, update, dismiss])
    const prepareRefresh = useCallback(async () => {
        try {
            const diagnostics = window.journal.diagnostics
            // Read at the click, including when the initial state subscription is still loading.
            const current = await diagnostics?.state()
            if (!current) {
                dismiss('recovery-resume')
                return true
            }
            setState(current)
            if (current.restartRequired || current.startupFailed) {
                if (await diagnostics!.act('restart')) dismiss('recovery-resume')
                return false
            }
            if (current.recovery) {
                if (!(await diagnostics!.act('continue'))) return false
                setState({ ...current, recovery: false })
            }
            dismiss('recovery-resume')
            return true
        } catch {
            toast({
                id: 'recovery-resume',
                type: 'error',
                title: 'Could not resume refresh',
                description: 'Use the refresh control to try again.',
                duration: Infinity
            })
            return false
        }
    }, [toast, dismiss])
    const refreshLabel = state?.restartRequired
        ? 'Reopen journal'
        : state?.recovery
          ? 'Resume automatic refresh'
          : 'Refresh activity'
    const value = useMemo(() => ({ refreshLabel, prepareRefresh }), [refreshLabel, prepareRefresh])
    return <RecoveryContext.Provider value={value}>{children}</RecoveryContext.Provider>
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
