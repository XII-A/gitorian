import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { registerUpdateCheckpoint } from './update-checkpoint'
import type { Command, Draft, Reply, State } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Editor, type EditorHandle } from './Editor'
import { journalWordCount } from './editor-snapshot'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { useToastStack } from './components/arc/toast-stack/toast-stack'
import { WritingClient } from './writing-client'
import { bodySchema, titleSchema } from '../shared/writing-schema'
import { WritingTitle } from './WritingTitle'
import { settleWritingSelections } from './writing-commands'
import { draftSchema } from '../shared/model'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'

export interface Citation {
    id: number
    title: string
    url?: string
}
interface Props {
    state: State
    week: string
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
    initialWrite = false,
    notionConnected,
    run,
    citation,
    publishTarget,
    onReady,
    onSettings
}: Props) {
    const savedDraft = state.drafts.find((d) => d.week === week)
    const [draft, setDraft] = useState<Draft | undefined>(savedDraft)
    const [sessions, setSessions] = useState<{ body: WritingClient; title: WritingClient }>()
    const [opening, setOpening] = useState(false)
    const [retrying, setRetrying] = useState(false)
    const [openAttempt, setOpenAttempt] = useState(0)
    const [status, setStatus] = useState('Opening writing...')
    const [rejectedRevision, setRejectedRevision] = useState(0)
    const fieldStatus = useRef({ body: '', title: '' })
    const report = useCallback((field: 'body' | 'title', value: string) => {
        if (value.startsWith('Could not add')) setRejectedRevision((revision) => revision + 1)
        fieldStatus.current[field] = value
        const values = Object.values(fieldStatus.current)
        setStatus(
            values.find((v) => v.startsWith('Could not') || v.startsWith('Recovery storage')) ??
                (values.some((v) => v.startsWith('Saving')) ? 'Saving...' : value)
        )
    }, [])
    const [busy, setBusy] = useState(false)
    const [frozen, setFrozen] = useState(false)
    const holds = useRef(new Set<symbol>())
    const [focusWriting, setFocusWriting] = useState(initialWrite)
    const [imagesReady, setImagesReady] = useState(true)
    const [legacyRecovery, setLegacyRecovery] = useState<Draft>()
    const [words, setWords] = useState(savedDraft ? journalWordCount(savedDraft.body) : 0)
    const editor = useRef<EditorHandle>(null)
    const notifiedSave = useRef('')
    const started = useRef(false)
    const { toast, dismiss, update } = useToastStack()
    const legacyKey = `gitorian:recovery:${state.restoreId ?? 'local'}:${week}`
    const readLegacy = useEffectEvent(() => {
        try {
            const raw = localStorage.getItem(legacyKey)
            if (!raw || !savedDraft) return
            const copy = draftSchema.parse(JSON.parse(raw))
            if (
                copy.id === savedDraft.id &&
                (copy.title !== savedDraft.title || JSON.stringify(copy.body) !== JSON.stringify(savedDraft.body))
            )
                setLegacyRecovery(copy)
            else localStorage.removeItem(legacyKey)
        } catch {
            setStatus('Could not read the previous recovery copy. Keep this profile available.')
        }
    })
    useEffect(() => readLegacy(), [legacyKey, savedDraft?.id])
    const resetDraft = useEffectEvent(() => setDraft(savedDraft))
    useEffect(() => resetDraft(), [savedDraft?.id])
    const draftId = draft?.id
    useEffect(() => {
        if (!draftId || !state.restoreId || !window.journal.writing) return
        let disposed = false
        const clients: WritingClient[] = []
        setSessions(undefined)
        setOpening(true)
        const open = async () => {
            // Sequential registration makes partial initialization cleanup explicit.
            const body = await WritingClient.open(
                window.journal.writing!,
                bodySchema,
                draftId,
                state.restoreId!,
                'body',
                (value) => report('body', value)
            )
            clients.push(body)
            const title = await WritingClient.open(
                window.journal.writing!,
                titleSchema,
                draftId,
                state.restoreId!,
                'title',
                (value) => report('title', value)
            )
            clients.push(title)
            if (disposed) {
                clients.forEach((c) => c.dispose())
                return
            }
            setSessions({ body, title })
            setOpening(false)
        }
        void open().catch(() => {
            if (!disposed) setStatus('Could not open writing. Reopen this week to retry.')
            if (!disposed) setOpening(false)
            clients.forEach((c) => c.dispose())
        })
        return () => {
            disposed = true
            clients.forEach((c) => c.dispose())
        }
    }, [draftId, state.restoreId, report, openAttempt])
    const checkpoint = useCallback(async () => {
        if (!imagesReady) throw new Error('Finish or cancel image imports before closing.')
        if (draftId && opening) throw new Error('Writing is still opening.')
        const hold = Symbol()
        holds.current.add(hold)
        const resume = () => {
            holds.current.delete(hold)
            setFrozen(holds.current.size > 0)
        }
        flushSync(() => setFrozen(true))
        try {
            await sessions?.body.flush()
            await sessions?.title.flush()
            await settleWritingSelections()
        } catch {
            resume()
            throw new Error('Could not save your writing. Retry saving before closing or updating.')
        }
        return resume
    }, [sessions, imagesReady, draftId, opening])
    useEffect(() => registerUpdateCheckpoint(checkpoint), [checkpoint])
    useEffect(() => {
        if (!rejectedRevision || !sessions) return
        toast({
            id: 'workspace-rejected',
            type: 'error',
            title: 'Could not add this edit',
            description: 'This edit is too large. Download the rejected copy to keep it, then paste smaller sections.',
            duration: Infinity,
            action: {
                label: 'Download rejected copy',
                onClick: () => {
                    const copy = { body: sessions.body.rejectedWriting, title: sessions.title.rejectedWriting }
                    const url = URL.createObjectURL(
                        new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' })
                    )
                    const link = document.createElement('a')
                    link.href = url
                    link.download = 'gitorian-rejected-writing.json'
                    link.click()
                    setTimeout(() => URL.revokeObjectURL(url), 1000)
                }
            }
        })
    }, [rejectedRevision, sessions, toast])
    useEffect(() => {
        if (status === 'Saved on this device') dismiss('workspace-save')
        if (!status.startsWith('Could not save') && !status.startsWith('Recovery storage')) return
        toast({
            id: 'workspace-save',
            type: 'error',
            title: 'Could not save writing',
            description: status,
            duration: Infinity,
            action: {
                label: retrying ? 'Retrying...' : 'Retry saving',
                onClick: () => {
                    if (retrying) return
                    // Arc actions dismiss unless updated synchronously by the handler.
                    update('workspace-save', {})
                    setRetrying(true)
                    void Promise.allSettled([sessions?.body.flush(), sessions?.title.flush()]).finally(() =>
                        setRetrying(false)
                    )
                }
            }
        })
    }, [status, sessions, retrying, toast, dismiss, update])
    useEffect(() => {
        onReady(!!sessions && !busy && !frozen)
        return () => onReady(false)
    }, [sessions, busy, frozen, onReady])
    const cited = useRef<number | undefined>(undefined)
    useEffect(() => {
        if (!citation || !sessions || cited.current === citation.id) return
        cited.current = citation.id
        editor.current?.insertBlock({
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: citation.title,
                    ...(citation.url ? { marks: [{ type: 'link', attrs: { href: citation.url } }] } : {})
                }
            ]
        })
    }, [citation, sessions])
    const create = useCallback(async () => {
        setBusy(true)
        const result = await run({ type: 'newDraft', week })
        const created = result?.state.drafts.find((d) => d.week === week)
        if (created) {
            setDraft(created)
            setFocusWriting(true)
        }
        if (!result) toast({ type: 'error', title: 'Could not create an entry' })
        setBusy(false)
    }, [run, week, toast])
    useEffect(() => {
        if (!initialWrite || started.current) return
        started.current = true
        if (!savedDraft) void create()
    }, [initialWrite, savedDraft, create])
    const publicationId = savedDraft?.publishedEntryId
    useEffect(() => {
        setDraft((current) => current && { ...current, publishedEntryId: publicationId })
    }, [publicationId])
    const publish = async () => {
        if (!draft || !sessions || !imagesReady) return
        setBusy(true)
        let resume: (() => void) | undefined
        try {
            resume = await checkpoint()
            const result = await run({ type: 'publish', draftId: draft.id })
            if (!result) throw new Error('Could not publish to Notion')
            const saved = result.state.drafts.find((d) => d.id === draft.id)
            if (saved?.publishedEntryId) setDraft((d) => d && { ...d, publishedEntryId: saved.publishedEntryId })
            if (
                saved?.publishedEntryId &&
                result.state.saves.some((save) => save.draftId === draft.id && save.status === 'confirmed')
            )
                toast({
                    id: 'workspace-publish-success',
                    type: 'success',
                    title: draft.publishedEntryId ? 'Updated in Notion' : 'Published to Notion'
                })
        } catch (error) {
            toast({ type: 'error', title: error instanceof Error ? error.message : 'Could not publish writing' })
        } finally {
            resume?.()
            setBusy(false)
        }
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
    const needsNotion = !notionConnected || !state.settings.destination
    const entryTemplate = state.settings.template.content?.some(
        (node) => node.type !== 'paragraph' || plainText(node).trim()
    )
        ? state.settings.template
        : undefined
    return (
        <section data-journal-drop-zone className="ws-writing" aria-label="Weekly journal">
            {publishTarget &&
                notionConnected &&
                createPortal(
                    <Button
                        size="sm"
                        loading={busy}
                        disabled={!needsNotion && (!draft || uncertain || !imagesReady || !sessions)}
                        title={
                            needsNotion
                                ? 'Choose a publishing destination in settings'
                                : !imagesReady
                                  ? 'Finish or dismiss image imports before publishing'
                                  : !draft
                                    ? 'Start an entry before publishing'
                                    : uncertain
                                      ? 'Verify the previous Notion save before publishing again'
                                      : undefined
                        }
                        onClick={needsNotion ? onSettings : publish}
                    >
                        {needsNotion
                            ? 'Set up Notion publishing'
                            : draft?.publishedEntryId
                              ? 'Update in Notion'
                              : 'Publish to Notion'}
                    </Button>,
                    publishTarget
                )}
            <ScrollArea className="ws-paper-scroll" label="Entry writing space" fade={20}>
                <div className="ws-paper">
                    {draft ? (
                        <>
                            <h1 className="ws-title" aria-label={draft.title || 'Untitled weekly entry'}>
                                {sessions && (
                                    <WritingTitle
                                        client={sessions.title}
                                        readOnly={busy || frozen}
                                        onChange={(title) => setDraft((d) => d && { ...d, title })}
                                    />
                                )}
                            </h1>
                            <Editor
                                label="Journal body"
                                key={sessions?.body.client ?? draft.id}
                                restoreId={state.restoreId}
                                allowImageImport
                                onImagesReadyChange={setImagesReady}
                                ref={editor}
                                value={draft.body}
                                template={entryTemplate}
                                writing={sessions?.body}
                                onEdit={(snapshot) => setWords(snapshot.wordCount())}
                                readOnly={busy || frozen || !sessions}
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
            <footer className="ws-writing-footer">
                <span>{`${new Intl.NumberFormat().format(draft ? words : 0)} ${draft && words === 1 ? 'word' : 'words'}`}</span>
                <span role="status">
                    {status === 'Saved on this device' && <WorkspaceIcon name="check" width="14" height="14" />}
                    {status.startsWith('Could not add')
                        ? 'Edit not added'
                        : status.startsWith('Could not save') || status.startsWith('Recovery storage')
                          ? 'Saving paused'
                          : status}
                    {!sessions && !opening && draft && (
                        <Button variant="ghost" onClick={() => setOpenAttempt((value) => value + 1)}>
                            Retry opening writing
                        </Button>
                    )}
                </span>
                <span className="ws-slash-hint">
                    <kbd>/</kbd> for formatting
                </span>
            </footer>
            <Dialog open={!!legacyRecovery}>
                <DialogContent
                    title="Recover previous writing"
                    description="An older recovery copy cannot be merged automatically. Append it to the shared draft, or discard this recovery copy."
                    showCloseButton={false}
                    onEscapeKeyDown={(event) => event.preventDefault()}
                    onInteractOutside={(event) => event.preventDefault()}
                >
                    <Button
                        disabled={!sessions}
                        onClick={() => {
                            if (!legacyRecovery) return
                            editor.current?.insertBlock({
                                type: 'paragraph',
                                content: [{ type: 'text', text: `Recovered: ${legacyRecovery.title}` }]
                            })
                            for (const block of legacyRecovery.body.content ?? []) editor.current?.insertBlock(block)
                            try {
                                sessions?.body.cache()
                                localStorage.removeItem(legacyKey)
                                setLegacyRecovery(undefined)
                            } catch {
                                setStatus('Recovery storage unavailable. Keep this window open and retry saving.')
                            }
                        }}
                    >
                        Append recovery writing
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            try {
                                localStorage.removeItem(legacyKey)
                                setLegacyRecovery(undefined)
                            } catch {
                                setStatus('Could not clear the recovery copy.')
                            }
                        }}
                    >
                        Discard recovery copy
                    </Button>
                </DialogContent>
            </Dialog>
        </section>
    )
}
