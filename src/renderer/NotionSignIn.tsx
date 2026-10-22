import { useEffect, useRef, useState } from 'react'
import type { Command, Reply, State, NotionPage, NotionDiscoveryProgress } from '../shared/model'
import { ConnectionSignIn, connectionFailure, type ConnectionFeedback } from './ConnectionSignIn'
import { NotionPagePicker, NotionPageIcon } from './NotionPagePicker'
import { Input } from './components/arc/input/input'
import { Button } from './components/arc/button/button'
import { NotionDiscoveryStatus, notionDiscoveryLabel } from './NotionDiscoveryStatus'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { ConfirmMorph } from './components/arc/confirm-morph/confirm-morph'
import { useDisconnectTransition } from './useDisconnectTransition'
import { motion, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/lib/motion-tokens'

export function NotionSignIn({
    connected,
    destination,
    disabled,
    run,
    onDestination
}: {
    connected: boolean
    destination?: State['settings']['destination']
    disabled: boolean
    run: (command: Command) => Promise<Reply | undefined>
    onDestination: (destination: State['settings']['destination']) => void
}) {
    const [pages, setPages] = useState<NotionPage[]>()
    const [selected, setSelected] = useState('')
    const [pageName, setPageName] = useState('Weekly Journal')
    const [progress, setProgress] = useState<NotionDiscoveryProgress>({ stage: 'discovering', found: 0 })
    const [stage, setStage] = useState<'load' | 'choose' | 'confirm'>()
    const [selectionError, setSelectionError] = useState<'load' | 'choose' | 'confirm'>()
    const [authorization, setAuthorization] = useState<Reply['notionAuthorization']>()
    const [feedback, setFeedback] = useState<ConnectionFeedback>()
    const [pending, setPending] = useState(false)
    const [opening, setOpening] = useState(false)
    const [notice, setNotice] = useState('')
    const [successComplete, setSuccessComplete] = useState(false)
    const attempt = useRef(0)
    const disconnect = useDisconnectTransition(connected)
    const reduced = useReducedMotion()
    const pageControl = useRef<HTMLDivElement>(null)
    const wasDisconnecting = useRef(disconnect.showDisconnect)
    useEffect(() => {
        if (wasDisconnecting.current && !disconnect.showDisconnect)
            pageControl.current?.querySelector<HTMLButtonElement>('[aria-label="Connect Notion"]')?.focus()
        wasDisconnecting.current = disconnect.showDisconnect
    }, [disconnect.showDisconnect])
    useEffect(() => {
        if (!connected || (destination?.title && destination.icon !== undefined)) return
        let cancelled = false
        void run({ type: 'notionDestination' }).then((reply) => {
            if (!cancelled && reply) onDestination(reply.state.settings.destination)
        })
        return () => {
            cancelled = true
        }
    }, [connected, destination?.title, destination?.icon, run, onDestination])
    const cancel = () => {
        attempt.current++
        setAuthorization(undefined)
        setPages(undefined)
        setStage(undefined)
        setSelected('')
        setSelectionError(undefined)
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
    const loadPages = async (generation = attempt.current) => {
        setStage('load')
        setProgress({ stage: 'discovering', found: 0 })
        setSelectionError(undefined)
        setFeedback({ kind: 'authorizing', login: 'Notion' })
        const requestId = crypto.randomUUID()
        const unsubscribe = window.journal.onNotionDiscoveryProgress?.((event) => {
            if (event.requestId === requestId && attempt.current === generation) setProgress(event.progress)
        })
        try {
            const reply = await window.journal.invoke({ type: 'notionPages', requestId })
            if (attempt.current !== generation) return
            setPages(reply.notionPages ?? [])
            setStage('choose')
            setFeedback(undefined)
        } catch {
            if (attempt.current === generation) {
                setSelectionError('load')
                setFeedback({ kind: 'error', message: 'Could not load pages' })
            }
        } finally {
            unsubscribe?.()
        }
    }
    const confirm = async () => {
        const generation = attempt.current
        setStage('confirm')
        setSelectionError(undefined)
        setFeedback({ kind: 'authorizing', login: 'Notion' })
        try {
            const reply = await window.journal.invoke({
                type: 'notionConfirm',
                selection:
                    selected === 'new'
                        ? { kind: 'new', title: pageName.trim() }
                        : { kind: 'existing', pageId: selected }
            })
            if (attempt.current !== generation) {
                await run({ type: 'state' })
                return
            }
            onDestination(reply.state.settings.destination)
            setPages(undefined)
            setStage(undefined)
        } catch {
            if (attempt.current === generation) {
                setSelectionError('confirm')
                setFeedback({ kind: 'error', message: 'Could not save page' })
            }
        }
    }
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
                    void loadPages(generation)
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
    }, [authorization])
    useEffect(() => {
        if (stage) return
        if (feedback?.kind !== 'authorizing' && feedback?.kind !== 'success') return
        if (feedback.kind === 'success' && successComplete) return
        let cancelled = false
        const timer = setTimeout(
            () => {
                if (feedback.kind === 'authorizing')
                    setFeedback({ kind: 'success', login: destination?.title ?? 'Notion' })
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
    }, [feedback, destination?.title, run, successComplete, stage])
    useEffect(() => {
        if (feedback?.kind === 'success' && successComplete && connected) {
            setFeedback(undefined)
            setSuccessComplete(false)
        }
    }, [feedback, successComplete, connected])
    const choose = async () => {
        if (!destination) return
        const generation = ++attempt.current
        setPending(true)
        setStage('load')
        setProgress({ stage: 'discovering', found: 0 })
        setSelectionError(undefined)
        setFeedback({ kind: 'authorizing', login: 'Notion' })
        setSuccessComplete(false)
        try {
            const reply = await window.journal.invoke({ type: 'notionChoose' })
            if (attempt.current !== generation) return
            setSelected(destination.id)
            if (reply.notionAuthorization) {
                setStage(undefined)
                setFeedback(undefined)
                setAuthorization(reply.notionAuthorization)
            } else await loadPages(generation)
        } catch (error) {
            if (attempt.current === generation) {
                setSelectionError('choose')
                setFeedback(connectionFailure(error, 'Notion'))
            }
        } finally {
            if (attempt.current === generation) setPending(false)
        }
    }
    const disconnectNotion = async () => {
        await window.journal.invoke({ type: 'disconnect', service: 'notion' })
        await run({ type: 'state' })
    }
    const loadingLabel = notionDiscoveryLabel(progress)
    const showDisconnect = disconnect.showDisconnect && !stage && !authorization && !feedback && !pending
    return (
        <div className="notion-connection" data-connected={connected}>
            {stage === 'load' && (
                <span className="settings-sr-only" role="status" aria-live="polite">
                    {loadingLabel}
                </span>
            )}
            <div
                ref={pageControl}
                className="notion-page-connection"
                hidden={disconnect.state !== 'idle' || (!connected && disconnect.showDisconnect)}
            >
                <ConnectionSignIn
                    provider="Notion"
                    connected={connected}
                    disabled={disabled || pending || disconnect.state !== 'idle'}
                    pending={pending}
                    openingBrowser={opening}
                    device={authorization}
                    feedback={feedback}
                    notice={notice}
                    pendingLabel={stage === 'load' ? loadingLabel : stage === 'confirm' ? 'Saving page' : undefined}
                    expandPending={stage === 'load' || stage === 'confirm'}
                    pendingContent={stage === 'load' ? <NotionDiscoveryStatus progress={progress} /> : undefined}
                    selection={
                        pages && stage === 'choose' ? (
                            <div className="github-signin-code-row notion-destination-row">
                                <div className="notion-page-field">
                                    {selected === 'new' ? (
                                        <Input
                                            label="Page name"
                                            hideLabel
                                            variant="inline"
                                            value={pageName}
                                            maxLength={200}
                                            onChange={(event) => setPageName(event.target.value)}
                                            autoFocus
                                        />
                                    ) : (
                                        <NotionPagePicker pages={pages} value={selected} onChange={setSelected} />
                                    )}
                                </div>
                                {selected === 'new' && (
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="notion-picker-action"
                                        aria-label="Choose an existing page"
                                        onClick={() => setSelected('')}
                                    >
                                        <ArrowLeft size={16} strokeWidth={1.5} />
                                    </Button>
                                )}
                                <Button size="sm" variant="ghost" className="github-device-action" onClick={cancel}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="github-device-action"
                                    disabled={disabled || !selected || (selected === 'new' && !pageName.trim())}
                                    onClick={confirm}
                                >
                                    Confirm
                                </Button>
                            </div>
                        ) : undefined
                    }
                    connectedAction={
                        destination
                            ? {
                                  name: `Change journal page: ${destination.title || 'Journal page'}`,
                                  label: (
                                      <span className="notion-destination-identity">
                                          <NotionPageIcon icon={destination.icon} />
                                          <span
                                              className="notion-page-title"
                                              title={destination.title || 'Journal page'}
                                          >
                                              {destination.title || 'Journal page'}
                                          </span>
                                          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                                      </span>
                                  ),
                                  onActivate: choose
                              }
                            : undefined
                    }
                    onStart={async () => {
                        if (selectionError === 'choose') return choose()
                        if (selectionError === 'load') return loadPages()
                        if (selectionError === 'confirm') return confirm()
                        const generation = ++attempt.current
                        setPages(undefined)
                        setSelected('')
                        setStage(undefined)
                        setSelectionError(undefined)
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
                    errorCancelLabel={selectionError && selectionError !== 'choose' ? 'Back' : 'Cancel'}
                    onCancel={
                        selectionError && selectionError !== 'choose'
                            ? () => {
                                  setFeedback(undefined)
                                  setSelectionError(undefined)
                                  setStage('choose')
                                  setPages((pages) => pages ?? [])
                              }
                            : cancel
                    }
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
                    onDisconnect={disconnectNotion}
                />
            </div>
            <motion.div
                data-notion-disconnect
                className="notion-disconnect-slot"
                inert={!showDisconnect}
                aria-hidden={!showDisconnect}
                initial={false}
                animate={{ width: showDisconnect ? 'auto' : 0, opacity: showDisconnect ? 1 : 0 }}
                transition={{
                    width: reduced
                        ? { duration: 0 }
                        : { ...motionTokens.spring.smooth, visualDuration: motionTokens.duration.standard },
                    opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }
                }}
            >
                <div className="notion-disconnect-content">
                    <ConfirmMorph
                        className="notion-disconnect-action"
                        label="Disconnect"
                        actionLabel="Disconnect Notion"
                        prompt={<span className="settings-disconnect-question">Disconnect Notion?</span>}
                        confirmLabel="Disconnect"
                        confirmMode="hold"
                        variant="secondary"
                        state={disconnect.state}
                        onStateChange={disconnect.setState}
                        confirmTimeout={0}
                        resultTimeout={0}
                        pendingLabel="Disconnecting"
                        doneLabel="Disconnected"
                        errorLabel="Could not disconnect"
                        disabled={disabled}
                        onConfirm={disconnectNotion}
                    />
                </div>
            </motion.div>
        </div>
    )
}
