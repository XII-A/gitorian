import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/lib/motion-tokens'

/** One moving surface for the whole activity column, including its day groups. */
export function ActivityHover({ children }: { children: ReactNode }) {
    const root = useRef<HTMLDivElement>(null)
    const active = useRef<HTMLButtonElement | null>(null)
    const clipId = useId()
    const [timeline, setTimeline] = useState({ neutral: '', merged: '' })
    const reduced = useReducedMotion()
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const width = useMotionValue(0)
    const height = useMotionValue(0)
    const opacity = useMotionValue(0)

    // Two paths mirror the existing borders, rather than adding motion to every row.
    const measureTimeline = useCallback(() => {
        if (!root.current) return
        const bounds = root.current.getBoundingClientRect()
        const paths = { neutral: '', merged: '' }
        for (const row of root.current.querySelectorAll<HTMLButtonElement>('.activity-row')) {
            const node = row.querySelector<HTMLElement>('.activity-row-node')
            if (!node) continue
            const rect = row.getBoundingClientRect()
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
    }, [])

    const hide = useCallback(() => {
        if (!active.current) return
        active.current = null
        animate(opacity, 0, { duration: reduced ? 0 : motionTokens.duration.fast })
    }, [opacity, reduced])
    const position = useCallback(
        (row: HTMLButtonElement, instant: boolean) => {
            if (!root.current) return
            const bounds = root.current.getBoundingClientRect()
            const rect = row.getBoundingClientRect()
            const dimensions = [
                [x, rect.left - bounds.left],
                [y, rect.top - bounds.top],
                [width, rect.width],
                [height, rect.height]
            ] as const
            for (const [value, target] of dimensions) {
                if (instant || reduced) value.jump(target)
                else animate(value, target, motionTokens.spring.morph)
            }
        },
        [x, y, width, height, reduced]
    )
    const sync = useCallback(() => {
        const row = active.current
        if (!row) return
        if (!row.isConnected || !root.current?.contains(row)) hide()
        else position(row, true)
    }, [hide, position])
    const hover = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'touch' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
        const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.activity-row') : null
        if (!row || row.disabled || !event.currentTarget.contains(row)) {
            hide()
            return
        }
        if (row === active.current) return
        active.current = row
        position(row, opacity.get() === 0)
        animate(opacity, 1, { duration: reduced ? 0 : motionTokens.duration.instant })
    }

    // Reflow and filtering cannot leave the surface at a stale row position.
    useLayoutEffect(() => {
        measureTimeline()
        sync()
        if (reduced) opacity.jump(active.current ? 1 : 0)
    }, [children, sync, reduced, opacity, measureTimeline])
    useEffect(() => {
        const observer = new ResizeObserver(() => {
            measureTimeline()
            sync()
        })
        if (root.current) observer.observe(root.current)
        window.addEventListener('scroll', hide, true)
        return () => {
            observer.disconnect()
            window.removeEventListener('scroll', hide, true)
            for (const value of [x, y, width, height, opacity]) value.stop()
        }
    }, [sync, hide, x, y, width, height, opacity, measureTimeline])

    return (
        <div className="activity-hover" ref={root} onPointerMove={hover} onPointerLeave={hide} onPointerCancel={hide}>
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
