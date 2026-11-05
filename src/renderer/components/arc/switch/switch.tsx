'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, ComponentRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'
import { motionTokens } from '../motion-tokens'
import styles from './switch.module.css'

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
    label?: string
    /** A compact track keeps preference rows quiet without reducing their hit area. */
    size?: 'sm' | 'md'
    /** Preference lists place the label before the track. */
    labelPosition?: 'start' | 'end'
}

/** Track inner width (42 - 6 padding) minus the 18px thumb; keep in sync with switch.module.css. */
const thumbSize = 18
const thumbTravel = 18
/** How far the thumb widens toward the other side while pressed. */
const stretch = 5
/** Critically damped: the thumb lands on its end without overshooting the state it reports. */
const glide: Transition = { type: 'spring', visualDuration: 0.3, bounce: 0 }

export const Switch = forwardRef<ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(function Switch(
    {
        label,
        size = 'md',
        labelPosition = 'end',
        className,
        checked,
        defaultChecked,
        onCheckedChange,
        onPointerDown,
        onPointerUp,
        onPointerLeave,
        onPointerCancel,
        onKeyDown,
        onKeyUp,
        onBlur,
        ...props
    },
    ref
) {
    const reduceMotion = useReducedMotion()
    const [internal, setInternal] = useState(defaultChecked ?? false)
    const [pressed, setPressed] = useState(false)
    const keyboard = useRef(false)
    const on = checked ?? internal
    const compact = size === 'sm'
    const diameter = compact ? 12 : thumbSize
    const travel = compact ? 12 : thumbTravel
    // A brief stretch along the travel, so the thumb reads as moving mass rather than a sliding dot.
    const scaleX = useMotionValue(1)
    const shown = useRef(on)
    // A pointer or Space press already stretched the thumb, so its release should not add a second stretch on top.
    const releasedAt = useRef(-Infinity)
    useEffect(() => {
        if (shown.current === on) return
        shown.current = on
        const fromPress = performance.now() - releasedAt.current < 250
        if (reduceMotion || fromPress || compact) return
        const controls = animate(scaleX, [1, 1.16, 1], {
            duration: 0.34,
            times: [0, 0.4, 1],
            ease: ['easeOut', 'easeInOut']
        })
        return () => controls.stop()
    }, [on, reduceMotion, scaleX, compact])
    const extra = pressed && !reduceMotion && !props.disabled && !compact ? stretch : 0
    const classes = [styles.switch, className].filter(Boolean).join(' ')

    return (
        <SwitchPrimitive.Root
            {...props}
            ref={ref}
            checked={on}
            onCheckedChange={(next) => {
                if (checked === undefined) setInternal(next)
                onCheckedChange?.(next)
            }}
            onPointerDown={(event) => {
                onPointerDown?.(event)
                keyboard.current = false
                if (event.button === 0) setPressed(true)
            }}
            onPointerUp={(event) => {
                onPointerUp?.(event)
                if (pressed && !props.disabled) releasedAt.current = performance.now()
                setPressed(false)
            }}
            onPointerLeave={(event) => {
                onPointerLeave?.(event)
                setPressed(false)
            }}
            onPointerCancel={(event) => {
                onPointerCancel?.(event)
                setPressed(false)
            }}
            onKeyDown={(event) => {
                onKeyDown?.(event)
                keyboard.current = true
                if (event.key === ' ') setPressed(true)
            }}
            onKeyUp={(event) => {
                onKeyUp?.(event)
                if (pressed && !props.disabled) releasedAt.current = performance.now()
                setPressed(false)
            }}
            onBlur={(event) => {
                onBlur?.(event)
                setPressed(false)
            }}
            className={classes}
            data-size={size}
            data-label-position={labelPosition}
            aria-label={props['aria-label'] ?? label}
        >
            {label && labelPosition === 'start' ? <span className={styles.label}>{label}</span> : null}
            <span className={styles.track}>
                {/* The thumb stretches like a held finger and keeps its far edge anchored, then travels on a spring. */}
                <motion.span
                    className={styles.thumb}
                    style={{ scaleX }}
                    initial={false}
                    animate={{ x: on ? travel - extra : 0, width: diameter + extra }}
                    transition={
                        reduceMotion || (compact && keyboard.current)
                            ? { duration: 0 }
                            : { x: glide, width: motionTokens.spring.snappy }
                    }
                />
            </span>
            {label && labelPosition === 'end' ? <span className={styles.label}>{label}</span> : null}
        </SwitchPrimitive.Root>
    )
})

Switch.displayName = 'Switch'

export default Switch
