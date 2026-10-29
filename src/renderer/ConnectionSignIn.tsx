import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDisconnectTransition } from './useDisconnectTransition'
import { ConnectionIdentity } from './ConnectionIdentity'
import { ExternalLink, CircleAlert } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { CopyButton } from './components/arc/copy-button/copy-button'
import { ConfirmMorph, type ConfirmMorphState } from './components/arc/confirm-morph/confirm-morph'

export type ConnectionFeedback =
    | { kind: 'error' | 'expired'; message: string }
    | { kind: 'authorizing' | 'success'; login: string }

export function connectionFailure(failure: unknown, provider: 'GitHub' | 'Notion' = 'GitHub'): ConnectionFeedback {
    const message = failure instanceof Error ? failure.message : String(failure)
    if (/expired/i.test(message))
        return { kind: 'expired', message: provider === 'GitHub' ? 'Code expired' : 'Sign-in expired' }
    if (/sign-in is unavailable|incorrect_client_credentials|device_flow_disabled/i.test(message))
        return {
            kind: 'error',
            message: 'Sign-in unavailable'
        }
    if (/declined|access_denied/i.test(message)) return { kind: 'error', message: 'Authorization declined' }
    if (/Journal setup could not be confirmed/i.test(message))
        return { kind: 'error', message: 'Choose a journal destination' }
    return { kind: 'error', message: 'Could not connect' }
}

export function ConnectionSignIn({
    provider,
    device,
    feedback,
    notice,
    pending,
    openingBrowser,
    disabled,
    connected,
    connectedAction,
    identity,
    selection,
    errorCancelLabel = 'Cancel',
    pendingLabel,
    pendingContent,
    expandPending = false,
    onStart,
    onCancel,
    onOpen,
    onDisconnect,
    disconnectLabel,
    disconnectPrompt,
    idleLabel,
    idleActionLabel
}: {
    provider: 'GitHub' | 'GitLab' | 'Notion'
    device?: { url: string; interval: number; code?: string }
    feedback?: ConnectionFeedback
    notice?: string
    pending: boolean
    openingBrowser: boolean
    disabled: boolean
    connected: boolean
    disconnectLabel?: string
    idleLabel?: ReactNode
    idleActionLabel?: string
    disconnectPrompt?: ReactNode
    /** A reversible connected action that uses the same morph for editing instead of disconnecting. */
    connectedAction?: { label: ReactNode; name: string; onActivate: () => void | Promise<void> }
    identity?: ReactNode
    selection?: ReactNode
    errorCancelLabel?: string
    pendingLabel?: string
    pendingContent?: ReactNode
    expandPending?: boolean
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
          : selection
            ? 'selection'
            : showDisconnect
              ? 'connected'
              : pending
                ? 'starting'
                : 'idle'
    const expanded =
        phase === 'device' ||
        phase === 'selection' ||
        phase === 'error' ||
        phase === 'expired' ||
        (expandPending && (phase === 'authorizing' || phase === 'starting'))
    const control = useRef<HTMLDivElement>(null)
    const previousPhase = useRef(phase)
    const [identityReady, setIdentityReady] = useState(connected)
    useEffect(() => {
        if (phase !== 'connected') setIdentityReady(false)
    }, [phase])
    const state: ConfirmMorphState =
        phase === 'connected'
            ? connectedAction
                ? 'idle'
                : disconnectState
            : phase === 'device' || phase === 'selection'
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
                phase === 'selection'
                    ? '[data-face="confirming"]:not([inert]) [role="combobox"]'
                    : phase === 'device'
                      ? `[data-face="confirming"]:not([role="group"]):not([inert]) ${device?.code ? '[data-copy-state]' : '[aria-label^="Open "]'}`
                      : phase === 'error' || phase === 'expired'
                        ? '[data-face="error"]:not([role="group"]):not([inert]) [data-autofocus]'
                        : changed && (phase === 'idle' || phase === 'connected')
                          ? '[data-face="idle"]:not([role="group"]):not([inert]) button'
                          : undefined
            if (selector) control.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
        }, 0)
        return () => clearTimeout(frame)
    }, [phase, device?.code])

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
                    label={phase === 'connected' ? (connectedAction?.label ?? 'Disconnect') : (idleLabel ?? 'Connect')}
                    actionLabel={
                        phase === 'connected'
                            ? (connectedAction?.name ?? disconnectLabel ?? `Disconnect ${provider}`)
                            : (idleActionLabel ?? `Connect ${provider}`)
                    }
                    prompt={
                        disconnectPrompt ?? <span className="settings-disconnect-question">Disconnect {provider}?</span>
                    }
                    confirmLabel="Disconnect"
                    confirmMode={phase === 'connected' && !connectedAction ? 'hold' : 'immediate'}
                    variant={phase === 'connected' && connectedAction ? 'outline' : 'secondary'}
                    state={state}
                    onStateChange={phase === 'connected' && !connectedAction ? setDisconnectState : undefined}
                    confirmTimeout={0}
                    resultTimeout={0}
                    cancelOnOutsidePress={phase === 'connected' && !connectedAction}
                    pendingLabel={phase === 'connected' ? 'Disconnecting' : (pendingLabel ?? 'Connecting')}
                    pendingContent={phase === 'connected' ? undefined : pendingContent}
                    doneLabel={phase === 'connected' ? 'Disconnected' : 'Connected'}
                    errorLabel={feedback && 'message' in feedback ? feedback.message : 'Could not disconnect'}
                    errorCancelLabel={errorCancelLabel}
                    disabled={disabled || openingBrowser}
                    onActivate={
                        phase === 'connected'
                            ? connectedAction
                                ? () => void connectedAction.onActivate()
                                : undefined
                            : () => void onStart()
                    }
                    onConfirm={onDisconnect}
                    onCancel={cancel}
                    confirmContent={
                        selection && phase === 'selection' ? (
                            selection
                        ) : device ? (
                            <div className="github-signin-code-row">
                                <span className="github-signin-code-group">
                                    {device.code ? (
                                        <code className="github-signin-code">{device.code}</code>
                                    ) : (
                                        <span>
                                            Approve<span className="github-device-label"> in {provider}</span>
                                        </span>
                                    )}
                                    {device.code && (
                                        <CopyButton
                                            value={device.code}
                                            autoCopy
                                            label="Copy code"
                                            iconOnly
                                            variant="plain"
                                            className="github-signin-copy"
                                        />
                                    )}
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
                                    aria-label={`Open ${provider}`}
                                    title={
                                        notice
                                            ? provider === 'GitHub'
                                                ? 'Browser unavailable. Visit github.com/login/device to enter the code.'
                                                : provider === 'GitLab'
                                                  ? 'Browser unavailable. Visit gitlab.com/oauth/device to enter the code.'
                                                  : 'Browser unavailable. Try opening Notion again.'
                                            : undefined
                                    }
                                >
                                    {notice ? (
                                        <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                                    ) : (
                                        <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
                                    )}{' '}
                                    <span className="github-device-label">Open {provider}</span>
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
                          ? `Connecting ${provider}`
                          : feedback && 'message' in feedback
                            ? feedback.message
                            : ''}
                </span>
            </div>
        </div>
    )
}
