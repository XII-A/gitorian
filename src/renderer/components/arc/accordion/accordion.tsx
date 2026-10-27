'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { TargetAndTransition, Variants } from 'motion/react'
import { motionTokens } from '../motion-tokens'
import styles from './accordion.module.css'

export interface AccordionItem {
    title: ReactNode
    content: ReactNode
}
export interface AccordionProps {
    items: AccordionItem[]
    defaultOpen?: number
    /** "lg" suits page-level FAQs: questions at the large text size, answers at body size. */
    size?: 'md' | 'lg'
    value?: string
    onValueChange?: (value: string) => void
    /** A borderless disclosure for structured content embedded in an existing surface. */
    variant?: 'default' | 'plain'
    triggerPosition?: 'before' | 'after'
    triggerProps?: ComponentPropsWithoutRef<'button'>
    className?: string
    /** Custom triggers include their own icon. */
    showIcon?: boolean
    instant?: boolean
    /** Follow the rendered panel height, for coordinated scroll during a disclosure. */
    onPanelHeightChange?: (height: number) => void
}

/** Height follows the content on a spring that never overshoots; closed panels leave the accessibility tree once they finish collapsing. */
const panelOpen: TargetAndTransition = { height: 'auto', opacity: 1, visibility: 'visible' }
const panelClosed: TargetAndTransition = { height: 0, opacity: 0, transitionEnd: { visibility: 'hidden' } }
/** The answer settles down into place with a brief focus pull as the panel opens. */
const contentOpen: TargetAndTransition = { y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }
const contentClosed: TargetAndTransition = { y: -6, filter: `blur(${motionTokens.blur.subtle}px)` }
const panelMotion: Variants = {
    open: {
        ...panelOpen,
        transition: {
            height: motionTokens.spring.smooth,
            opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
        }
    },
    closed: {
        ...panelClosed,
        transition: {
            height: motionTokens.spring.smooth,
            opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }
        }
    }
}
const contentMotion: Variants = {
    open: {
        ...contentOpen,
        transition: {
            y: motionTokens.spring.smooth,
            filter: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
        }
    },
    closed: {
        ...contentClosed,
        transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }
    }
}
/** Reduced motion: same end states in one step, so server and client render identical styles. */
const panelStill: Variants = {
    open: { ...panelOpen, transition: { duration: 0 } },
    closed: { ...panelClosed, transition: { duration: 0 } }
}
const contentStill: Variants = {
    open: { ...contentOpen, transition: { duration: 0 } },
    closed: { ...contentClosed, transition: { duration: 0 } }
}

/** Structured disclosures keep a measured numeric height. Resolving `auto` to zero
 * temporarily collapses a tall scroller while Motion measures its keyframes. */
function AccordionPanel({
    open,
    reduced,
    plain,
    children,
    onHeightChange
}: {
    open: boolean
    reduced: boolean
    plain: boolean
    children: ReactNode
    onHeightChange?: (height: number) => void
}) {
    const inner = useRef<HTMLDivElement>(null)
    const [height, setHeight] = useState<number | null>(null)
    useLayoutEffect(() => {
        if (!plain || !inner.current) return
        const measure = () => setHeight(inner.current?.getBoundingClientRect().height ?? 0)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(inner.current)
        return () => observer.disconnect()
    }, [plain, children])
    const variants: Variants =
        plain && height !== null
            ? {
                  open: {
                      ...panelOpen,
                      height,
                      transition: reduced
                          ? { duration: 0 }
                          : {
                                height: motionTokens.spring.smooth,
                                opacity: {
                                    duration: motionTokens.duration.standard,
                                    ease: [...motionTokens.ease.enter]
                                }
                            }
                  },
                  closed: reduced ? panelStill.closed : panelMotion.closed
              }
            : reduced
              ? panelStill
              : panelMotion
    return (
        <AccordionPrimitive.Content forceMount asChild>
            <motion.div
                inert={!open}
                className={styles.panel}
                initial={false}
                animate={open ? 'open' : 'closed'}
                variants={variants}
                onUpdate={(latest) => {
                    if (typeof latest.height === 'number') onHeightChange?.(latest.height)
                }}
            >
                <motion.div
                    ref={inner}
                    className={styles.panelInner}
                    variants={plain ? undefined : reduced ? contentStill : contentMotion}
                >
                    {children}
                </motion.div>
            </motion.div>
        </AccordionPrimitive.Content>
    )
}

export function Accordion({
    items,
    defaultOpen = 0,
    size = 'md',
    value,
    onValueChange,
    variant = 'default',
    triggerPosition = 'before',
    triggerProps,
    className,
    showIcon = true,
    instant = false,
    onPanelHeightChange
}: AccordionProps) {
    const initialValue = defaultOpen >= 0 && defaultOpen < items.length ? String(defaultOpen) : ''
    const [internalValue, setOpenValue] = useState(initialValue)
    const openValue = value ?? internalValue
    const reduced = useReducedMotion() || instant
    return (
        <AccordionPrimitive.Root
            className={[
                styles.accordion,
                size === 'lg' ? styles.lg : '',
                variant === 'plain' ? styles.plain : '',
                className
            ]
                .filter(Boolean)
                .join(' ')}
            data-trigger-position={triggerPosition}
            type="single"
            collapsible
            value={openValue}
            onValueChange={(next) => {
                setOpenValue(next)
                onValueChange?.(next)
            }}
        >
            {items.map((item, index) => {
                const open = openValue === String(index)
                const header = (
                    <AccordionPrimitive.Header className={styles.header}>
                        <AccordionPrimitive.Trigger
                            {...triggerProps}
                            className={[styles.trigger, triggerProps?.className].filter(Boolean).join(' ')}
                        >
                            {item.title}
                            {showIcon && (
                                <motion.span
                                    className={styles.icon}
                                    initial={false}
                                    animate={{ rotate: open ? 180 : 0 }}
                                    transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                                >
                                    <ChevronDown width={17} height={17} aria-hidden="true" />
                                </motion.span>
                            )}
                        </AccordionPrimitive.Trigger>
                    </AccordionPrimitive.Header>
                )
                const panel = (
                    <AccordionPanel
                        open={open}
                        reduced={!!reduced}
                        plain={variant === 'plain'}
                        onHeightChange={onPanelHeightChange}
                    >
                        {item.content}
                    </AccordionPanel>
                )
                return (
                    <AccordionPrimitive.Item className={styles.item} value={String(index)} key={index}>
                        {triggerPosition === 'before' && header}
                        {panel}
                        {triggerPosition === 'after' && header}
                    </AccordionPrimitive.Item>
                )
            })}
        </AccordionPrimitive.Root>
    )
}

export default Accordion
