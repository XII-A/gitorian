import { useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Grid2X2, Clock, Smile, Leaf, Coffee, Trophy, Plane, Lightbulb, Shapes, Flag } from 'lucide-react'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/arc/tabs/tabs'
import { emojiCategories, type EmojiCategory, type EmojiResult } from './emoji-catalog'

const icons = [Grid2X2, Clock, Smile, Leaf, Coffee, Trophy, Plane, Lightbulb, Shapes, Flag]
type Row = { label: string } | { start: number; items: EmojiResult[] }
export function EmojiPicker({
    results,
    category,
    active,
    id,
    onCategory,
    onChoose,
    onReturnToEditor
}: {
    results: EmojiResult[]
    category: EmojiCategory
    active: number
    id: string
    onCategory: (category: EmojiCategory) => void
    onChoose: (emoji: string) => void
    onReturnToEditor: () => void
}) {
    const viewport = useRef<HTMLDivElement>(null)
    const rows = useMemo(() => {
        const next: Row[] = []
        for (let start = 0; start < results.length;) {
            const section = results[start].section
            next.push({ label: emojiCategories.find((item) => item.id === section)?.label ?? 'Emoji' })
            while (start < results.length && results[start].section === section) {
                let end = start
                while (end < Math.min(start + 8, results.length) && results[end].section === section) end++
                next.push({ start, items: results.slice(start, end) })
                start = end
            }
        }
        return next
    }, [results])
    const virtual = useVirtualizer({
        count: rows.length,
        getScrollElement: () => viewport.current,
        estimateSize: (index) => ('label' in rows[index] ? 32 : 44),
        overscan: 2
    })
    useLayoutEffect(() => {
        viewport.current?.scrollTo({ top: 0 })
    }, [results])
    useLayoutEffect(() => {
        const row = rows.findIndex(
            (item) => 'start' in item && active >= item.start && active < item.start + item.items.length
        )
        if (row >= 0) virtual.scrollToIndex(active === 0 ? 0 : row, { align: active === 0 ? 'start' : 'auto' })
    }, [active, rows, virtual])
    return (
        <Tabs
            value={category}
            variant="underline"
            className="journal-emoji-tabs"
            onValueChange={(value) => onCategory(value as EmojiCategory)}
        >
            <TabsList fullWidth aria-label="Emoji categories" className="journal-emoji-categories" style={{ gap: 0 }}>
                {emojiCategories.map((item, index) => {
                    const Icon = icons[index]
                    return (
                        <TabsTrigger
                            key={item.id}
                            value={item.id}
                            aria-label={item.label}
                            title={item.label}
                            onMouseDown={(event) => event.preventDefault()}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    onCategory(item.id)
                                    onReturnToEditor()
                                }
                            }}
                            onClick={() => {
                                onCategory(item.id)
                                onReturnToEditor()
                            }}
                        >
                            <Icon size={16} aria-hidden="true" />
                        </TabsTrigger>
                    )
                })}
            </TabsList>
            <TabsContent
                value={category}
                forceMount
                aria-label={emojiCategories.find((item) => item.id === category)?.label}
            >
                <ScrollArea
                    label="Emoji results"
                    viewportRef={viewport}
                    maxHeight="min(280px, calc(var(--radix-popover-content-available-height, 368px) - 88px))"
                    fade={12}
                >
                    <div
                        role="listbox"
                        id={`${id}-emoji-options`}
                        aria-label="Emoji"
                        className="journal-emoji-rows"
                        style={{ height: virtual.getTotalSize() }}
                    >
                        {virtual.getVirtualItems().map((row) => {
                            const data = rows[row.index]
                            return (
                                <div
                                    key={row.key}
                                    className={'label' in data ? 'journal-emoji-section' : 'journal-emoji-grid'}
                                    style={{ position: 'absolute', insetInline: 0, top: row.start, height: row.size }}
                                >
                                    {'label' in data
                                        ? data.label
                                        : data.items.map((item, column) => {
                                              const index = data.start + column
                                              return (
                                                  <button
                                                      type="button"
                                                      role="option"
                                                      key={item.emoji}
                                                      id={`${id}-block-${index}`}
                                                      aria-label={item.names[0]}
                                                      title={item.description}
                                                      aria-selected={active === index}
                                                      aria-posinset={index + 1}
                                                      aria-setsize={results.length}
                                                      tabIndex={-1}
                                                      onMouseDown={(event) => event.preventDefault()}
                                                      onClick={() => onChoose(item.emoji)}
                                                  >
                                                      {item.emoji}
                                                  </button>
                                              )
                                          })}
                                </div>
                            )
                        })}
                    </div>
                    {!results.length && (
                        <p className="ws-block-empty">
                            {category === 'recent'
                                ? 'Your picked emoji will appear here.'
                                : 'No emoji found. Try another name.'}
                        </p>
                    )}
                </ScrollArea>
            </TabsContent>
        </Tabs>
    )
}
