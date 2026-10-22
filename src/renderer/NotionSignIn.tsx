import { useEffect, useRef, useState } from 'react'
import type { Command, Reply, State, NotionPage } from '../shared/model'
import { ConnectionSignIn, connectionFailure, type ConnectionFeedback } from './ConnectionSignIn'
import { NotionPagePicker, NotionPageIcon } from './NotionPagePicker'
import { Input } from './components/arc/input/input'
import { Button } from './components/arc/button/button'
import { ArrowLeft, Pencil } from 'lucide-react'

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
    const [stage, setStage] = useState<'load' | 'choose' | 'confirm'>()
    const [selectionError, setSelectionError] = useState<'load' | 'confirm'>()
    const [authorization, setAuthorization] = useState<Reply['notionAuthorization']>()
    const [feedback, setFeedback] = useState<ConnectionFeedback>()
    const [pending, setPending] = useState(false)
    const [opening, setOpening] = useState(false)
    const [notice, setNotice] = useState('')
    const [successComplete, setSuccessComplete] = useState(false)
    const attempt = useRef(0)
    useEffect(() => {
        if (!connected || (destination?.title && destination.icon !== undefined)) return
        let cancelled = false
        void run({ type: 'notionDestination' }).then((reply) => {
            if (!cancelled && reply) onDestination(reply.state.settings.destination)
        })
        return () => {
            cancelled = true
        }
    }, [connected, run, onDestination])
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
        setSelectionError(undefined)
        setFeedback({ kind: 'authorizing', login: 'Notion' })
        try {
            const reply = await window.journal.invoke({ type: 'notionPages' })
            if (attempt.current !== generation) return
            setPages(reply.notionPages ?? [])
            setStage('choose')
            setFeedback(undefined)
        } catch {
            if (attempt.current === generation) {
                setSelectionError('load')
                setFeedback({ kind: 'error', message: 'Could not load pages' })
            }
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
    return (
        <div className="notion-connection">
            <ConnectionSignIn
                provider="Notion"
                connected={connected}
                disabled={disabled || pending}
                pending={pending}
                openingBrowser={opening}
                device={authorization}
                feedback={feedback}
                notice={notice}
                pendingLabel={stage === 'load' ? 'Loading pages' : stage === 'confirm' ? 'Saving page' : undefined}
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
                identity={
                    destination &&
                    !stage &&
                    !authorization &&
                    (connected || feedback?.kind === 'authorizing' || feedback?.kind === 'success') ? (
                        <span className="notion-destination-identity">
                            <NotionPageIcon icon={destination.icon} />
                            <span className="notion-page-title" title={destination.title || 'Journal page'}>
                                {destination.title || 'Journal page'}
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="notion-edit-page"
                                aria-label="Change journal page"
                                disabled={disabled}
                                onClick={async () => {
                                    const generation = ++attempt.current
                                    setPending(true)
                                    setSuccessComplete(false)
                                    try {
                                        const reply = await window.journal.invoke({ type: 'notionChoose' })
                                        if (attempt.current !== generation) return
                                        setSelected(destination.id)
                                        if (reply.notionAuthorization) setAuthorization(reply.notionAuthorization)
                                        else void loadPages(generation)
                                    } catch (error) {
                                        if (attempt.current === generation)
                                            setFeedback(connectionFailure(error, 'Notion'))
                                    } finally {
                                        if (attempt.current === generation) setPending(false)
                                    }
                                }}
                            >
                                <Pencil size={16} strokeWidth={1.5} />
                            </Button>
                        </span>
                    ) : undefined
                }
                onStart={async () => {
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
                errorCancelLabel={selectionError ? 'Back' : 'Cancel'}
                onCancel={
                    selectionError
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
                onDisconnect={async () => {
                    await window.journal.invoke({ type: 'disconnect', service: 'notion' })
                    await run({ type: 'state' })
                }}
            />
        </div>
    )
}
