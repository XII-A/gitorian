import { useEffect, useRef, useState } from 'react'
import type { Command, Reply, State } from '../shared/model'
import { ConnectionSignIn, connectionFailure, type ConnectionFeedback } from './ConnectionSignIn'
import { useConnectionProfile } from './useConnectionProfile'

export function NotionSignIn({
    connected,
    disabled,
    run,
    onDestination
}: {
    connected: boolean
    disabled: boolean
    run: (command: Command) => Promise<Reply | undefined>
    onDestination: (destination: State['settings']['destination']) => void
}) {
    const [authorization, setAuthorization] = useState<Reply['notionAuthorization']>()
    const [feedback, setFeedback] = useState<ConnectionFeedback>()
    const [pending, setPending] = useState(false)
    const [opening, setOpening] = useState(false)
    const [notice, setNotice] = useState('')
    const [successComplete, setSuccessComplete] = useState(false)
    const attempt = useRef(0)
    const { profile, ready } = useConnectionProfile(
        'notion',
        connected || feedback?.kind === 'authorizing' || feedback?.kind === 'success'
    )
    const cancel = () => {
        attempt.current++
        setAuthorization(undefined)
        setFeedback(undefined)
        setNotice('')
        setSuccessComplete(false)
        setPending(false)
        setOpening(false)
        void window.journal.invoke({ type: 'notionCancel' }).catch(() => {
            /* The next start also cancels the previous attempt. */
        })
    }
    useEffect(
        () => () => {
            attempt.current++
            void window.journal.invoke({ type: 'notionCancel' }).catch(() => {
                /* Main-process shutdown also closes the listener. */
            })
        },
        []
    )
    useEffect(() => {
        if (!authorization) return
        const generation = attempt.current
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const reply = await window.journal.invoke({ type: 'notionPoll' })
                if (cancelled || attempt.current !== generation) return
                if (reply.notionPending) timer = setTimeout(() => void poll(), reply.notionPending.interval * 1000)
                else {
                    setAuthorization(undefined)
                    setNotice('')
                    onDestination(reply.state.settings.destination)
                    setFeedback({ kind: 'authorizing', login: 'Notion' })
                }
            } catch (error) {
                if (!cancelled && attempt.current === generation) {
                    setAuthorization(undefined)
                    setFeedback(connectionFailure(error, 'Notion'))
                }
            }
        }
        timer = setTimeout(() => void poll(), authorization.interval * 1000)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [authorization, onDestination])
    useEffect(() => {
        if (feedback?.kind !== 'authorizing' && feedback?.kind !== 'success') return
        if (feedback.kind === 'authorizing' && !ready) return
        if (feedback.kind === 'success' && successComplete) return
        let cancelled = false
        const timer = setTimeout(
            () => {
                if (feedback.kind === 'authorizing') setFeedback({ kind: 'success', login: profile?.name ?? 'Notion' })
                else
                    void run({ type: 'state' }).then((reply) => {
                        if (!cancelled) {
                            if (reply?.connections.notion) setSuccessComplete(true)
                            else setFeedback({ kind: 'error', message: 'Could not connect' })
                        }
                    })
            },
            feedback.kind === 'authorizing' ? 450 : 900
        )
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [feedback, profile?.name, ready, run, successComplete])
    useEffect(() => {
        if (feedback?.kind === 'success' && successComplete && connected) {
            setFeedback(undefined)
            setSuccessComplete(false)
        }
    }, [feedback, successComplete, connected])
    return (
        <ConnectionSignIn
            provider="Notion"
            connected={connected}
            disabled={disabled || pending}
            pending={pending}
            openingBrowser={opening}
            device={authorization}
            feedback={feedback}
            notice={notice}
            identity={
                ready && profile ? (
                    <span className="settings-github-identity">
                        <span className="settings-github-avatar" aria-hidden="true">
                            {profile.name.slice(0, 1).toUpperCase()}
                            {profile.avatarUrl && (
                                <img
                                    src={profile.avatarUrl}
                                    width={32}
                                    height={32}
                                    alt=""
                                    onLoad={(event) => {
                                        event.currentTarget.dataset.loaded = 'true'
                                    }}
                                    onError={(event) => {
                                        event.currentTarget.hidden = true
                                    }}
                                />
                            )}
                        </span>
                        <span title={profile.name}>{profile.name}</span>
                    </span>
                ) : undefined
            }
            onStart={async () => {
                const generation = ++attempt.current
                setPending(true)
                setSuccessComplete(false)
                setFeedback(undefined)
                setNotice('')
                try {
                    const reply = await window.journal.invoke({ type: 'notionStart' })
                    if (attempt.current !== generation) return
                    if (!reply.notionAuthorization) throw new Error('Notion sign-in unavailable')
                    setAuthorization(reply.notionAuthorization)
                    setNotice(reply.message ?? '')
                } catch (error) {
                    if (attempt.current === generation) setFeedback(connectionFailure(error, 'Notion'))
                } finally {
                    if (attempt.current === generation) setPending(false)
                }
            }}
            onCancel={cancel}
            onOpen={async () => {
                if (!authorization) return
                const generation = attempt.current
                setOpening(true)
                try {
                    await window.journal.invoke({ type: 'open', url: authorization.url })
                    if (attempt.current === generation) setNotice('')
                } catch {
                    if (attempt.current === generation)
                        setNotice('Copy the connection link or try opening Notion again.')
                } finally {
                    if (attempt.current === generation) setOpening(false)
                }
            }}
            onDisconnect={async () => {
                await window.journal.invoke({ type: 'disconnect', service: 'notion' })
                await run({ type: 'state' })
            }}
        />
    )
}
