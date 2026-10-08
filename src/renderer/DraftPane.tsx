import { Disclosure } from './components/Disclosure'
import { Input, Select, Field } from './components/Fields'
import { BookOpen } from 'lucide-react'
import type { Command, Draft, Entry, JournalNode, Reply, State } from '../shared/model'
import { Editor } from './Editor'
import { Button } from './components/arc/button/button'

interface DraftPaneProps {
    sample?: boolean
    publishAvailable?: boolean
    state: State
    week: string
    draft?: Draft
    busy: boolean
    saveStatus: string
    insertLink?: { url: string; title: string; nonce: number }
    onChoose: (id: string) => Promise<void>
    onCreate: () => Promise<void>
    onEdit: (draft: Draft) => void
    onBodyChange: (body: JournalNode) => void
    onPublish: () => Promise<void>
    run: (command: Command) => Promise<Reply | undefined>
    showEntry: (entry: Entry) => void
}
export function DraftPane({
    sample,
    publishAvailable = true,
    state,
    week,
    draft,
    busy,
    saveStatus,
    insertLink,
    onChoose,
    onCreate,
    onEdit,
    onBodyChange,
    onPublish,
    run,
    showEntry
}: DraftPaneProps) {
    return (
        <section className="pane draft-pane">
            <header className="pane-header">
                <span>Draft</span>
                <span className="local-label">{draft?.publishedEntryId ? 'Published' : 'Private draft'}</span>
            </header>
            <div className="pane-content">
                <Disclosure className="draft-options" title="Other drafts">
                    <div className="row between">
                        <Field>
                            Draft
                            <Select
                                value={draft?.id ?? ''}
                                onChange={(event) => {
                                    void onChoose(event.target.value)
                                }}
                            >
                                <option value="">Choose draft</option>
                                {state.drafts
                                    .filter((item) => item.week === week)
                                    .map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.title}
                                            {item.publishedEntryId ? ' · published' : ''}
                                        </option>
                                    ))}
                            </Select>
                        </Field>
                        <Button variant="secondary" size="sm" onClick={onCreate}>
                            New entry
                        </Button>
                    </div>
                </Disclosure>
                {draft ? (
                    <>
                        <label className="sr-only" htmlFor="draft-title">
                            Draft title
                        </label>
                        <Input
                            id="draft-title"
                            className="draft-title"
                            value={draft.title}
                            disabled={!!draft.publishedEntryId}
                            onChange={(event) => {
                                onEdit({ ...draft, title: event.target.value })
                            }}
                        />
                        <Editor
                            key={draft.id}
                            value={draft.body}
                            readOnly={!!draft.publishedEntryId}
                            onChange={onBodyChange}
                            insertLink={insertLink}
                        />
                        <Disclosure
                            className="selected-work"
                            title={'Included work (' + String(draft.selections.length) + ')'}
                        >
                            {draft.selections.map((selection) => (
                                <div className="row" key={selection.activityId}>
                                    <span>
                                        {state.activities.find((item) => item.id === selection.activityId)?.title ??
                                            selection.activityId}
                                        {selection.revision && <small className="muted"> · Captured revision</small>}
                                    </span>
                                    {!draft.publishedEntryId && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                run({
                                                    type: 'select',
                                                    draftId: draft.id,
                                                    activityId: selection.activityId,
                                                    included: false
                                                })
                                            }
                                        >
                                            Remove
                                        </Button>
                                    )}
                                </div>
                            ))}
                            <p className="muted">
                                Work stays linked to this draft. Coverage is confirmed when you publish.
                            </p>
                        </Disclosure>
                        {state.saves
                            .filter((save) => save.draftId === draft.id && save.status !== 'confirmed')
                            .map((save) => (
                                <div className="save-warning" key={save.id}>
                                    <p>
                                        {save.status === 'failed'
                                            ? 'Save failed. Your draft is safe.'
                                            : 'Save outcome is uncertain; coverage is pending.'}
                                    </p>
                                    <p>{save.error}</p>
                                    {save.status === 'unknown' && (
                                        <Button
                                            variant="secondary"
                                            onClick={() => run({ type: 'reconcile', saveId: save.id })}
                                        >
                                            Verify Notion save
                                        </Button>
                                    )}
                                </div>
                            ))}
                        {!publishAvailable && !draft.publishedEntryId && (
                            <p className="publish-hint">
                                {sample
                                    ? 'Publishing is off while using sample data.'
                                    : 'Connect Notion and choose a destination in Settings to publish.'}
                            </p>
                        )}
                        <footer className="draft-footer">
                            <span className="muted" role="status">
                                {saveStatus}
                            </span>
                            {draft.publishedEntryId ? (
                                <Button
                                    onClick={() => {
                                        const saved = state.entries.find((item) => item.id === draft.publishedEntryId)
                                        if (saved) showEntry(saved)
                                    }}
                                >
                                    View saved entry
                                </Button>
                            ) : (
                                <Button
                                    loading={busy}
                                    disabled={!publishAvailable}
                                    title={
                                        sample
                                            ? 'Publishing is unavailable with sample data'
                                            : !publishAvailable
                                              ? 'Connect Notion and choose a destination in Settings'
                                              : undefined
                                    }
                                    onClick={onPublish}
                                >
                                    Publish to Notion
                                </Button>
                            )}
                        </footer>
                    </>
                ) : (
                    <div className="empty">
                        <BookOpen size={24} />
                        <h2>What did this week teach you?</h2>
                        <p>
                            Create an entry when you are ready. Your writing stays on this machine until you save to
                            Notion.
                        </p>
                        <Button onClick={onCreate}>Create an entry</Button>
                    </div>
                )}
            </div>
        </section>
    )
}
