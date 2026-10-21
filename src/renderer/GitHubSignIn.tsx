import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDisconnectTransition } from './useDisconnectTransition'
import { ConnectionIdentity } from './ConnectionIdentity'
import { ExternalLink, CircleAlert } from 'lucide-react'
import type { Reply } from '../shared/model'
import { Button } from './components/arc/button/button'
import { CopyButton } from './components/arc/copy-button/copy-button'
import { ConfirmMorph, type ConfirmMorphState } from './components/arc/confirm-morph/confirm-morph'

export type GitHubSignInFeedback =
    | { kind: 'error' | 'expired'; message: string }
    | { kind: 'authorizing' | 'success'; login: string }

export function githubSignInFailure(failure: unknown): GitHubSignInFeedback {
    const message = failure instanceof Error ? failure.message : String(failure)
    if (/expired/i.test(message)) return { kind: 'expired', message: 'Code expired' }
    if (/sign-in is unavailable|incorrect_client_credentials|device_flow_disabled/i.test(message))
        return {
            kind: 'error',
            message: 'Sign-in unavailable'
        }
    if (/declined|access_denied/i.test(message)) return { kind: 'error', message: 'Authorization declined' }
    return { kind: 'error', message: 'Could not connect' }
}

export function GitHubSignIn({
    device,
    feedback,
    notice,
    pending,
    openingBrowser,
    disabled,
    connected,
    identity,
    onStart,
    onCancel,
    onOpen,
    onDisconnect
}: {
    device?: Reply['device']
    feedback?: GitHubSignInFeedback
    notice?: string
    pending: boolean
    openingBrowser: boolean
    disabled: boolean
    connected: boolean
    identity?: ReactNode
    onStart: () => void | Promise<void>
    onCancel: () => void
    onOpen: () => void | Promise<void>
    onDisconnect: () => Promise<void>
}) {
    const { state: disconnectState, setState: setDisconnectState, showDisconnect } = useDisconnectTransition(connected)
    const phase = device
        ? 'device'
        : feedback
          ? feedback.kind
          : showDisconnect
            ? 'connected'
            : pending
              ? 'starting'
              : 'idle'
    const expanded = phase === 'device' || phase === 'error' || phase === 'expired'
    const control = useRef<HTMLDivElement>(null)
    const previousPhase = useRef(phase)
    const [identityReady, setIdentityReady] = useState(connected)
    useEffect(() => {
        if (phase !== 'connected') setIdentityReady(false)
    }, [phase])
    const state: ConfirmMorphState =
        phase === 'connected'
            ? disconnectState
            : phase === 'device'
              ? 'confirming'
              : phase === 'starting' || phase === 'authorizing'
                ? 'pending'
                : phase === 'success'
                  ? 'done'
                  : phase === 'error' || phase === 'expired'
                    ? 'error'
                    : 'idle'
    const cancel = () => {
        setDisconnectState('idle')
        onCancel()
    }
    useEffect(() => {
        const changed = phase !== previousPhase.current
        previousPhase.current = phase
        // ConfirmMorph mounts the arriving face after AnimatePresence resolves its child list.
        const frame = setTimeout(() => {
            const selector =
                phase === 'device'
                    ? '[data-face="confirming"]:not([role="group"]):not([inert]) [data-copy-state]'
                    : phase === 'error' || phase === 'expired'
                      ? '[data-face="error"]:not([role="group"]):not([inert]) [data-autofocus]'
                      : changed && (phase === 'idle' || phase === 'connected')
                        ? '[data-face="idle"]:not([role="group"]):not([inert]) button'
                        : undefined
            if (selector) control.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
        }, 0)
        return () => clearTimeout(frame)
    }, [phase])

    return (
        <div className="github-signin-track">
            {identity && (
                <div className="settings-github-account">
                    <ConnectionIdentity ready={phase === 'connected' && identityReady}>{identity}</ConnectionIdentity>
                </div>
            )}
            <div className="github-signin-surface" data-expanded={expanded} data-phase={phase}>
                <ConfirmMorph
                    ref={control}
                    onWidthSettled={(face) => {
                        if (phase === 'connected' && face === 'idle') setIdentityReady(true)
                    }}
                    label={phase === 'connected' ? 'Disconnect' : 'Connect'}
                    actionLabel={phase === 'connected' ? 'Disconnect GitHub' : 'Connect GitHub'}
                    prompt={<span className="settings-disconnect-question">Disconnect GitHub?</span>}
                    confirmLabel="Disconnect"
                    confirmMode={phase === 'connected' ? 'hold' : 'immediate'}
                    variant="secondary"
                    state={state}
                    onStateChange={phase === 'connected' ? setDisconnectState : undefined}
                    confirmTimeout={0}
                    resultTimeout={0}
                    cancelOnOutsidePress={phase === 'connected'}
                    pendingLabel={phase === 'connected' ? 'Disconnecting' : 'Connecting'}
                    doneLabel={phase === 'connected' ? 'Disconnected' : 'Connected'}
                    errorLabel={feedback && 'message' in feedback ? feedback.message : 'Could not disconnect'}
                    errorCancelLabel="Cancel"
                    disabled={disabled || openingBrowser}
                    onActivate={phase === 'connected' ? undefined : () => void onStart()}
                    onConfirm={onDisconnect}
                    onCancel={cancel}
                    confirmContent={
                        device ? (
                            <div className="github-signin-code-row">
                                <span className="github-signin-code-group">
                                    <code className="github-signin-code">{device.code}</code>
                                    <CopyButton
                                        value={device.code}
                                        label="Copy code"
                                        iconOnly
                                        variant="plain"
                                        className="github-signin-copy"
                                    />
                                </span>
                                <Button size="sm" className="github-device-action" variant="ghost" onClick={cancel}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="github-device-action"
                                    loading={openingBrowser}
                                    disabled={disabled}
                                    onClick={onOpen}
                                    aria-label="Open GitHub"
                                    title={
                                        notice
                                            ? 'Browser unavailable. Visit github.com/login/device to enter the code.'
                                            : undefined
                                    }
                                >
                                    {notice ? (
                                        <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                                    ) : (
                                        <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
                                    )}{' '}
                                    <span className="github-device-label">Open GitHub</span>
                                </Button>
                                {notice && (
                                    <span role="alert" className="settings-sr-only">
                                        {notice}
                                    </span>
                                )}
                            </div>
                        ) : undefined
                    }
                />
                <span className="settings-sr-only" role="status">
                    {phase === 'success' && feedback && 'login' in feedback
                        ? `Connected as ${feedback.login}`
                        : phase === 'authorizing' || phase === 'starting'
                          ? 'Connecting GitHub'
                          : feedback && 'message' in feedback
                            ? feedback.message
                            : ''}
                </span>
            </div>
        </div>
    )
}
