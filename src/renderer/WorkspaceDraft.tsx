import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command, Draft, JournalNode, Reply, State } from '../shared/model'
import { draftSchema } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Editor } from './Editor'
import { RichTextEditor } from './components/arc/rich-text-editor/rich-text-editor'
import type { RichTextEditorHandle } from './components/arc/rich-text-editor/rich-text-editor'
import { Button } from './components/arc/button/button'
import { Select } from './components/arc/select/select'
import { WorkspaceIcon } from './components/WorkspaceIcon'
import { journalFromHTML, journalHTML, needsLegacyEditor } from './workspace-model'

export interface Citation {
    id: number
    title: string
    url?: string
    note?: string
}
interface Props {
    state: State
    week: string
    sample: boolean
    run: (command: Command) => Promise<Reply | undefined>
    citation?: Citation
    requestedDraft?: { id: string; nonce: number }
    onReady: (ready: boolean) => void
    onSettings: () => void
}

export function WorkspaceDraft({ state, week, sample, run, citation, requestedDraft, onReady, onSettings }: Props) {
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
    const openedRequest = useRef<number | undefined>(undefined)
    const drafts = state.drafts.filter((item) => item.week === week)
    const ready = !!draft && !draft.publishedEntryId
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
        const requested = drafts.find((item) => item.id === requestedDraft?.id)
        const first = requested ?? drafts[0]
        if (!latest.current && first) {
            openedRequest.current = requestedDraft?.nonce
            choose(first)
        } else if (requested && requestedDraft && openedRequest.current !== requestedDraft.nonce) {
            openedRequest.current = requestedDraft.nonce
            void (async () => {
                if (await persist()) {
                    dirty.current = false
                    choose(requested)
                }
            })()
        }
    }, [drafts, choose, persist, requestedDraft])
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
                },
                ...(citation.note ? [{ type: 'text', text: `: ${citation.note}` }] : [])
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
    return (
        <section className="ws-writing" aria-label="Weekly journal">
            <header className="ws-writing-bar">
                <div className="ws-draft-controls">
                    <span className="ws-draft-state">
                        {draft?.publishedEntryId ? 'Published entry' : 'Private draft'}
                    </span>
                    {drafts.length > 1 && (
                        <Select
                            label="Entry"
                            aria-label="Choose draft"
                            value={draft?.id ?? ''}
                            options={drafts.map((item) => ({ value: item.id, label: item.title || 'Untitled entry' }))}
                            onValueChange={(id) => {
                                void (async () => {
                                    if (await persist()) {
                                        dirty.current = false
                                        const item = drafts.find((value) => value.id === id)
                                        if (item) choose(item)
                                    }
                                })()
                            }}
                        />
                    )}
                </div>
                {draft && (
                    <div className="ws-writing-actions">
                        <Button variant="ghost" size="sm" onClick={create} disabled={busy}>
                            New entry
                        </Button>
                        {draft.publishedEntryId ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                    const entry = state.entries.find((item) => item.id === draft.publishedEntryId)
                                    if (entry && !sample) return run({ type: 'open', url: entry.url })
                                }}
                            >
                                View published entry
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                loading={busy}
                                disabled={uncertain || (!sample && !state.settings.destination)}
                                onClick={publish}
                            >
                                {sample ? 'Publish sample' : 'Publish to Notion'}
                            </Button>
                        )}
                    </div>
                )}
            </header>
            <div className="ws-paper-scroll">
                <div className="ws-paper">
                    {draft ? (
                        <>
                            <h1 className="ws-title">
                                <span className="ws-sr-only">{draft.title || 'Untitled weekly entry'}</span>
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
                            {!sample && !state.settings.destination && !draft.publishedEntryId && (
                                <p className="ws-quiet-help">
                                    Your writing stays here.{' '}
                                    <button type="button" onClick={onSettings}>
                                        Connect Notion in settings
                                    </button>{' '}
                                    when you’re ready to publish.
                                </p>
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
            </div>
            <footer className="ws-writing-footer">
                <span>
                    {draft
                        ? `${plainText(draft.body).trim().split(/\s+/).filter(Boolean).length} words`
                        : 'Your writing stays on this device'}
                </span>
                <span role="status">
                    <WorkspaceIcon name="check" width="14" height="14" />
                    {status || 'Ready when you are'}
                </span>
                {dirty.current && status.startsWith('Could not') && (
                    <Button variant="ghost" size="sm" onClick={persist}>
                        Retry saving
                    </Button>
                )}
                <span className="ws-slash-hint">
                    <kbd>/</kbd> for formatting
                </span>
            </footer>
        </section>
    )
}
