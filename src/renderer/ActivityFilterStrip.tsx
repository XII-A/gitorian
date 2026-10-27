import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import './activity-filter-strip.css'

/** Fixed filters stay in one row; the native scroll area supplies edge fades and touch scrolling. */
export function ActivityFilterStrip({ children, className }: { children: ReactNode; className: string }) {
    const root = useRef<HTMLDivElement>(null)
    const items = useRef<HTMLDivElement>(null)
    const viewport = useRef<HTMLDivElement>(null)
    const [overflow, setOverflow] = useState(false)
    const [edges, setEdges] = useState({ left: false, right: false })
    const reduced = useReducedMotion()
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
                if (control.left < bounds.left + 4) node.scrollLeft += control.left - bounds.left - 4
                else if (control.right > bounds.right - 4) node.scrollLeft += control.right - bounds.right + 4
            }}
        >
            {overflow && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="activity-filter-arrow"
                    animateContent={false}
                    aria-label="Scroll activity filters left"
                    disabled={!edges.left}
                    onClick={(event) => scroll(-1, event.detail === 0)}
                >
                    <ChevronLeft size={16} aria-hidden="true" />
                </Button>
            )}
            <ScrollArea
                className="activity-filter-scroll"
                orientation="horizontal"
                wheelToHorizontal={false}
                label="Activity filters"
                viewportClassName="activity-filter-viewport"
                viewportRef={viewport}
                fade={12}
                onEdgeChange={(value) => setEdges({ left: value.left, right: value.right })}
            >
                <div ref={items} className="activity-filter-items">
                    {children}
                </div>
            </ScrollArea>
            {overflow && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="activity-filter-arrow"
                    animateContent={false}
                    aria-label="Scroll activity filters right"
                    disabled={!edges.right}
                    onClick={(event) => scroll(1, event.detail === 0)}
                >
                    <ChevronRight size={16} aria-hidden="true" />
                </Button>
            )}
        </div>
    )
}
