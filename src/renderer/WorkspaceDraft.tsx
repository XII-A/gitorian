import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useWritingSession } from './use-writing-session'
import type { Command, JournalNode, Reply, State } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Editor, type EditorHandle } from './Editor'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { RadioGroup } from './components/arc/radio-group/radio-group'
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
    initialWrite?: boolean
    notionConnected: boolean
    currentRestoreId: () => string | undefined
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
    currentRestoreId,
    citation,
    publishTarget,
    onReady,
    onSettings
}: Props) {
    const { session, view } = useWritingSession({ state, week, run, currentRestoreId })
    const {
        draft,
        saveIssue,
        conflict: recoveryConflict,
        conflictError,
        resolvingConflict,
        busy,
        imagesReady,
        words,
        publication: publishSave
    } = view
    const status = {
        empty: '',
        saving: 'Saving…',
        saved: 'Saved on this device',
        recovered: 'Recovered your latest writing. Saving…',
        published: 'Published to Notion',
        updated: 'Updated in Notion'
    }[view.status]
    const [conflictChoice, setConflictChoice] = useState('')
    const titleInput = useRef<HTMLTextAreaElement>(null)
    const editor = useRef<EditorHandle>(null)
    const [focusWriting, setFocusWriting] = useState(initialWrite)
    const writingStarted = useRef(false)
    const notifiedSave = useRef('')
    const { toast, dismiss, update } = useToastStack()
    const ready = !!draft && !busy && !recoveryConflict
    useEffect(() => {
        setConflictChoice('')
    }, [recoveryConflict])
    useEffect(() => {
        if (!saveIssue || recoveryConflict) {
            dismiss('workspace-save')
            return
        }
        toast({
            id: 'workspace-save',
            type: 'error',
            title: saveIssue.kind === 'save' ? 'Could not save writing' : 'Recovery storage is unavailable',
            ...(saveIssue.kind === 'recovery' ? { description: 'Save writing to the journal before closing.' } : {}),
            duration: Infinity,
            action: {
                label: 'Retry saving',
                onClick: () => {
                    // Keep recovery available until the write is acknowledged.
                    update('workspace-save', {})
                    void session.retrySave()
                }
            }
        })
    }, [saveIssue, recoveryConflict, session, toast, dismiss, update])
    useEffect(() => () => dismiss('workspace-save'), [dismiss])
    useEffect(() => {
        onReady(ready)
        return () => onReady(false)
    }, [ready, onReady])
    useEffect(() => {
        if (!citation) return
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
        const result = await session.start()
        if (result === 'created') setFocusWriting(true)
        else if (result === 'failed')
            toast({ type: 'error', title: 'Could not create an entry', description: 'Try starting an entry again.' })
    }, [session, toast])
    useEffect(() => {
        if (!initialWrite || writingStarted.current) return
        writingStarted.current = true
        void create()
    }, [initialWrite, create])
    const publish = async () => {
        let publication!: ReturnType<typeof session.publish>
        flushSync(() => {
            publication = session.publish()
        })
        const result = await publication
        if (result === 'published' || result === 'updated')
            toast({
                id: 'workspace-publish-success',
                type: 'success',
                title: result === 'updated' ? 'Updated in Notion' : 'Published to Notion'
            })
        else if (result === 'failed')
            toast({
                id: 'workspace-publish',
                type: 'error',
                title: 'Could not publish to Notion',
                description: 'Draft saved. Check Notion settings and retry.',
                action: { label: 'Review settings', onClick: onSettings }
            })
    }
    const uncertain = !!publishSave && ['unknown', 'pending'].includes(publishSave.status)
    const verify = useCallback(
        async function verifySave(saveId: string): Promise<void> {
            const result = await session.verifyPublication(saveId)
            if (result === 'unconfirmed')
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
        [session, toast]
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
                        disabled={!needsNotion && (!draft || uncertain || !imagesReady || !!recoveryConflict)}
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
                                <textarea
                                    ref={titleInput}
                                    aria-label="Entry title"
                                    dir="auto"
                                    value={draft.title}
                                    placeholder="Entry title"
                                    readOnly={busy || !!recoveryConflict}
                                    rows={2}
                                    onChange={(event) => session.edit({ title: event.target.value })}
                                />
                            </h1>
                            <Editor
                                key={draft.id}
                                restoreId={state.restoreId}
                                allowImageImport
                                onImagesReadyChange={session.setImagesReady}
                                ref={editor}
                                value={draft.body}
                                template={entryTemplate}
                                onEdit={(body) => session.edit({ body })}
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
            <footer className="ws-writing-footer">
                <span>{`${new Intl.NumberFormat().format(draft ? words : 0)} ${draft && words === 1 ? 'word' : 'words'}`}</span>
                <span role="status">
                    {status && !recoveryConflict && <WorkspaceIcon name="check" width="14" height="14" />}
                    {!recoveryConflict && status}
                </span>
                <span className="ws-slash-hint">
                    <kbd>/</kbd> for formatting
                </span>
            </footer>
            <Dialog open={!!recoveryConflict}>
                <DialogContent
                    title="Choose which writing to keep"
                    description="Saved writing changed elsewhere. Keep the saved writing or replace it with the recovery copy."
                    showCloseButton={false}
                    onEscapeKeyDown={(event) => event.preventDefault()}
                    onInteractOutside={(event) => event.preventDefault()}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        titleInput.current?.focus()
                    }}
                >
                    <form
                        className="ws-conflict-form"
                        aria-busy={resolvingConflict}
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (conflictChoice === 'saved' || conflictChoice === 'recovery')
                                void session.resolveConflict(conflictChoice)
                        }}
                    >
                        <fieldset disabled={resolvingConflict} className="ws-conflict-options">
                            <RadioGroup
                                label="Writing to keep"
                                name="writing-copy"
                                value={conflictChoice}
                                onValueChange={setConflictChoice}
                                options={[
                                    {
                                        value: 'saved',
                                        label: 'Saved writing',
                                        description: 'Keep the writing saved on this device. Discard the recovery copy.'
                                    },
                                    {
                                        value: 'recovery',
                                        label: 'Recovery copy',
                                        description: 'Keep the unsaved writing. Replace the saved writing.'
                                    }
                                ]}
                            />
                        </fieldset>
                        {conflictError && (
                            <p className="ws-conflict-error" role="alert">
                                {conflictError}
                            </p>
                        )}
                        <Button type="submit" disabled={!conflictChoice} loading={resolvingConflict}>
                            {conflictChoice === 'saved'
                                ? 'Keep saved writing'
                                : conflictChoice === 'recovery'
                                  ? 'Use recovery copy'
                                  : 'Keep selected writing'}
                        </Button>
                    </form>
                </DialogContent>
            </Dialog>
        </section>
    )
}
