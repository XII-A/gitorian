'use client'

import { Folder } from 'lucide-react'
import type {
    AnimationPlaybackControls,
    HTMLMotionProps,
    MotionProps,
    TargetAndTransition,
    Transition
} from 'motion/react'
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { isValidElement, useEffect, useLayoutEffect, useRef } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './empty-state.module.css'

export interface EmptyStateProps {
    title: string
    description: string
    action?: ReactNode
    icon?: ReactNode
    /** Show a bare icon for borderless pane states. */
    iconVariant?: 'framed' | 'plain'
    className?: string
    /** Optional accessible label for the state region. */
    label?: string
}

const exitFast: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }
const textIn: TargetAndTransition = { filter: `blur(${motionTokens.blur.soft}px)`, opacity: 0, y: '0.3em' }
const textOut: TargetAndTransition = {
    filter: `blur(${motionTokens.blur.subtle}px)`,
    opacity: 0,
    transition: exitFast,
    y: '-0.3em'
}
const iconIn: TargetAndTransition = { filter: `blur(${motionTokens.blur.subtle}px)`, opacity: 0, scale: 0.6 }
const shown: TargetAndTransition = { filter: 'blur(0px)', opacity: 1, scale: 1, y: '0em' }
const fadeOut: TargetAndTransition = { opacity: 0, transition: { duration: motionTokens.duration.instant } }

/** Outgoing copies are hidden from assistive tech while they fade. */
const Swap = (props: HTMLMotionProps<'span'>) => {
    const present = useIsPresent()
    return <motion.span {...props} aria-hidden={present ? props['aria-hidden'] : true} />
}

/** A new icon component crossfades in; re-rendering the same icon stays still. */
const iconKey = (icon: ReactNode) => {
    if (!isValidElement(icon)) {
        return 'icon'
    }
    const type = icon.type as string | { displayName?: string; name?: string }
    return typeof type === 'string' ? type : (type.displayName ?? type.name ?? 'icon')
}

/** Follows its content height. After `morphKey` changes, the height springs from the old size to the new one and then returns to auto, so passive reflows (a resize, a font swap) follow instantly. It clips only while moving, so focus rings stay visible at rest. */
const HeightFrame = ({
    reduce,
    morphKey,
    children
}: {
    reduce: boolean | null
    morphKey: string
    children: ReactNode
}) => {
    const frame = useRef<HTMLDivElement>(null)
    const content = useRef<HTMLDivElement>(null)
    const height = useMotionValue<number | 'auto'>('auto')
    const changedAt = useRef(0)
    const previousMorphKey = useRef(morphKey)
    useLayoutEffect(() => {
        if (previousMorphKey.current !== morphKey) {
            changedAt.current = performance.now()
            previousMorphKey.current = morphKey
        }
    }, [morphKey])
    useEffect(() => {
        const node = content.current
        if (!node || typeof ResizeObserver === 'undefined') {
            return
        }
        let last: number | undefined
        let controls: AnimationPlaybackControls | undefined
        const settle = () => {
            height.jump('auto')
            if (frame.current) {
                Object.assign(frame.current.style, { height: 'auto', overflow: '' })
            }
        }
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) {
                return
            }
            const next = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight
            const current = height.get()
            const from = typeof current === 'number' ? current : last
            last = next
            controls?.stop()
            if (reduce || from === undefined || from === next || performance.now() - changedAt.current > 120) {
                settle()
                return
            }
            // Pin the old height before this frame paints, then spring to the new one.
            if (frame.current) {
                Object.assign(frame.current.style, { height: `${from}px`, overflow: 'hidden' })
            }
            controls = animate(height, [from, next], { ...motionTokens.spring.smooth, onComplete: settle })
        })
        observer.observe(node)
        return () => {
            observer.disconnect()
            controls?.stop()
        }
    }, [height, reduce])
    return (
        <motion.div ref={frame} className={styles.frame} style={{ height }}>
            <div ref={content} className={styles.copy}>
                {children}
            </div>
        </motion.div>
    )
}

export const EmptyState = ({
    title,
    description,
    action,
    icon,
    iconVariant = 'framed',
    className,
    label
}: EmptyStateProps) => {
    const reduce = useReducedMotion()
    const glyph = icon ?? <Folder width={24} height={24} strokeWidth={1.5} />
    const enter: Transition = reduce
        ? { duration: motionTokens.duration.instant }
        : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
    const swap: MotionProps = {
        animate: shown,
        exit: reduce ? fadeOut : textOut,
        initial: reduce ? { opacity: 0 } : textIn,
        transition: enter
    }
    // The result of an action morphs in place: the icon crossfades and the copy rises in while the old copy leaves.
    return (
        <section className={[styles.root, className].filter(Boolean).join(' ')} aria-label={label}>
            <div className={styles.icon} data-variant={iconVariant} aria-hidden="true">
                <AnimatePresence mode="popLayout" initial={false}>
                    <Swap
                        key={iconKey(glyph)}
                        className={styles.glyph}
                        initial={reduce ? { opacity: 0 } : iconIn}
                        animate={shown}
                        exit={reduce ? fadeOut : { ...iconIn, transition: exitFast }}
                        transition={reduce ? enter : motionTokens.spring.snappy}
                    >
                        {glyph}
                    </Swap>
                </AnimatePresence>
            </div>
            <HeightFrame reduce={reduce} morphKey={`${title}\n${description}`}>
                <h3>
                    <AnimatePresence mode="popLayout" initial={false}>
                        <Swap key={title} className={styles.line} {...swap}>
                            {title}
                        </Swap>
                    </AnimatePresence>
                </h3>
                <p>
                    <AnimatePresence mode="popLayout" initial={false}>
                        <Swap key={description} className={styles.line} {...swap}>
                            {description}
                        </Swap>
                    </AnimatePresence>
                </p>
            </HeightFrame>
            {action && <div className={styles.action}>{action}</div>}
        </section>
    )
}

export default EmptyState
