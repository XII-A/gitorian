import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/lib/motion-tokens'

/** One moving surface for the whole activity column, including its day groups. */
export function ActivityHover({ children }: { children: ReactNode }) {
    const root = useRef<HTMLDivElement>(null)
    const active = useRef<HTMLButtonElement | null>(null)
    const reduced = useReducedMotion()
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const width = useMotionValue(0)
    const height = useMotionValue(0)
    const opacity = useMotionValue(0)

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
        position(row, opacity.get() === 0)
        active.current = row
        animate(opacity, 1, { duration: reduced ? 0 : motionTokens.duration.instant })
    }

    // Reflow and filtering cannot leave the surface at a stale row position.
    useLayoutEffect(() => {
        sync()
        if (reduced) opacity.jump(active.current ? 1 : 0)
    }, [children, sync, reduced, opacity])
    useEffect(() => {
        const observer = new ResizeObserver(sync)
        if (root.current) observer.observe(root.current)
        window.addEventListener('scroll', hide, true)
        return () => {
            observer.disconnect()
            window.removeEventListener('scroll', hide, true)
            for (const value of [x, y, width, height, opacity]) value.stop()
        }
    }, [sync, hide, x, y, width, height, opacity])

    return (
        <div className="activity-hover" ref={root} onPointerMove={hover} onPointerLeave={hide} onPointerCancel={hide}>
            <motion.span
                className="activity-hover-highlight"
                style={{ x, y, width, height, opacity }}
                aria-hidden="true"
            />
            {children}
        </div>
    )
}
