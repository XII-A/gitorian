import { memo } from 'react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { Ellipsis } from 'lucide-react'
import type { Activity } from '../shared/model'

export function VirtualActivityDayRows({
    day,
    items,
    expanded,
    onExpandedChange,
    focused,
    renderRow,
    restoreFocusId
}: {
    restoreFocusId?: string
    day: string
    items: Activity[]
    expanded: boolean
    onExpandedChange: (open: boolean) => void
    focused: boolean
    renderRow: (item: Activity, connected: boolean) => ReactNode
}) {
    const root = useRef<HTMLDivElement>(null)
    const list = useRef<HTMLUListElement>(null)
    const pendingFocus = useRef<string | undefined>(restoreFocusId)
    const [focusedId, setFocusedId] = useState<string | null>(restoreFocusId ?? null)
    const indicesById = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items])
    const focusedIndex = focusedId ? (indicesById.get(focusedId) ?? null) : null
    const [scrollMargin, setScrollMargin] = useState(0)
    const showingAll = expanded || focused
    const count = showingAll ? items.length : Math.min(5, items.length)
    const measureOffset = useCallback(() => {
        const node = root.current
        const viewport = node?.closest<HTMLElement>('[role="region"]')
        if (node && viewport) {
            const offset = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
            setScrollMargin((current) => (Math.abs(current - offset) < 0.5 ? current : offset))
        }
    }, [])
    useLayoutEffect(measureOffset, [measureOffset, day, items, expanded, focused])
    useLayoutEffect(() => {
        const observer = new ResizeObserver(measureOffset)
        if (root.current?.parentElement?.parentElement) observer.observe(root.current.parentElement.parentElement)
        window.addEventListener('resize', measureOffset)
        return () => {
            observer.disconnect()
            window.removeEventListener('resize', measureOffset)
        }
    }, [measureOffset])
    const getItemKey = useCallback((index: number) => items[index].id, [items])
    const extractRange = useCallback(
        (range: Parameters<typeof defaultRangeExtractor>[0]) => {
            const indices = defaultRangeExtractor(range)
            if (focusedIndex !== null && focusedIndex < count && !indices.includes(focusedIndex))
                indices.push(focusedIndex)
            return indices.sort((a, b) => a - b)
        },
        [focusedIndex, count]
    )
    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => root.current?.closest<HTMLElement>('[role="region"]') ?? null,
        getItemKey,
        estimateSize: () => 88,
        overscan: 6,
        scrollMargin,
        scrollPaddingStart: 80,
        initialRect: { width: 600, height: 800 },
        rangeExtractor: extractRange
    })
    useLayoutEffect(() => {
        let width = 0
        const node = root.current
        if (!node) return
        const observer = new ResizeObserver(([entry]) => {
            const next = entry?.contentRect.width ?? 0
            if (width && Math.abs(next - width) > 1) {
                const viewport = node.closest<HTMLElement>('[role="region"]')
                const anchor = virtualizer
                    .getVirtualItems()
                    .find((row) => row.end > (virtualizer.scrollOffset ?? 0) + 80)
                virtualizer.measure()
                list.current
                    ?.querySelectorAll<HTMLElement>('[data-index]')
                    .forEach((element) => virtualizer.measureElement(element))
                if (anchor && viewport) virtualizer.scrollToIndex(anchor.index, { align: 'start' })
            }
            width = next
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [virtualizer])
    const rows = virtualizer.getVirtualItems()
    useLayoutEffect(() => {
        if (pendingFocus.current === undefined) return
        const index = indicesById.get(pendingFocus.current)
        const button =
            index === undefined
                ? null
                : list.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"] button`)
        if (button) {
            button.focus({ preventScroll: true })
            pendingFocus.current = undefined
        }
    }, [rows, indicesById])
    const navigate = (event: KeyboardEvent<HTMLUListElement>) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
        const item = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
        if (!item) return
        const next = Number(item.dataset.index) + (event.shiftKey ? -1 : 1)
        if (next < 0 || next >= count) return
        event.preventDefault()
        pendingFocus.current = items[next].id
        setFocusedId(items[next].id)
        virtualizer.scrollToIndex(next, { align: 'auto' })
        const button = list.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"] button`)
        if (button) {
            button.focus({ preventScroll: true })
            pendingFocus.current = undefined
        }
    }
    return (
        <div className="activity-day-rows" ref={root} data-virtual-count={count}>
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Delegates Tab between the native row buttons as virtual rows mount. */}
            <ul
                ref={list}
                className="activity-row-list activity-virtual-list"
                style={{ height: virtualizer.getTotalSize() }}
                aria-label={`Activities for ${day}`}
                onKeyDown={navigate}
                onFocusCapture={(event) => {
                    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
                    if (row) setFocusedId(items[Number(row.dataset.index)].id)
                }}
                onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null)
                }}
            >
                {rows.map((row) => (
                    <li
                        key={row.key}
                        data-index={row.index}
                        ref={virtualizer.measureElement}
                        aria-posinset={row.index + 1}
                        aria-setsize={items.length}
                        style={{
                            position: 'absolute',
                            top: 0,
                            insetInline: 0,
                            transform: `translateY(${row.start - scrollMargin}px)`
                        }}
                    >
                        <VirtualRowContent
                            activity={items[row.index]}
                            connected={row.index < items.length - 1 || (!focused && items.length > 5)}
                            renderRow={renderRow}
                        />
                    </li>
                ))}
            </ul>
            {!focused && items.length > 5 && (
                <button
                    type="button"
                    className="activity-row activity-day-toggle"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Show fewer activities' : `Show ${items.length - 5} more activities`} for ${day}`}
                    onClick={() => {
                        if (expanded && root.current) {
                            const viewport = root.current.closest<HTMLElement>('[role="region"]')
                            if (viewport)
                                viewport.scrollTop = Math.min(
                                    viewport.scrollTop,
                                    Math.max(
                                        0,
                                        viewport.scrollTop +
                                            root.current.getBoundingClientRect().top -
                                            viewport.getBoundingClientRect().top -
                                            80
                                    )
                                )
                            setFocusedId(null)
                        }
                        onExpandedChange(!expanded)
                    }}
                >
                    <span className="activity-row-node" aria-hidden="true">
                        <Ellipsis size={14} />
                    </span>
                    <span>{expanded ? 'Show fewer' : `Show ${items.length - 5} more`}</span>
                </button>
            )}
        </div>
    )
}

// Scroll-window movement changes list positions, not the unchanged row contents.
const VirtualRowContent = memo(function VirtualRowContent({
    activity,
    connected,
    renderRow
}: {
    activity: Activity
    connected: boolean
    renderRow: (item: Activity, connected: boolean) => ReactNode
}) {
    return renderRow(activity, connected)
})
