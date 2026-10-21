import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ExternalLink, CircleAlert, LoaderCircle } from 'lucide-react'
import type { Reply } from '../shared/model'
import { Button } from './components/arc/button/button'
import { CopyButton } from './components/arc/copy-button/copy-button'
import { ConfirmMorph } from './components/arc/confirm-morph/confirm-morph'
import { motionTokens } from './components/arc/lib/motion-tokens'

export type GitHubSignInFeedback =
    | { kind: 'error' | 'expired'; message: string }
    | { kind: 'authorizing' | 'success'; login: string }

export function githubSignInFailure(failure: unknown): GitHubSignInFeedback {
    const message = failure instanceof Error ? failure.message : String(failure)
    if (/expired/i.test(message))
        return { kind: 'expired', message: 'This code has expired. Start again to get a new code.' }
    if (/sign-in is unavailable|incorrect_client_credentials|device_flow_disabled/i.test(message))
        return {
            kind: 'error',
            message: 'GitHub sign-in is unavailable. Check for a weekly-j update or contact the maintainer.'
        }
    if (/declined|access_denied/i.test(message))
        return { kind: 'error', message: 'Authorization was declined. Start again when you are ready.' }
    return { kind: 'error', message: 'GitHub sign-in could not be completed. Check your connection and try again.' }
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
    const phase = device ? 'device' : feedback ? feedback.kind : connected ? 'connected' : pending ? 'starting' : 'idle'
    const expanded = phase === 'device' || phase === 'error' || phase === 'expired'
    const reduce = useReducedMotion()
    const track = useRef<HTMLDivElement>(null)
    const account = useRef<HTMLDivElement>(null)
    const restingWidth = useRef(86)
    const content = useRef<HTMLDivElement>(null)
    const startButton = useRef<HTMLButtonElement>(null)
    const retryButton = useRef<HTMLButtonElement>(null)
    const previousPhase = useRef(phase)
    const [room, setRoom] = useState<number>()
    const [size, setSize] = useState<{ width: number; height: number }>()

    useLayoutEffect(() => {
        const node = track.current
        if (!node) return
        const measure = () =>
            setRoom(
                node.clientWidth -
                    (account.current
                        ? account.current.offsetWidth + (parseFloat(getComputedStyle(node).columnGap) || 0)
                        : 0)
            )
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        if (account.current) observer.observe(account.current)
        return () => observer.disconnect()
    }, [identity])
    useLayoutEffect(() => {
        const node = content.current
        if (!node) return
        const measure = () => {
            const width = node.offsetWidth
            const height = node.offsetHeight
            if (phase === 'idle') restingWidth.current = width
            setSize((old) => (old?.width === width && old.height === height ? old : { width, height }))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [phase, room])
    useEffect(() => {
        if (phase === 'device')
            content.current?.querySelector<HTMLButtonElement>('[data-copy-state]')?.focus({ preventScroll: true })
        else if (phase === 'error' || phase === 'expired') retryButton.current?.focus({ preventScroll: true })
        else if (previousPhase.current !== 'idle' && phase === 'idle')
            startButton.current?.focus({ preventScroll: true })
        else if (previousPhase.current !== 'connected' && phase === 'connected')
            content.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
        previousPhase.current = phase
    }, [phase])

    return (
        <div ref={track} className="github-signin-track">
            {identity && (
                <div ref={account} className="settings-github-account">
                    {identity}
                </div>
            )}
            <motion.div
                className="github-signin-surface"
                data-expanded={expanded}
                data-phase={phase}
                initial={false}
                animate={{
                    width: phase === 'connected' ? 'auto' : size ? size.width + 2 : 'auto',
                    height: phase === 'connected' ? 'auto' : size ? size.height + 2 : 'auto'
                }}
                transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && expanded) {
                        event.preventDefault()
                        event.stopPropagation()
                        onCancel()
                    }
                }}
            >
                <div
                    ref={content}
                    className="github-signin-content"
                    style={{ maxWidth: room === undefined ? undefined : Math.max(0, room - 2) }}
                >
                    <AnimatePresence initial={false} mode="popLayout">
                        <motion.div
                            key={phase}
                            className="github-signin-face"
                            initial={reduce ? false : { opacity: 0, filter: 'blur(4px)', transform: 'translateY(3px)' }}
                            animate={{ opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' }}
                            exit={
                                reduce ? undefined : { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-2px)' }
                            }
                            transition={{
                                duration: reduce ? 0 : motionTokens.duration.fast,
                                ease: motionTokens.ease.standard
                            }}
                        >
                            {phase === 'device' && device ? (
                                <div className="github-signin-details">
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
                                        <Button variant="ghost" onClick={onCancel}>
                                            Cancel sign-in
                                        </Button>
                                        <Button loading={openingBrowser} disabled={disabled} onClick={onOpen}>
                                            <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" /> Open GitHub
                                        </Button>
                                    </div>
                                    <span className="settings-sr-only">
                                        Enter this code on GitHub to authorize weekly-j.
                                    </span>
                                    {notice && (
                                        <p className="settings-hint" role="alert">
                                            {notice}
                                        </p>
                                    )}
                                </div>
                            ) : phase === 'starting' || phase === 'authorizing' ? (
                                <div
                                    className="github-signin-compact"
                                    style={{ width: restingWidth.current }}
                                    role="status"
                                >
                                    <LoaderCircle
                                        size={18}
                                        strokeWidth={1.5}
                                        aria-hidden="true"
                                        className="github-signin-spinner"
                                    />
                                    <span className="settings-sr-only">
                                        {phase === 'starting' ? 'Starting GitHub sign-in' : 'Connecting GitHub'}
                                    </span>
                                </div>
                            ) : feedback?.kind === 'success' ? (
                                <div
                                    className="github-signin-compact"
                                    style={{ width: restingWidth.current }}
                                    role="status"
                                >
                                    <Check size={20} strokeWidth={1.5} aria-hidden="true" />
                                    <span className="settings-sr-only">Connected as {feedback.login}</span>
                                </div>
                            ) : feedback && (feedback.kind === 'error' || feedback.kind === 'expired') ? (
                                <div className="github-signin-details">
                                    <div role="alert" className="github-signin-error">
                                        <p className="github-signin-result">
                                            <CircleAlert size={18} strokeWidth={1.5} aria-hidden="true" />
                                            <span>
                                                {feedback.kind === 'expired' ? 'Code expired' : 'Could not connect'}
                                            </span>
                                        </p>
                                        <p className="settings-hint">{feedback.message}</p>
                                    </div>
                                    <div className="settings-actions">
                                        <Button
                                            ref={retryButton}
                                            variant="secondary"
                                            disabled={disabled}
                                            onClick={onStart}
                                        >
                                            Try sign-in again
                                        </Button>
                                        <Button variant="ghost" onClick={onCancel}>
                                            Cancel sign-in
                                        </Button>
                                    </div>
                                </div>
                            ) : connected ? (
                                <ConfirmMorph
                                    label="Disconnect"
                                    prompt={<span className="settings-disconnect-question">Disconnect GitHub?</span>}
                                    confirmLabel="Disconnect"
                                    confirmMode="hold"
                                    variant="secondary"
                                    pendingLabel="Disconnecting"
                                    doneLabel="Disconnected"
                                    errorLabel="Could not disconnect"
                                    tone="danger"
                                    disabled={disabled}
                                    onConfirm={onDisconnect}
                                />
                            ) : (
                                <Button
                                    ref={startButton}
                                    aria-label="Connect GitHub"
                                    variant="ghost"
                                    disabled={disabled || openingBrowser}
                                    onClick={onStart}
                                >
                                    Connect
                                </Button>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    )
}
