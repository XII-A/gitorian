import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CheckCircle, ExternalLink, CircleAlert } from 'lucide-react'
import type { Reply } from '../shared/model'
import { Button } from './components/arc/button/button'
import { CopyButton } from './components/arc/copy-button/copy-button'
import { motionTokens } from './components/arc/lib/motion-tokens'

export type GitHubSignInFeedback = { kind: 'error' | 'expired'; message: string } | { kind: 'success'; login: string }

export function githubSignInFailure(failure: unknown): GitHubSignInFeedback {
    const message = failure instanceof Error ? failure.message : String(failure)
    if (/expired/i.test(message))
        return { kind: 'expired', message: 'This code has expired. Start again to get a new code.' }
    if (/client ID|incorrect_client_credentials/i.test(message))
        return { kind: 'error', message: 'Check the OAuth client ID in your GitHub app settings, then try again.' }
    if (/device flow|device_flow_disabled/i.test(message))
        return { kind: 'error', message: 'Enable device flow in your GitHub OAuth app, then try again.' }
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
    onStart,
    onCancel,
    onOpen
}: {
    device?: Reply['device']
    feedback?: GitHubSignInFeedback
    notice?: string
    pending: boolean
    openingBrowser: boolean
    disabled: boolean
    onStart: () => void | Promise<void>
    onCancel: () => void
    onOpen: () => void | Promise<void>
}) {
    const expanded = !!device || !!feedback
    const reduce = useReducedMotion()
    const track = useRef<HTMLDivElement>(null)
    const content = useRef<HTMLDivElement>(null)
    const startButton = useRef<HTMLButtonElement>(null)
    const retryButton = useRef<HTMLButtonElement>(null)
    const wasExpanded = useRef(expanded)
    const [room, setRoom] = useState<number>()
    const [size, setSize] = useState<{ width: number; height: number }>()

    // Lay content out at its final width while the outer surface grows, keeping letters and controls undistorted.
    useLayoutEffect(() => {
        const node = track.current
        if (!node) return
        const measure = () => setRoom(node.clientWidth)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    useLayoutEffect(() => {
        const node = content.current
        if (!node) return
        const measure = () => {
            const width = node.offsetWidth
            const height = node.offsetHeight
            setSize((old) => (old?.width === width && old.height === height ? old : { width, height }))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
    }, [expanded, device, feedback, room])
    useEffect(() => {
        if (device)
            content.current?.querySelector<HTMLButtonElement>('[data-copy-state]')?.focus({ preventScroll: true })
        else if (feedback && feedback.kind !== 'success') retryButton.current?.focus({ preventScroll: true })
        else if (wasExpanded.current && !expanded) startButton.current?.focus({ preventScroll: true })
        wasExpanded.current = expanded
    }, [device, feedback, expanded])

    const phase = device ? 'device' : feedback ? feedback.kind : 'idle'
    return (
        <div ref={track} className="github-signin-track">
            <motion.div
                className="github-signin-surface"
                data-expanded={expanded}
                data-phase={phase}
                initial={false}
                animate={{
                    width: expanded ? (room ?? '100%') : size ? size.width + 2 : 'auto',
                    height: size ? size.height + 2 : 'auto'
                }}
                transition={reduce ? { duration: 0 } : motionTokens.spring.smooth}
            >
                <div
                    ref={content}
                    className="github-signin-content"
                    style={{ width: expanded && room !== undefined ? Math.max(0, room - 2) : 'max-content' }}
                >
                    <AnimatePresence initial={false} mode="popLayout">
                        <motion.div
                            key={phase === 'idle' ? 'idle' : 'expanded'}
                            className={expanded ? 'github-signin-details' : undefined}
                            initial={reduce ? false : { opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={reduce ? undefined : { opacity: 0, y: -2 }}
                            transition={{
                                duration: reduce ? 0 : motionTokens.duration.fast,
                                ease: motionTokens.ease.standard
                            }}
                        >
                            {device ? (
                                <>
                                    <div className="github-signin-code-row">
                                        <code className="github-signin-code">{device.code}</code>
                                        <CopyButton
                                            value={device.code}
                                            label="Copy code"
                                            className="github-signin-copy"
                                        />
                                    </div>
                                    {notice && (
                                        <p className="settings-hint" role="alert">
                                            {notice}
                                        </p>
                                    )}
                                    <div className="settings-actions">
                                        <Button
                                            variant="secondary"
                                            loading={openingBrowser}
                                            disabled={disabled}
                                            onClick={onOpen}
                                        >
                                            <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" /> Open GitHub
                                        </Button>
                                        <Button variant="ghost" onClick={onCancel}>
                                            Cancel sign-in
                                        </Button>
                                    </div>
                                </>
                            ) : feedback?.kind === 'success' ? (
                                <p className="github-signin-result" role="status">
                                    <CheckCircle size={20} strokeWidth={1.5} aria-hidden="true" />
                                    <span>Connected as {feedback.login}</span>
                                </p>
                            ) : feedback ? (
                                <>
                                    <div role="alert" className="github-signin-error">
                                        <p className="github-signin-result">
                                            <CircleAlert size={20} strokeWidth={1.5} aria-hidden="true" />
                                            <span>
                                                {feedback.kind === 'expired'
                                                    ? 'Code expired'
                                                    : 'Sign-in could not be completed'}
                                            </span>
                                        </p>
                                        <p className="settings-hint">{feedback.message}</p>
                                    </div>
                                    <div className="settings-actions">
                                        <Button
                                            ref={retryButton}
                                            variant="secondary"
                                            loading={pending}
                                            disabled={disabled}
                                            onClick={onStart}
                                        >
                                            Try sign-in again
                                        </Button>
                                        <Button variant="ghost" disabled={pending} onClick={onCancel}>
                                            Cancel sign-in
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <Button
                                    ref={startButton}
                                    variant="secondary"
                                    loading={pending}
                                    disabled={disabled || openingBrowser}
                                    onClick={onStart}
                                >
                                    Sign in with browser
                                </Button>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    )
}
