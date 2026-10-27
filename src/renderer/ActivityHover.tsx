import { useCallback, useEffect, useId, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useRowHover } from './use-row-hover'

/** One moving surface for the whole activity column, including its day groups. */
export function ActivityHover({ children }: { children: ReactNode }) {
    const { root, style, handlers } = useRowHover('.activity-row', children)
    const { x, y, width, height, opacity } = style
    const clipId = useId()
    const [timeline, setTimeline] = useState({ neutral: '', merged: '' })

    // Two paths mirror the existing borders, rather than adding motion to every row.
    const measureTimeline = useCallback(() => {
        if (!root.current) return
        const bounds = root.current.getBoundingClientRect()
        const viewport = root.current.closest('[role="region"]')?.getBoundingClientRect()
        const paths = { neutral: '', merged: '' }
        for (const row of root.current.querySelectorAll<HTMLButtonElement>('.activity-row')) {
            // Selected rows own their strong border. Painting the moving stroke over
            // that border doubles its antialiased edge at fractional coordinates.
            if (row.getAttribute('aria-pressed') === 'true' || row.closest('[inert]')) continue
            const node = row.querySelector<HTMLElement>('.activity-row-node')
            if (!node) continue
            const rect = row.getBoundingClientRect()
            if (viewport && (rect.bottom < viewport.top || rect.top > viewport.bottom)) continue
            const circle = node.getBoundingClientRect()
            if (!rect.height || !circle.width) continue
            const cx = circle.left - bounds.left + circle.width / 2
            const cy = circle.top - bounds.top + circle.height / 2
            const radius = (circle.width - 1) / 2
            const kind = row.dataset.kind === 'merged' ? 'merged' : 'neutral'
            paths[kind] +=
                `M${cx - radius},${cy}a${radius},${radius} 0 1 0 ${radius * 2},0a${radius},${radius} 0 1 0 ${-radius * 2},0 `
            for (const pseudo of ['::before', '::after']) {
                const style = getComputedStyle(row, pseudo)
                if (style.content === 'none' || style.content === 'normal') continue
                const top = parseFloat(style.top)
                const bottom = parseFloat(style.bottom)
                const length = Number.isFinite(bottom) ? rect.height - top - bottom : parseFloat(style.height)
                const lineX = rect.left - bounds.left + parseFloat(style.left) + 0.5
                const lineY = rect.top - bounds.top + top
                paths.neutral += `M${lineX},${lineY}v${length} `
            }
        }
        setTimeline((previous) =>
            previous.neutral === paths.neutral && previous.merged === paths.merged ? previous : paths
        )
    }, [root])

    useLayoutEffect(measureTimeline, [measureTimeline])
    useEffect(() => {
        let frame = 0
        const schedule = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(measureTimeline)
        }
        const observer = new ResizeObserver(schedule)
        if (root.current) observer.observe(root.current)
        // React can render new children without changing any row geometry.
        // Only DOM changes in the activity list invalidate the measured paths.
        const mutations = new MutationObserver((records) => {
            if (
                records.some((record) => {
                    const target = record.target instanceof Element ? record.target : record.target.parentElement
                    return (
                        target?.closest('.activity-row-list') ||
                        [...record.addedNodes, ...record.removedNodes].some(
                            (node) =>
                                node instanceof Element &&
                                (node.matches('.activity-row-list') || node.querySelector('.activity-row'))
                        )
                    )
                })
            )
                schedule()
        })
        if (root.current)
            mutations.observe(root.current, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['data-kind', 'data-connected', 'aria-pressed', 'inert']
            })
        const viewport = root.current?.closest('[role="region"]')
        viewport?.addEventListener('scroll', schedule, { passive: true })
        return () => {
            observer.disconnect()
            mutations.disconnect()
            viewport?.removeEventListener('scroll', schedule)
            cancelAnimationFrame(frame)
        }
    }, [root, measureTimeline])

    return (
        <div className="activity-hover" ref={root} {...handlers}>
            <motion.span
                className="activity-hover-highlight"
                style={{ x, y, width, height, opacity }}
                aria-hidden="true"
            />
            {children}
            <motion.svg className="activity-hover-timeline" style={{ opacity }} aria-hidden="true" focusable="false">
                <defs>
                    <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                        <motion.rect x={x} y={y} width={width} height={height} />
                    </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`} fill="none" strokeWidth="1">
                    <path d={timeline.neutral} stroke="var(--border-strong)" />
                    <path d={timeline.merged} stroke="color-mix(in oklab, var(--success) 30%, var(--border-strong))" />
                </g>
            </motion.svg>
        </div>
    )
}
