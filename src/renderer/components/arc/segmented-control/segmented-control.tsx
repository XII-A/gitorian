'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './segmented-control.module.css'

export interface Segment {
    value: string
    label: string
    /** Optional content after the label, such as a badge. */ accessory?: ReactNode
}
export interface SegmentedControlProps {
    options: Segment[]
    value: string
    onValueChange: (value: string) => void
    label?: string
    /** Called when the pointer or focus reaches an option, before it is chosen. Use it to start loading what that option shows. */
    onOptionIntent?: (value: string) => void
    className?: string
    size?: 'sm' | 'md'
    /** Distribute options evenly across the available width. */
    fullWidth?: boolean
}

const SegmentedControl = ({
    options,
    value,
    onValueChange,
    label,
    onOptionIntent,
    className,
    size = 'md',
    fullWidth = false
}: SegmentedControlProps) => {
    const id = useId()
    const reduced = useReducedMotion()
    const track = useRef<HTMLDivElement>(null)
    const [selection, setSelection] = useState<{ x: number; width: number }>()

    // Keep one indicator in track coordinates. Shared layout IDs also animate ancestor scroll clamps as movement.
    useLayoutEffect(() => {
        const node = track.current
        if (!node) {
            return
        }
        const measure = () => {
            const button = node.querySelector<HTMLElement>('[aria-pressed="true"]')
            if (!button) {
                setSelection(undefined)
                return
            }
            const x = button.offsetLeft
            const width = button.offsetWidth
            setSelection((current) => (current?.x === x && current.width === width ? current : { width, x }))
        }
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        observer?.observe(node)
        for (const button of node.querySelectorAll('button')) {
            observer?.observe(button)
        }
        return () => observer?.disconnect()
    }, [value, options])

    // When the options are wider than the container, the track scrolls inside itself. Edges fade only on the side with more to see.
    useLayoutEffect(() => {
        const node = track.current
        if (!node) {
            return
        }
        const edges = () => {
            const rest = node.scrollWidth - node.clientWidth - node.scrollLeft
            node.toggleAttribute('data-fade-start', node.scrollLeft > 1)
            node.toggleAttribute('data-fade-end', rest > 1)
        }
        edges()
        node.addEventListener('scroll', edges, { passive: true })
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(edges)
        observer?.observe(node)
        return () => {
            node.removeEventListener('scroll', edges)
            observer?.disconnect()
        }
    }, [options.length])

    // The selected option is always scrolled fully into view, with a little room so it clears the fade.
    const first = useRef(true)
    useEffect(() => {
        const node = track.current
        const button = node?.querySelector<HTMLElement>('[aria-pressed="true"]')
        if (!node || !button || node.scrollWidth <= node.clientWidth) {
            first.current = false
            return
        }
        const room = 20
        const start = button.offsetLeft - room
        const end = button.offsetLeft + button.offsetWidth + room - node.clientWidth
        const left = (() => {
            if (node.scrollLeft > start) {
                return start
            }
            if (node.scrollLeft < end) {
                return end
            }
            return node.scrollLeft
        })()
        if (left !== node.scrollLeft) {
            node.scrollTo({ behavior: first.current || reduced ? 'auto' : 'smooth', left: Math.max(0, left) })
        }
        first.current = false
    }, [value, reduced])

    // Arrow keys, Home and End move the selection like a tab list; only the selected option is a tab stop.
    const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value)
    )
    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const last = options.length - 1
        const target = (() => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                if (selectedIndex === last) {
                    return 0
                }
                return selectedIndex + 1
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                if (selectedIndex === 0) {
                    return last
                }
                return selectedIndex - 1
            }
            if (event.key === 'Home') {
                return 0
            }

            if (event.key === 'End') {
                return last
            }

            return -1
        })()
        if (target < 0 || !options[target]) {
            return
        }
        event.preventDefault()
        onValueChange(options[target].value)
        track.current
            ?.querySelector<HTMLElement>(`[data-value="${CSS.escape(options[target].value)}"]`)
            ?.focus({ preventScroll: true })
    }

    return (
        <div
            className={`${styles.root} ${className ?? ''}`}
            data-size={size}
            data-full-width={fullWidth || undefined}
            role="group"
            aria-label={label}
        >
            <div ref={track} className={styles.track}>
                {selection && (
                    <motion.span
                        className={styles.selection}
                        initial={false}
                        animate={selection}
                        transition={reduced ? { duration: 0 } : motionTokens.spring.morph}
                        aria-hidden="true"
                    />
                )}
                {options.map((option, index) => (
                    <button
                        key={option.value}
                        id={`${id}-${option.value}`}
                        className={styles.button}
                        type="button"
                        data-value={option.value}
                        aria-pressed={value === option.value}
                        tabIndex={index === selectedIndex ? 0 : -1}
                        onClick={() => {
                            onValueChange(option.value)
                        }}
                        onKeyDown={onKeyDown}
                        onPointerEnter={
                            onOptionIntent
                                ? () => {
                                      onOptionIntent(option.value)
                                  }
                                : undefined
                        }
                        onFocus={
                            onOptionIntent
                                ? () => {
                                      onOptionIntent(option.value)
                                  }
                                : undefined
                        }
                    >
                        <span className={styles.label}>
                            {option.label}
                            {option.accessory}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
export default SegmentedControl
