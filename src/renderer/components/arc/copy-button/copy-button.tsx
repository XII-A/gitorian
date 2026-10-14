'use client'

import { CircleAlert, Copy } from 'lucide-react'
import type { TargetAndTransition, Transition } from 'motion/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'
import { useCopyFeedback } from '../lib/use-copy-feedback'

import styles from './copy-button.module.css'

export interface CopyButtonProps {
    value: string
    label?: string
    className?: string
    iconOnly?: boolean
    variant?: 'outline' | 'plain'
    disabled?: boolean
    onCopied?: () => void
}

/** Copy feedback is deliberately unhurried: a slow, almost critically damped spring and long, soft crossfades read as calm, never busy.
 *  The same motion plays in reverse when the confirmation hands back to idle, so nothing ever snaps. */
const settle = { bounce: 0, type: 'spring', visualDuration: 0.5 } as const
const enter = { duration: 0.36, ease: [...motionTokens.ease.enter] } as const
const leave = { duration: 0.2, ease: [...motionTokens.ease.standard] } as const
const instant = { duration: motionTokens.duration.instant } as const
const soft = `blur(${motionTokens.blur.soft}px)`
const rest: TargetAndTransition = { filter: 'blur(0px)', opacity: 1, scale: 1, y: 0 }
const fadeIn: TargetAndTransition = { ...rest, opacity: 0 }
const fadeOut: TargetAndTransition = { opacity: 0, transition: instant }
/** Icons trade places in one soft breath: the old glyph shrinks into a blur while the new one grows out of it on the slow spring. */
const iconTransition: Transition = { bounce: 0, duration: 0.3, type: 'spring' }
const iconIn: TargetAndTransition = { filter: soft, opacity: 0, scale: 0.25 }
const iconOut: TargetAndTransition = {
    filter: soft,
    opacity: 0,
    scale: 0.25,
    transition: iconTransition
}
const iconEnter: Transition = iconTransition
/** Letters rise about .3em out of a soft blur; the outgoing ones lift away a little faster. */
const glyphIn: TargetAndTransition = { filter: soft, opacity: 0, y: 4 }
const glyphOut: TargetAndTransition = { filter: soft, opacity: 0, transition: leave, y: -3 }

/** The success tick draws itself from its short stroke, the way a hand would write it: quick to start, then easing into place while the icon settles. */
const DrawnCheck = ({ reduced }: { reduced: boolean }) => (
    <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <motion.path
            d="M4 12l5 5L20 6"
            initial={reduced ? false : { opacity: 0, pathLength: 0 }}
            animate={{ opacity: 1, pathLength: 1 }}
            transition={{
                opacity: { delay: 0.05, duration: 0.01 },
                pathLength: { delay: 0.05, duration: 0.5, ease: [...motionTokens.ease.standard] }
            }}
        />
    </svg>
)

interface Glyph {
    id: string
    char: string
    order: number
}
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
const characters = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment)
const toGlyphs = (chars: string[], seq: number): Glyph[] =>
    chars.map((char, order) => ({ char, id: `${seq}:${order}`, order }))

/** Shared leading and trailing characters keep their identity, so "Copy" to "Copied" only replaces the changed letters. */
const useGlyphs = (text: string) => {
    const [state, setState] = useState(() => ({ glyphs: toGlyphs(characters(text), 0), seq: 0, text }))
    if (state.text === text) {
        return state.glyphs
    }
    const prev = characters(state.text)
    const next = characters(text)
    let end = 0
    let start = 0
    while (start < prev.length && start < next.length && prev[start] === next[start]) {
        start += 1
    }
    while (
        end < prev.length - start &&
        end < next.length - start &&
        prev[prev.length - 1 - end] === next[next.length - 1 - end]
    ) {
        end += 1
    }
    if (start < 2) {
        start = 0
    }
    if (end < 2) {
        end = 0
    }
    const seq = state.seq + 1
    const glyphs = [
        ...state.glyphs.slice(0, start),
        ...toGlyphs(next.slice(start, next.length - end), seq),
        ...state.glyphs.slice(state.glyphs.length - end)
    ]
    setState({ glyphs, seq, text })
    return glyphs
}

/**
 * The label cell already reserves its widest state, so the row stays put and only the letters move. It is a layout root:
 * the letters measure their glide inside the label only, so when the button itself moves (a page entering, a panel
 * sliding, a list reflowing) they ride along instead of flying in from where the button used to be.
 */
const MorphText = ({ text, reduced }: { text: string; reduced: boolean }) => {
    const glyphs = useGlyphs(text)
    return (
        <motion.span className={styles.glyphs} layoutRoot>
            <AnimatePresence mode="popLayout" initial={false}>
                {glyphs.map((glyph) => (
                    <motion.span
                        key={glyph.id}
                        className={styles.glyph}
                        layout={reduced ? false : 'position'}
                        layoutDependency={text}
                        initial={reduced ? fadeIn : glyphIn}
                        animate={rest}
                        exit={reduced ? fadeOut : glyphOut}
                        transition={
                            reduced ? instant : { ...enter, delay: Math.min(glyph.order * 0.02, 0.12), layout: settle }
                        }
                    >
                        {glyph.char}
                    </motion.span>
                ))}
            </AnimatePresence>
        </motion.span>
    )
}

export const CopyButton = ({
    value,
    label = 'Copy',
    className,
    iconOnly = false,
    variant = 'outline',
    disabled,
    onCopied
}: CopyButtonProps) => {
    const { state, copy } = useCopyFeedback()
    const reduced = useReducedMotion() ?? false
    const text = (() => {
        if (state === 'copied') {
            return 'Copied'
        }
        if (state === 'error') {
            return 'Failed'
        }
        return label
    })()

    const handleCopy = async () => {
        if (await copy(value)) {
            onCopied?.()
        }
    }

    return (
        <>
            <button
                type="button"
                className={[styles.button, iconOnly && styles.iconOnly, variant === 'plain' && styles.plain, className]
                    .filter(Boolean)
                    .join(' ')}
                onClick={() => {
                    handleCopy()
                }}
                aria-label={label}
                data-copy-state={state}
                disabled={disabled}
            >
                <span className={styles.icon} aria-hidden="true">
                    <AnimatePresence initial={false}>
                        <motion.span
                            key={state}
                            className={styles.iconInner}
                            data-state={state}
                            initial={reduced ? fadeIn : iconIn}
                            animate={rest}
                            exit={reduced ? fadeOut : iconOut}
                            transition={reduced ? instant : iconEnter}
                        >
                            {(() => {
                                if (state === 'copied') {
                                    return <DrawnCheck reduced={reduced} />
                                }
                                if (state === 'error') {
                                    return <CircleAlert size={16} strokeWidth={1.75} />
                                }
                                return <Copy size={16} strokeWidth={1.75} />
                            })()}
                        </motion.span>
                    </AnimatePresence>
                </span>
                {!iconOnly && (
                    <span className={styles.label} aria-hidden="true">
                        <span className={styles.measure}>{label}</span>
                        <span className={styles.measure}>Copied</span>
                        <span className={styles.measure}>Failed</span>
                        <MorphText text={text} reduced={reduced} />
                    </span>
                )}
            </button>
            <span className={styles.srOnly} role="status" aria-live="polite">
                {(() => {
                    if (state === 'idle') {
                        return ''
                    }
                    if (state === 'error') {
                        return `${label}: Could not copy`
                    }
                    return `${label}: Copied`
                })()}
            </span>
        </>
    )
}
