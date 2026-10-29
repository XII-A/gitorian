import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'motion/react'
import { motionTokens } from './components/arc/motion-tokens'

/** Shared by the hub and history so their pointer feedback stays consistent. */
export function useRowHover(selector: string, children: ReactNode) {
    const root = useRef<HTMLDivElement>(null)
    const active = useRef<HTMLButtonElement | null>(null)
    const reduced = useReducedMotion()
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const width = useMotionValue(0)
    const height = useMotionValue(0)
    const opacity = useMotionValue(0)
    const targets = useRef<number[]>([])

    const hide = useCallback(() => {
        if (!active.current) return
        active.current = null
        animate(opacity, 0, { duration: reduced ? 0 : motionTokens.duration.fast })
    }, [opacity, reduced])
    const hideOnScroll = useCallback(() => {
        active.current = null
        opacity.jump(0)
    }, [opacity])
    const position = useCallback(
        (row: HTMLButtonElement, mode: 'instant' | 'animate' | 'sync') => {
            if (!root.current) return
            const bounds = root.current.getBoundingClientRect()
            const rect = row.getBoundingClientRect()
            const dimensions = [
                [x, rect.left - bounds.left],
                [y, rect.top - bounds.top],
                [width, rect.width],
                [height, rect.height]
            ] as const
            for (const [index, [value, target]] of dimensions.entries()) {
                // Disclosing a day resizes the list on every frame. Unchanged
                // row geometry must not cancel a hover spring with jump().
                if (mode === 'sync' && !reduced && targets.current[index] === target) continue
                targets.current[index] = target
                if (reduced || mode === 'instant' || (mode === 'sync' && !value.isAnimating())) value.jump(target)
                else animate(value, target, motionTokens.spring.morph)
            }
        },
        [x, y, width, height, reduced]
    )
    const sync = useCallback(() => {
        const row = active.current
        if (!row || !row.isConnected || row.closest('[inert]') || !root.current?.contains(row)) {
            // Opacity alone leaves transformed decorations in the scroll overflow.
            active.current = null
            targets.current = []
            for (const value of [x, y, width, height, opacity]) value.jump(0)
        } else position(row, 'sync')
    }, [x, y, width, height, opacity, position])
    const hover = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'touch' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
        const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(selector) : null
        if (!row || row.disabled || row.closest('[inert]') || !event.currentTarget.contains(row)) {
            hide()
            return
        }
        if (row === active.current) return
        active.current = row
        position(row, opacity.get() === 0 ? 'instant' : 'animate')
        animate(opacity, 1, { duration: reduced ? 0 : motionTokens.duration.instant })
    }

    useLayoutEffect(() => {
        sync()
        if (reduced) opacity.jump(active.current ? 1 : 0)
    }, [children, sync, reduced, opacity])
    useEffect(() => {
        const observer = new ResizeObserver(sync)
        if (root.current) observer.observe(root.current)
        window.addEventListener('scroll', hideOnScroll, true)
        return () => {
            observer.disconnect()
            window.removeEventListener('scroll', hideOnScroll, true)
            for (const value of [x, y, width, height, opacity]) value.stop()
        }
    }, [sync, hideOnScroll, x, y, width, height, opacity])

    return {
        root,
        style: { x, y, width, height, opacity },
        handlers: { onPointerMove: hover, onPointerLeave: hide, onPointerCancel: hide }
    }
}
