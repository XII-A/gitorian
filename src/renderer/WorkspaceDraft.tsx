import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Command, Draft, JournalNode, Reply, State } from '../shared/model'
import { draftSchema } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Editor } from './Editor'
import { RichTextEditor } from './components/arc/rich-text-editor/rich-text-editor'
import type { RichTextEditorHandle } from './components/arc/rich-text-editor/rich-text-editor'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { journalFromHTML, journalHTML, needsLegacyEditor } from './workspace-model'

export interface Citation {
    id: number
    title: string
    url?: string
}
interface Props {
    state: State
    week: string
    sample: boolean
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
    notionConnected,
    run,
    citation,
    publishTarget,
    onReady,
    onSettings
}: Props) {
    const [draft, setDraft] = useState<Draft>()
    const [status, setStatus] = useState('')
    const [busy, setBusy] = useState(false)
    const [failure, setFailure] = useState('')
    const editor = useRef<RichTextEditorHandle>(null)
    const latest = useRef<Draft | undefined>(undefined)
    const dirty = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const pending = useRef<Promise<boolean> | undefined>(undefined)
    const mounted = useRef(true)
    const drafts = state.drafts.filter((item) => item.week === week)
    const ready = !!draft && !draft.publishedEntryId && !busy
    const storageKey = `weekly-j:recovery:${sample ? 'sample' : (state.restoreId ?? 'local')}:${week}`
    const persist = useCallback(async (): Promise<boolean> => {
        while (pending.current) {
            const saved = await pending.current
            if (!saved) return false
        }
        if (!dirty.current || !latest.current || latest.current.publishedEntryId) return true
        const writing = latest.current
        const request = (async () => {
            const result = await run({ type: 'draft', draft: writing })
            if (!result) {
                if (mounted.current)
                    setStatus(
                        'Could not save to the journal. Retry saving; a recovery copy is kept when browser storage is available.'
                    )
                return false
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
    }, [run, storageKey, sample])
    const choose = useCallback(
        (item: Draft) => {
            let recovered = item
            try {
                const raw = localStorage.getItem(storageKey)
                const parsed = raw ? draftSchema.safeParse(JSON.parse(raw)) : undefined
                if (
                    parsed?.success &&
                    parsed.data.id === item.id &&
                    !item.publishedEntryId &&
                    parsed.data.updatedAt > item.updatedAt
                ) {
                    recovered = parsed.data
                    dirty.current = true
                }
            } catch {
                /* An unavailable recovery cache does not prevent opening saved writing. */
            }
            latest.current = recovered
            setDraft(recovered)
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
    useEffect(() => {
        const first = drafts.filter((item) => !item.publishedEntryId).at(-1)
        if (!latest.current && first) {
            choose(first)
        }
    }, [drafts, choose])
    useEffect(() => {
        onReady(ready)
        return () => onReady(false)
    }, [ready, onReady])
    useEffect(() => {
        mounted.current = true
        const flush = () => {
            void persist()
        }
        window.addEventListener('pagehide', flush)
        return () => {
            mounted.current = false
            clearTimeout(timer.current)
            window.removeEventListener('pagehide', flush)
            void persist()
        }
    }, [persist])
    const edit = (value: Draft) => {
        const updated = { ...value, updatedAt: new Date().toISOString() }
        latest.current = updated
        dirty.current = true
        setDraft(updated)
        setStatus('Saving…')
        try {
            localStorage.setItem(storageKey, JSON.stringify(updated))
        } catch {
            setStatus('Saving… Recovery storage is unavailable.')
        }
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            void persist()
        }, 450)
    }
    const editBody = (body: JournalNode) => {
        if (latest.current) edit({ ...latest.current, body })
    }
    useEffect(() => {
        if (!citation || !latest.current || latest.current.publishedEntryId) return
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
        const body: JournalNode = { type: 'doc', content: [...(latest.current.body.content ?? []), content] }
        // Arc keeps this replacement as one undo step. The onChange callback persists it.
        if (editor.current) editor.current.setHTML(journalHTML(body))
        else {
            const updated = { ...latest.current, body, updatedAt: new Date().toISOString() }
            latest.current = updated
            dirty.current = true
            setDraft(updated)
            try {
                localStorage.setItem(storageKey, JSON.stringify(updated))
            } catch {
                /* Persist below still saves to the journal. */
            }
            void persist()
        }
    }, [citation, persist, storageKey])
    const create = async () => {
        setBusy(true)
        setFailure('')
        if (!(await persist())) {
            setBusy(false)
            return
        }
        const result = await run({ type: 'newDraft', week })
        const created = result?.state.drafts
            .filter((item) => item.week === week && !state.drafts.some((old) => old.id === item.id))
            .at(-1)
        if (created) choose(created)
        else setFailure('Could not create an entry. Try creating it again.')
        setBusy(false)
    }
    const publish = async () => {
        setBusy(true)
        setFailure('')
        clearTimeout(timer.current)
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
        if (saved?.publishedEntryId) {
            latest.current = saved
            setDraft(saved)
            setStatus(sample ? 'Sample published. Nothing was sent to Notion.' : 'Published to Notion')
        } else
            setFailure(
                'Publishing did not finish. Your writing is kept. Check the save status below before trying again.'
            )
        setBusy(false)
    }
    const unresolved = state.saves.filter((save) => save.draftId === draft?.id && save.status !== 'confirmed')
    const uncertain = unresolved.some((save) => ['unknown', 'pending'].includes(save.status))
    const legacy = draft ? needsLegacyEditor(draft.body) : false
    const needsNotion = !sample && (!notionConnected || !state.settings.destination) && !draft?.publishedEntryId
    return (
        <section className="ws-writing" aria-label="Weekly journal">
            {publishTarget &&
                createPortal(
                    draft?.publishedEntryId ? (
                        <Button size="sm" onClick={create} loading={busy}>
                            Start another entry
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            loading={busy}
                            disabled={!draft || uncertain || needsNotion}
                            title={
                                !draft
                                    ? 'Start an entry before publishing'
                                    : uncertain
                                      ? 'Verify the previous Notion save before publishing again'
                                      : needsNotion
                                        ? 'Connect Notion in settings to publish'
                                        : undefined
                            }
                            onClick={publish}
                        >
                            {sample ? 'Publish sample' : 'Publish to Notion'}
                        </Button>
                    ),
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
                                    placeholder="Give your week a title"
                                    readOnly={!!draft.publishedEntryId || busy}
                                    rows={2}
                                    onChange={(event) => edit({ ...draft, title: event.target.value })}
                                />
                            </h1>
                            {legacy ? (
                                <Editor
                                    key={draft.id}
                                    value={draft.body}
                                    onChange={editBody}
                                    readOnly={!!draft.publishedEntryId || busy}
                                />
                            ) : (
                                <RichTextEditor
                                    key={draft.id}
                                    ref={editor}
                                    aria-label="Journal body"
                                    defaultValue={journalHTML(draft.body)}
                                    placeholder="What stayed with you this week?"
                                    blockHint="Type / for formatting"
                                    readOnly={!!draft.publishedEntryId || busy}
                                    onChange={(value) => editBody(journalFromHTML(value.html))}
                                />
                            )}
                            {unresolved.map((save) => (
                                <div className="ws-inline-error" role="alert" key={save.id}>
                                    <p>
                                        {save.status === 'failed'
                                            ? 'Publishing failed. Your draft is safe; you can retry.'
                                            : 'The publishing outcome is uncertain. Verify it before publishing again.'}
                                    </p>
                                    <p>{save.error}</p>
                                    {save.status === 'unknown' && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => run({ type: 'reconcile', saveId: save.id })}
                                        >
                                            Verify Notion save
                                        </Button>
                                    )}
                                </div>
                            ))}
                            {failure && (
                                <p className="ws-inline-error" role="alert">
                                    {failure}
                                </p>
                            )}
                        </>
                    ) : (
                        <div className="ws-new-entry">
                            <h1>A little room to reflect</h1>
                            <p>Write about what changed, what worked, and what you learned.</p>
                            <Button loading={busy} onClick={create}>
                                Start this week’s entry
                            </Button>
                            {failure && <p role="alert">{failure}</p>}
                        </div>
                    )}
                </div>
            </ScrollArea>
            <footer className={`ws-writing-footer${needsNotion ? ' ws-needs-notion' : ''}`}>
                <span>
                    {draft ? `${plainText(draft.body).trim().split(/\s+/).filter(Boolean).length} words` : '0 words'}
                </span>
                <span role="status">
                    <WorkspaceIcon name="check" width="14" height="14" />
                    {status || 'Ready when you are'}
                </span>
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
