import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { registerUpdateCheckpoint } from './update-checkpoint'
import type { Command, Draft, JournalNode, Reply, State } from '../shared/model'
import { draftSchema } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Editor, type EditorHandle } from './Editor'
import { journalWordCount, type EditorSnapshot } from './editor-snapshot'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { useToastStack } from './components/arc/toast-stack/toast-stack'

export interface Citation {
    id: number
    title: string
    url?: string
}
interface Props {
    state: State
    week: string
    sample: boolean
    initialWrite?: boolean
    notionConnected: boolean
    run: (command: Command) => Promise<Reply | undefined>
    citation?: Citation
    publishTarget: HTMLElement | null
    onReady: (ready: boolean) => void
    onSettings: () => void
}

export function WorkspaceDraft({
    state,
    week,
    sample,
    initialWrite = false,
    notionConnected,
    run,
    citation,
    publishTarget,
    onReady,
    onSettings
}: Props) {
    const [draft, setDraft] = useState<Draft>()
    const [status, setStatus] = useState('')
    const [recoveryConflict, setRecoveryConflict] = useState<Draft>()
    const [busy, setBusy] = useState(false)
    const [imagesReady, setImagesReady] = useState(true)
    const [words, setWords] = useState(0)
    const [focusWriting, setFocusWriting] = useState(initialWrite)
    const writingStarted = useRef(false)
    const editor = useRef<EditorHandle>(null)
    const bodySnapshot = useRef<EditorSnapshot | undefined>(undefined)
    const wordTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const { toast, dismiss } = useToastStack()
    const latest = useRef<Draft | undefined>(undefined)
    const dirty = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const checkpoint = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const pending = useRef<Promise<boolean> | undefined>(undefined)
    const mounted = useRef(true)
    const notifiedSave = useRef('')
    const drafts = state.drafts.filter((item) => item.week === week)
    const ready = !!draft && !busy && !recoveryConflict
    const storageKey = `gitorian:recovery:${sample ? 'sample' : (state.restoreId ?? 'local')}:${week}`
    const snapshot = useCallback(() => {
        if (bodySnapshot.current && latest.current) {
            latest.current = { ...latest.current, body: bodySnapshot.current.read() }
            bodySnapshot.current = undefined
        }
        return latest.current
    }, [])
    const cache = useCallback(() => {
        if (!dirty.current || !latest.current || sample) return
        try {
            localStorage.setItem(storageKey, JSON.stringify(snapshot()))
        } catch {
            if (mounted.current) setStatus('Recovery storage is unavailable. Saving to the journal…')
        }
    }, [storageKey, sample, snapshot])
    const persist = useCallback(async (): Promise<boolean> => {
        while (pending.current) {
            const saved = await pending.current
            if (!saved) return false
        }
        if (!dirty.current || !latest.current) return true
        const writing = snapshot()!
        const request = (async () => {
            const result = await run({ type: 'draft', draft: writing })
            if (!result) {
                if (mounted.current)
                    setStatus(
                        'Could not save to the journal. Retry saving; a recovery copy is kept when browser storage is available.'
                    )
                return false
            }
            const committed = result.draftSaved
            if (committed && latest.current) {
                latest.current.version = committed.version
                writing.version = committed.version
            }
            if (latest.current === writing) {
                dirty.current = false
                try {
                    if (!sample) localStorage.removeItem(storageKey)
                } catch {
                    /* The backend has saved the draft. */
                }
                if (mounted.current) setStatus(sample ? 'Sample saved on this device' : 'Saved on this device')
            }
            return true
        })()
        pending.current = request
        const result = await request
        if (pending.current === request) pending.current = undefined
        return result
    }, [run, storageKey, sample, snapshot])
    const choose = useCallback(
        (item: Draft) => {
            let recovered = item
            dirty.current = false
            setRecoveryConflict(undefined)
            try {
                const raw = localStorage.getItem(storageKey)
                const parsed = raw ? draftSchema.safeParse(JSON.parse(raw)) : undefined
                if (parsed?.success && parsed.data.id === item.id) {
                    const copy = parsed.data
                    const differs = copy.title !== item.title || JSON.stringify(copy.body) !== JSON.stringify(item.body)
                    if (differs && copy.version !== item.version) {
                        setRecoveryConflict(copy)
                    } else if (differs && copy.updatedAt > item.updatedAt) {
                        recovered = { ...copy, publishedEntryId: item.publishedEntryId }
                        dirty.current = true
                    } else if (!differs) {
                        localStorage.removeItem(storageKey)
                    }
                }
            } catch {
                /* An unavailable recovery cache does not prevent opening saved writing. */
            }
            latest.current = recovered
            bodySnapshot.current = undefined
            setDraft(recovered)
            setWords(journalWordCount(recovered.body))
            setStatus(
                dirty.current
                    ? 'Recovered your latest writing. Saving…'
                    : sample
                      ? 'Sample saved on this device'
                      : 'Saved on this device'
            )
            if (dirty.current) void persist()
        },
        [persist, storageKey, sample]
    )
    useEffect(
        () =>
            registerUpdateCheckpoint(async () => {
                if (busy) throw new Error('Finish the current journal action, then try updating again.')
                if (!imagesReady) throw new Error('Finish or cancel image imports, then try updating again.')
                flushSync(() => setBusy(true))
                clearTimeout(timer.current)
                clearTimeout(checkpoint.current)
                checkpoint.current = undefined
                cache()
                try {
                    do {
                        if (!(await persist()))
                            throw new Error('Could not save your writing. Retry saving before updating.')
                    } while (dirty.current)
                } catch (error) {
                    setBusy(false)
                    throw error
                }
                return () => setBusy(false)
            }),
        [busy, imagesReady, cache, persist]
    )
    useEffect(() => {
        const first = drafts.at(-1)
        if (!latest.current && first) {
            choose(first)
        }
        const confirmed = drafts.find((item) => item.id === latest.current?.id && item.publishedEntryId)
        if (confirmed && !latest.current?.publishedEntryId) {
            if (dirty.current) {
                latest.current = { ...latest.current!, publishedEntryId: confirmed.publishedEntryId }
                setDraft(latest.current)
            } else {
                latest.current = confirmed
                bodySnapshot.current = undefined
                setDraft(confirmed)
                setWords(journalWordCount(confirmed.body))
                setStatus(sample ? 'Sample published. Nothing was sent to Notion.' : 'Published to Notion')
            }
        }
    }, [drafts, choose, sample])
    useEffect(() => {
        onReady(ready)
        return () => onReady(false)
    }, [ready, onReady])
    useEffect(() => {
        mounted.current = true
        const flush = () => {
            cache()
            void persist()
        }
        window.addEventListener('pagehide', flush)
        return () => {
            mounted.current = false
            clearTimeout(timer.current)
            clearTimeout(checkpoint.current)
            clearTimeout(wordTimer.current)
            cache()
            window.removeEventListener('pagehide', flush)
            void persist()
        }
    }, [persist, cache])
    const edit = useCallback(
        (value: Draft, render = true) => {
            const updated = { ...value, updatedAt: new Date().toISOString() }
            latest.current = updated
            dirty.current = true
            if (render) setDraft(updated)
            setStatus('Saving…')
            clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                clearTimeout(checkpoint.current)
                checkpoint.current = undefined
                cache()
                void persist()
            }, 1000)
            if (!checkpoint.current)
                checkpoint.current = setTimeout(() => {
                    checkpoint.current = undefined
                    clearTimeout(timer.current)
                    cache()
                    void persist()
                }, 5000)
        },
        [cache, persist]
    )

    const editBody = useCallback(
        (document: EditorSnapshot) => {
            if (!latest.current) return
            bodySnapshot.current = document
            edit(latest.current, false)
            if (!wordTimer.current)
                wordTimer.current = setTimeout(() => {
                    wordTimer.current = undefined
                    const current = bodySnapshot.current
                    setWords(current ? current.wordCount() : journalWordCount(latest.current!.body))
                }, 200)
        },
        [edit]
    )
    useEffect(() => {
        if (!citation || !latest.current) return
        const content: JournalNode = {
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: citation.title,
                    ...(citation.url ? { marks: [{ type: 'link', attrs: { href: citation.url } }] } : {})
                }
            ]
        }
        editor.current?.insertBlock(content)
    }, [citation])
    const create = useCallback(async () => {
        setBusy(true)
        if (!(await persist())) {
            setBusy(false)
            return
        }
        const result = await run({ type: 'newDraft', week })
        if (!mounted.current) return
        const created = result?.state.drafts.filter((item) => item.week === week).at(-1)
        if (created) {
            setFocusWriting(true)
            choose(created)
        } else toast({ type: 'error', title: 'Could not create an entry', description: 'Try starting an entry again.' })
        setBusy(false)
    }, [persist, run, week, choose, toast])
    useEffect(() => {
        if (!initialWrite || writingStarted.current) return
        writingStarted.current = true
        if (!latest.current && drafts.length === 0) void create()
    }, [initialWrite, drafts.length, create])
    const publish = async () => {
        if (!imagesReady) return
        const updating = !!latest.current?.publishedEntryId
        setBusy(true)
        clearTimeout(timer.current)
        clearTimeout(checkpoint.current)
        checkpoint.current = undefined
        if (!(await persist()) || !latest.current) {
            setBusy(false)
            return
        }
        // A keystroke during a pending write must be saved before publishing.
        if (dirty.current && !(await persist())) {
            setBusy(false)
            return
        }
        const result = await run({ type: 'publish', draftId: latest.current.id })
        const saved = result?.state.drafts.find((item) => item.id === latest.current?.id)
        const save = result?.state.saves.filter((item) => item.draftId === latest.current?.id).at(-1)
        if (saved?.publishedEntryId && (sample || save?.status === 'confirmed')) {
            latest.current = saved
            setDraft(saved)
            setStatus(
                sample
                    ? 'Sample published. Nothing was sent to Notion.'
                    : updating
                      ? 'Updated in Notion'
                      : 'Published to Notion'
            )
            toast({
                id: 'workspace-publish-success',
                type: 'success',
                title: sample ? 'Sample published' : updating ? 'Updated in Notion' : 'Published to Notion',
                ...(sample ? { description: 'Nothing was sent to Notion.' } : {})
            })
        } else if (!result || !result.state.saves.some((save) => save.draftId === latest.current?.id))
            toast({
                id: 'workspace-publish',
                type: 'error',
                title: 'Could not publish to Notion',
                description: 'Draft saved. Check Notion settings and retry.',
                action: { label: 'Review settings', onClick: onSettings }
            })
        setBusy(false)
    }
    const publishSave = state.saves.filter((save) => save.draftId === draft?.id).at(-1)
    const uncertain = !!publishSave && ['unknown', 'pending'].includes(publishSave.status)
    const verify = useCallback(
        async function verifySave(saveId: string): Promise<void> {
            const result = await run({ type: 'reconcile', saveId })
            if (!result || result.state.saves.find((save) => save.id === saveId)?.status !== 'confirmed')
                toast({
                    id: 'workspace-publish',
                    type: 'error',
                    title: 'Notion has not confirmed this save',
                    description: 'Your draft is safe. Inspect Notion or try verification again before publishing.',
                    duration: Infinity,
                    action: {
                        label: 'Verify again',
                        onClick: () => {
                            void verifySave(saveId)
                        }
                    }
                })
        },
        [run, toast]
    )
    useEffect(() => {
        const save = publishSave
        if (!save || save.status === 'confirmed') {
            notifiedSave.current = ''
            dismiss('workspace-publish')
            return
        }
        if (save.status === 'pending') return
        const key = `${save.id}:${save.status}:${save.error ?? ''}`
        if (key === notifiedSave.current) return
        notifiedSave.current = key
        const unknown = save.status === 'unknown'
        toast({
            id: 'workspace-publish',
            type: 'error',
            title: unknown ? 'Verify the Notion save' : 'Could not publish to Notion',
            description: unknown
                ? 'Your draft is safe. Verify the previous save before publishing again.'
                : 'Draft saved. Check Notion settings and retry.',
            duration: Infinity,
            action: unknown
                ? {
                      label: 'Verify save',
                      onClick: () => {
                          void verify(save.id)
                      }
                  }
                : { label: 'Review settings', onClick: onSettings }
        })
    }, [publishSave, toast, dismiss, verify, onSettings])
    const needsNotion = !sample && (!notionConnected || !state.settings.destination)
    const entryTemplate = state.settings.template.content?.some(
        (node) => node.type !== 'paragraph' || plainText(node).trim()
    )
        ? state.settings.template
        : undefined
    return (
        <section data-journal-drop-zone className="ws-writing" aria-label="Weekly journal">
            {publishTarget &&
                createPortal(
                    <Button
                        size="sm"
                        loading={busy}
                        disabled={!draft || uncertain || needsNotion || !imagesReady || !!recoveryConflict}
                        title={
                            !imagesReady
                                ? 'Finish or dismiss image imports before publishing'
                                : !draft
                                  ? 'Start an entry before publishing'
                                  : uncertain
                                    ? 'Verify the previous Notion save before publishing again'
                                    : needsNotion
                                      ? 'Connect Notion in settings to publish'
                                      : undefined
                        }
                        onClick={publish}
                    >
                        {sample ? 'Publish sample' : draft?.publishedEntryId ? 'Update in Notion' : 'Publish to Notion'}
                    </Button>,
                    publishTarget
                )}
            <ScrollArea className="ws-paper-scroll" label="Entry writing space" fade={20}>
                <div className="ws-paper">
                    {draft ? (
                        <>
                            <h1 className="ws-title" aria-label={draft.title || 'Untitled weekly entry'}>
                                <textarea
                                    aria-label="Entry title"
                                    value={draft.title}
                                    placeholder="Entry title"
                                    readOnly={busy || !!recoveryConflict}
                                    rows={2}
                                    onChange={(event) => edit({ ...snapshot()!, title: event.target.value })}
                                />
                            </h1>
                            <Editor
                                key={draft.id}
                                restoreId={state.restoreId}
                                allowImageImport={!sample}
                                onImagesReadyChange={setImagesReady}
                                ref={editor}
                                value={draft.body}
                                template={entryTemplate}
                                onEdit={editBody}
                                readOnly={busy || !!recoveryConflict}
                                autoFocus={focusWriting}
                            />
                        </>
                    ) : (
                        <div className="ws-new-entry">
                            <h1>No entry for this week yet</h1>
                            <p>Write about what changed, what worked, and what you learned.</p>
                            <Button loading={busy} onClick={create}>
                                Start this week’s entry
                            </Button>
                        </div>
                    )}
                </div>
            </ScrollArea>
            <footer className={`ws-writing-footer${needsNotion ? ' ws-needs-notion' : ''}`}>
                <span>{draft ? `${words} words` : '0 words'}</span>
                <span role="status">
                    {status && !recoveryConflict && <WorkspaceIcon name="check" width="14" height="14" />}
                    {recoveryConflict ? 'Saved writing changed elsewhere. Choose which copy to keep.' : status}
                </span>
                {recoveryConflict && (
                    <div className="ws-recovery-actions" role="group" aria-label="Resolve writing conflict">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                const recovered = {
                                    ...recoveryConflict,
                                    version: latest.current!.version,
                                    publishedEntryId: latest.current!.publishedEntryId
                                }
                                latest.current = recovered
                                bodySnapshot.current = undefined
                                dirty.current = true
                                setRecoveryConflict(undefined)
                                setDraft(recovered)
                                setWords(journalWordCount(recovered.body))
                                cache()
                                void persist()
                            }}
                        >
                            Use recovery copy
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                try {
                                    localStorage.removeItem(storageKey)
                                } catch {
                                    /* The saved draft remains authoritative. */
                                }
                                setRecoveryConflict(undefined)
                            }}
                        >
                            Keep saved writing
                        </Button>
                    </div>
                )}
                {dirty.current && status.startsWith('Could not') && (
                    <Button className="ws-retry-saving" variant="ghost" size="sm" onClick={persist}>
                        Retry saving
                    </Button>
                )}
                {needsNotion ? (
                    <Button className="ws-notion-connect" variant="ghost" size="sm" onClick={onSettings}>
                        Connect Notion in settings
                    </Button>
                ) : (
                    <span className="ws-slash-hint">
                        <kbd>/</kbd> for formatting
                    </span>
                )}
            </footer>
        </section>
    )
}
