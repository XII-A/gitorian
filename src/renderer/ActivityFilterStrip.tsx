import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import './activity-filter-strip.css'

const EDGE_FADE = 24

/** Fixed filters stay in one row, with resting scroll cues that do not depend on chip hover. */
export function ActivityFilterStrip({ children, className }: { children: ReactNode; className: string }) {
    const root = useRef<HTMLDivElement>(null)
    const items = useRef<HTMLDivElement>(null)
    const viewport = useRef<HTMLDivElement>(null)
    const [overflow, setOverflow] = useState(false)
    const [edges, setEdges] = useState({ left: false, right: false })
    const leftArrow = useRef<HTMLButtonElement>(null)
    const rightArrow = useRef<HTMLButtonElement>(null)
    const reduced = useReducedMotion()
    const showLeft = overflow && edges.left
    const showRight = overflow && edges.right
    // Ref cleanup runs before removal, while the disappearing button still owns focus.
    const leftButtonRef = useCallback((node: HTMLButtonElement | null) => {
        if (!node && document.activeElement === leftArrow.current) viewport.current?.focus({ preventScroll: true })
        leftArrow.current = node
    }, [])
    const rightButtonRef = useCallback((node: HTMLButtonElement | null) => {
        if (!node && document.activeElement === rightArrow.current) viewport.current?.focus({ preventScroll: true })
        rightArrow.current = node
    }, [])
    useLayoutEffect(() => {
        const container = root.current,
            content = items.current
        if (!container || !content) return
        const measure = () => {
            const style = getComputedStyle(container)
            const available = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            setOverflow(content.scrollWidth > available + 1)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(container)
        observer.observe(content)
        return () => observer.disconnect()
    }, [])
    const scroll = (direction: number, instant: boolean) => {
        const node = viewport.current
        node?.scrollBy({
            left: direction * node.clientWidth * 0.75,
            behavior: reduced || instant ? 'instant' : 'smooth'
        })
    }
    const startOverlay = showLeft ? (
        <div className="activity-filter-edge activity-filter-edge-start">
            <Button
                variant="ghost"
                size="sm"
                className="activity-filter-arrow"
                animateContent={false}
                aria-label="Scroll activity filters left"
                ref={leftButtonRef}
                onClick={(event) => scroll(-1, event.detail === 0)}
            >
                <ChevronLeft size={16} aria-hidden="true" />
            </Button>
        </div>
    ) : null
    const endOverlay = showRight ? (
        <div className="activity-filter-edge activity-filter-edge-end">
            <Button
                variant="ghost"
                size="sm"
                className="activity-filter-arrow"
                animateContent={false}
                aria-label="Scroll activity filters right"
                ref={rightButtonRef}
                onClick={(event) => scroll(1, event.detail === 0)}
            >
                <ChevronRight size={16} aria-hidden="true" />
            </Button>
        </div>
    ) : null
    return (
        <div
            ref={root}
            className={`activity-filter-strip ${className}`}
            data-overflow={overflow || undefined}
            role="group"
            aria-label="Filter activity"
            onFocusCapture={(event) => {
                const node = viewport.current,
                    target = event.target
                if (!node || !(target instanceof HTMLElement) || !node.contains(target) || target === node) return
                const bounds = node.getBoundingClientRect(),
                    control = target.getBoundingClientRect()
                const start = leftArrow.current?.getBoundingClientRect().right ?? bounds.left
                const end = rightArrow.current?.getBoundingClientRect().left ?? bounds.right
                if (control.left < start + 4) node.scrollLeft += control.left - start - 4
                else if (control.right > end - 4) node.scrollLeft += control.right - end + 4
            }}
        >
            <ScrollArea
                className="activity-filter-scroll"
                orientation="horizontal"
                wheelToHorizontal={false}
                label="Activity filters"
                viewportClassName="activity-filter-viewport"
                viewportRef={viewport}
                fade={EDGE_FADE}
                scrollbars="hover"
                startOverlay={startOverlay}
                endOverlay={endOverlay}
                onEdgeChange={(value) => setEdges({ left: value.left, right: value.right })}
            >
                <div ref={items} className="activity-filter-items">
                    {children}
                </div>
            </ScrollArea>
        </div>
    )
}
