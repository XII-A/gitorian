import { Input, Select, Field } from './components/Fields'
import { BookOpen } from 'lucide-react'
import type { Command, Draft, Entry, JournalNode, Reply, State } from '../shared/model'
import { Editor } from './Editor'
import { Button } from './components/arc/button/button'

interface DraftPaneProps {
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
                <span>Journal</span>
                <span className="local-label">{draft?.publishedEntryId ? 'Published' : 'Private draft'}</span>
            </header>
            <div className="pane-content">
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
                        {state.saves
                            .filter((save) => save.draftId === draft.id && save.status !== 'confirmed')
                            .map((save) => (
                                <div className="save-warning" key={save.id}>
                                    <p>
                                        {save.status === 'failed'
                                            ? 'Save failed. Your draft is safe.'
                                            : 'Save outcome is uncertain. Verify it before retrying.'}
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
                                <Button loading={busy} onClick={onPublish}>
                                    Publish to Notion ↗
                                </Button>
                            )}
                        </footer>
                    </>
                ) : (
                    <div className="empty">
                        <BookOpen size={36} />
                        <h2>No entry for this week yet</h2>
                        <p>
                            Create an entry when you’re ready. Your writing stays on this machine until you save to
                            Notion.
                        </p>
                        <Button onClick={onCreate}>Create this week’s entry</Button>
                    </div>
                )}
            </div>
        </section>
    )
}
