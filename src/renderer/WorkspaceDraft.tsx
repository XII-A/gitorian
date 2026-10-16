import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Command, Draft, JournalNode, Reply, State } from '../shared/model'
import { draftSchema } from '../shared/model'
import { plainText } from '../shared/notion-format'
import { Editor } from './Editor'
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
    const { toast, dismiss } = useToastStack()
    const latest = useRef<Draft | undefined>(undefined)
    const dirty = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const checkpoint = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const pending = useRef<Promise<boolean> | undefined>(undefined)
    const mounted = useRef(true)
    const notifiedSave = useRef('')
    const drafts = state.drafts.filter((item) => item.week === week)
    const ready = !!draft && !draft.publishedEntryId && !busy
    const storageKey = `weekly-j:recovery:${sample ? 'sample' : (state.restoreId ?? 'local')}:${week}`
    const cache = useCallback(() => {
        if (!dirty.current || !latest.current || sample) return
        try {
            localStorage.setItem(storageKey, JSON.stringify(latest.current))
        } catch {
            if (mounted.current) setStatus('Recovery storage is unavailable. Saving to the journal…')
        }
    }, [storageKey, sample])
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
        const confirmed = drafts.find((item) => item.id === latest.current?.id && item.publishedEntryId)
        if (confirmed && !latest.current?.publishedEntryId) {
            latest.current = confirmed
            dirty.current = false
            setDraft(confirmed)
            setStatus(sample ? 'Sample published. Nothing was sent to Notion.' : 'Published to Notion')
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
            cache()
            window.removeEventListener('pagehide', flush)
            void persist()
        }
    }, [persist, cache])
    const edit = useCallback(
        (value: Draft) => {
            const updated = { ...value, updatedAt: new Date().toISOString() }
            latest.current = updated
            dirty.current = true
            setDraft(updated)
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
        (body: JournalNode) => {
            if (latest.current) edit({ ...latest.current, body })
        },
        [edit]
    )
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
        editBody(body)
    }, [citation, editBody])
    const create = async () => {
        setBusy(true)
        if (!(await persist())) {
            setBusy(false)
            return
        }
        const result = await run({ type: 'newDraft', week })
        const created = result?.state.drafts
            .filter((item) => item.week === week && !state.drafts.some((old) => old.id === item.id))
            .at(-1)
        if (created) choose(created)
        else toast({ type: 'error', title: 'Could not create an entry', description: 'Try starting an entry again.' })
        setBusy(false)
    }
    const publish = async () => {
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
        if (saved?.publishedEntryId) {
            latest.current = saved
            setDraft(saved)
            setStatus(sample ? 'Sample published. Nothing was sent to Notion.' : 'Published to Notion')
        } else if (!result || !result.state.saves.some((save) => save.draftId === latest.current?.id))
            toast({
                id: 'workspace-publish',
                type: 'error',
                title: 'Could not publish to Notion',
                description: 'Your draft is safe. Check the Notion connection and destination in settings.',
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
                : 'Your draft is safe. Check the Notion connection and destination in settings, then retry.',
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
    const needsNotion = !sample && (!notionConnected || !state.settings.destination) && !draft?.publishedEntryId
    const entryTemplate = state.settings.template.content?.some(
        (node) => node.type !== 'paragraph' || plainText(node).trim()
    )
        ? state.settings.template
        : undefined
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
                            <Editor
                                key={draft.id}
                                value={draft.body}
                                template={entryTemplate}
                                onChange={editBody}
                                readOnly={!!draft.publishedEntryId || busy}
                            />
                        </>
                    ) : (
                        <div className="ws-new-entry">
                            <h1>A little room to reflect</h1>
                            <p>Write about what changed, what worked, and what you learned.</p>
                            <Button loading={busy} onClick={create}>
                                Start this week’s entry
                            </Button>
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
