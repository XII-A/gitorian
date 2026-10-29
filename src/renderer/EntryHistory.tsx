import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronRight, History, X } from 'lucide-react'
import type { Command, HistoryEntry, EntryPage, Reply, State } from '../shared/model'
import { Dialog, DialogClose, DialogContent } from './components/arc/dialog/dialog'
import { useHistoryMotion } from './use-history-motion'
import { Drawer, DrawerContent, DrawerTrigger, useDrawerItem } from './components/arc/drawer/drawer'
import { Tooltip } from './components/arc/tooltip/tooltip'
import { Button } from './components/arc/button/button'
import { SearchField } from './components/arc/search-field/search-field'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { Editor } from './Editor'
import { HistoryHover } from './HistoryHover'
import './entry-history.css'

function entryDate(date: string, options: Intl.DateTimeFormatOptions) {
    return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
        ...options,
        timeZone: 'UTC'
    })
}

export function EntryHistory({
    state,
    onWrite,
    run
}: {
    state: State
    onWrite: (week: string) => void
    run: (command: Command) => Promise<Reply | undefined>
}) {
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
    const [page, setPage] = useState<EntryPage>({ items: [] })
    const [loadedEntry, setLoadedEntry] = useState<HistoryEntry>()
    const [loading, setLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [detailError, setDetailError] = useState('')
    const [error, setError] = useState('')
    const request = useRef(0)
    useEffect(() => {
        const token = ++request.current
        let active = true
        if (!open) return
        setLoading(true)
        setError('')
        setPage({ items: [] })
        const timer = setTimeout(() => {
            void run({ type: 'entryHistory', query }).then((reply) => {
                if (!active || token !== request.current) return
                setPage(reply?.entryPage ?? { items: [] })
                setError(reply?.entryPage ? '' : 'Could not load entries. Close and reopen to retry.')
                setLoading(false)
            })
        }, 150)
        return () => {
            clearTimeout(timer)
            active = false
        }
    }, [open, query, run, state.restoreId])
    useEffect(() => {
        let active = true
        setLoadedEntry(undefined)
        setDetailError('')
        setDetailLoading(!!selectedId)
        if (selectedId && reading)
            void run({ type: 'entry', id: selectedId }).then((reply) => {
                if (active) {
                    setLoadedEntry(reply?.entry)
                    setDetailLoading(false)
                    if (!reply?.entry) setDetailError('Could not open this entry. Close and reopen it to retry.')
                }
            })
        return () => {
            active = false
        }
    }, [selectedId, reading, run, state.restoreId])
    const more = async () => {
        const token = request.current
        setLoading(true)
        const reply = await run({ type: 'entryHistory', query, cursor: page.next })
        if (token !== request.current) return
        if (reply?.entryPage)
            setPage((previous) => ({ ...reply.entryPage!, items: [...previous.items, ...reply.entryPage!.items] }))
        else setError('Could not load more entries. Retry loading.')
        setLoading(false)
    }
    const search = query.trim()
    const visible = page.items
    const selected = useDrawerItem(loadedEntry)
    const months = [...new Set(visible.map((entry) => entry.date.slice(0, 7)))]
    const openWeek = (date?: string) => {
        setReading(false)
        setOpen(false)
        onWrite(date ?? '')
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
                description="Search your writing by title, date, or text."
            >
                <div className="history-layout">
                    <section className="history-index" aria-label="Saved entries">
                        <SearchField
                            label="Search entries"
                            hideLabel
                            placeholder="Search entries..."
                            value={query}
                            onValueChange={setQuery}
                        />
                        <ScrollArea
                            className="history-list"
                            viewportClassName="history-list-viewport"
                            label="Previous weekly entries"
                            fade={16}
                        >
                            {(loading || error) && <p role="status">{error || 'Loading entries?'}</p>}
                            {visible.length ? (
                                <HistoryHover>
                                    {months.map((month) => (
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
                                                                <span className="history-row-title">
                                                                    {entry.title || 'Untitled entry'}
                                                                </span>
                                                                <span className="history-excerpt">
                                                                    {entry.excerpt || 'An entry without body text.'}
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
                                    ))}
                                </HistoryHover>
                            ) : !loading && !error ? (
                                <EmptyState
                                    icon={<BookOpen size={24} />}
                                    iconVariant="plain"
                                    title={search ? 'No matching entries' : 'No entries yet'}
                                    description={
                                        search
                                            ? 'Try another word, title, or date.'
                                            : 'Your writing appears here automatically as you write.'
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
                            ) : null}
                            {page.next && (
                                <Button variant="ghost" size="sm" loading={loading} onClick={more}>
                                    Load more entries
                                </Button>
                            )}
                        </ScrollArea>
                    </section>
                </div>
                <Dialog open={reading} onOpenChange={setReading} modal={false}>
                    <DialogContent
                        className="history-entry-dialog"
                        title={selected?.title ?? 'Weekly entry'}
                        aria-describedby={undefined}
                        hideHeader
                        registerAsBranch
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
                                {detailLoading && <p role="status">Loading entry...</p>}
                                {detailError && <p role="alert">{detailError}</p>}
                                {!detailLoading && !detailError && selected && (
                                    <article className="history-article">
                                        <h2>{selected.title || 'Untitled entry'}</h2>
                                        <Editor value={selected.body} readOnly />
                                        {selected.week && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openWeek(selected.week)}
                                            >
                                                Edit entry
                                            </Button>
                                        )}
                                        {selected.url && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => run({ type: 'open', url: selected.url! })}
                                            >
                                                Open in Notion
                                            </Button>
                                        )}
                                    </article>
                                )}
                            </ScrollArea>
                        </section>
                    </DialogContent>
                </Dialog>
            </DrawerContent>
        </Drawer>
    )
}
