import { useRef, useState } from 'react'
import { BookOpen, ChevronRight, History, X } from 'lucide-react'
import type { JournalNode, State } from '../shared/model'
import { Dialog, DialogClose, DialogContent } from './components/arc/dialog/dialog'
import { useHistoryMotion } from './use-history-motion'
import { historySamples } from './history-samples'
import { Drawer, DrawerContent, DrawerTrigger, useDrawerItem } from './components/arc/drawer/drawer'
import { Tooltip } from './components/arc/tooltip/tooltip'
import { Button } from './components/arc/button/button'
import { SearchField } from './components/arc/search-field/search-field'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { Editor } from './Editor'
import { journalWeek } from './hub-model'
import './entry-history.css'

function documentText(node: JournalNode): string {
    return node.text ?? (node.content ?? []).map(documentText).join(' ')
}

function entryDate(date: string, options: Intl.DateTimeFormatOptions) {
    return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
        ...options,
        timeZone: 'UTC'
    })
}

export function EntryHistory({ state, onWrite }: { state: State; onWrite: (week: string) => void }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [selectedId, setSelectedId] = useState<string>()
    const [reading, setReading] = useState(false)
    const motion = useHistoryMotion(open, reading, () => {
        setReading(false)
        setOpen(false)
    })
    const reader = useRef<HTMLDivElement>(null)
    const selectedRow = useRef<HTMLButtonElement>(null)
    const preview = historySamples[0]
    const entries = [...state.entries.filter((entry) => entry.id !== preview.id), preview].sort(
        (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)
    )
    const search = query.trim().toLocaleLowerCase('en-US')
    const visible = entries.filter((entry) =>
        `${entry.title} ${entry.date} ${documentText(entry.body)}`.toLocaleLowerCase('en-US').includes(search)
    )
    const selected = useDrawerItem(entries.find((entry) => entry.id === selectedId))
    const months = [...new Set(visible.map((entry) => entry.date.slice(0, 7)))]
    const openWeek = (date?: string) => {
        setReading(false)
        setOpen(false)
        onWrite(date ? journalWeek(date.slice(0, 10), state.settings.weekStart) : '')
    }

    return (
        <Drawer
            open={open}
            onOpenChange={(next) => {
                setOpen(next)
                if (!next) {
                    setReading(false)
                } else if (!motion.drawer.present) {
                    setSelectedId(undefined)
                }
            }}
        >
            <Tooltip content="Previous entries" side="bottom">
                <DrawerTrigger asChild>
                    <Button className="history-trigger" variant="ghost" size="sm" aria-label="Previous entries">
                        <History size={16} strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                </DrawerTrigger>
            </Tooltip>
            <DrawerContent
                className="entry-history"
                coordinatedMotion={motion.drawer}
                onInteractOutside={(event) => {
                    if (event.target instanceof Element && event.target.closest('.history-entry-dialog')) {
                        event.preventDefault()
                    }
                }}
                title="Previous entries"
                description="Your weeks, ready to revisit."
            >
                <div className="history-layout">
                    <section className="history-index" aria-label="Saved entries">
                        <SearchField
                            label="Search entries"
                            hideLabel
                            placeholder={`Search ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}...`}
                            value={query}
                            onValueChange={setQuery}
                        />
                        <ScrollArea
                            className="history-list"
                            viewportClassName="history-list-viewport"
                            label="Previous weekly entries"
                            fade={16}
                        >
                            {visible.length ? (
                                months.map((month) => (
                                    <section
                                        className="history-month"
                                        key={month}
                                        aria-label={entryDate(`${month}-01`, { month: 'long', year: 'numeric' })}
                                    >
                                        <h3>
                                            {entryDate(`${month}-01`, { month: 'long', year: 'numeric' })}
                                            <span className="history-month-count">
                                                {' \u00b7 '}
                                                {visible.filter((entry) => entry.date.startsWith(month)).length}
                                            </span>
                                        </h3>
                                        <ul>
                                            {visible
                                                .filter((entry) => entry.date.startsWith(month))
                                                .map((entry) => (
                                                    <li key={entry.id}>
                                                        <button
                                                            type="button"
                                                            className="history-row"
                                                            aria-pressed={selectedId === entry.id}
                                                            ref={selectedId === entry.id ? selectedRow : undefined}
                                                            aria-controls="history-reader"
                                                            onClick={() => {
                                                                setSelectedId(entry.id)
                                                                setReading(true)
                                                                reader.current?.scrollTo(0, 0)
                                                            }}
                                                        >
                                                            <span className="history-row-date">
                                                                {entryDate(entry.date, {
                                                                    month: 'short',
                                                                    day: 'numeric'
                                                                })}
                                                            </span>
                                                            <span className="history-row-title">{entry.title}</span>
                                                            <span className="history-excerpt">
                                                                {documentText(entry.body) ||
                                                                    'An entry without body text.'}
                                                            </span>
                                                            <ChevronRight
                                                                className="history-row-arrow"
                                                                size={16}
                                                                strokeWidth={1.75}
                                                                aria-hidden="true"
                                                            />
                                                        </button>
                                                    </li>
                                                ))}
                                        </ul>
                                    </section>
                                ))
                            ) : (
                                <EmptyState
                                    icon={<BookOpen size={24} />}
                                    iconVariant="plain"
                                    title={search ? 'No matching entries' : 'Your story starts here'}
                                    description={
                                        search
                                            ? 'Try another word, title, or date.'
                                            : 'Published entries appear here after you save them to Notion and refresh your journal.'
                                    }
                                    action={
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => (search ? setQuery('') : openWeek())}
                                        >
                                            {search ? 'Clear search' : 'Write an entry'}
                                        </Button>
                                    }
                                />
                            )}
                        </ScrollArea>
                    </section>
                </div>
            </DrawerContent>
            <Dialog open={reading} onOpenChange={setReading} modal={false}>
                <DialogContent
                    className="history-entry-dialog"
                    title={selected?.title ?? 'Weekly entry'}
                    aria-describedby={undefined}
                    hideHeader
                    coordinatedMotion={motion.reader}
                    backdrop="none"
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onInteractOutside={(event) => {
                        // The index and reader form one browsing task. Keep the reader open
                        // when focus or a pointer moves back to the list, including search.
                        if (event.target instanceof Element && event.target.closest('.entry-history')) {
                            event.preventDefault()
                        }
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault()
                        if (open) selectedRow.current?.focus()
                    }}
                >
                    <DialogClose className="history-reader-close" aria-label="Close entry">
                        <X size={16} strokeWidth={1.75} aria-hidden="true" />
                    </DialogClose>
                    <section className="history-reader" id="history-reader" aria-label="Entry preview">
                        <ScrollArea
                            className="history-document"
                            label="Read journal entry"
                            viewportRef={reader}
                            fade={16}
                        >
                            {selected && (
                                <article className="history-article">
                                    <h2>{selected.title}</h2>
                                    <Editor value={selected.body} readOnly />
                                </article>
                            )}
                        </ScrollArea>
                    </section>
                </DialogContent>
            </Dialog>
        </Drawer>
    )
}
