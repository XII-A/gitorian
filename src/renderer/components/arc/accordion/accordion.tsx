'use client'

import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import type { TargetAndTransition, Variants } from 'motion/react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './accordion.module.css'

export interface AccordionItem {
    title: string
    content: ReactNode
}
export interface AccordionProps {
    items: AccordionItem[]
    defaultOpen?: number
    /** "lg" suits page-level FAQs: questions at the large text size, answers at body size. */
    size?: 'md' | 'lg'
}

/** Height follows the content on a spring that never overshoots; closed panels leave the accessibility tree once they finish collapsing. */
const panelOpen: TargetAndTransition = { height: 'auto', opacity: 1, visibility: 'visible' }
const panelClosed: TargetAndTransition = { height: 0, opacity: 0, transitionEnd: { visibility: 'hidden' } }
/** The answer settles down into place with a brief focus pull as the panel opens. */
const contentOpen: TargetAndTransition = { filter: 'blur(0px)', transitionEnd: { filter: 'none' }, y: 0 }
const contentClosed: TargetAndTransition = { filter: `blur(${motionTokens.blur.subtle}px)`, y: -6 }
const panelMotion: Variants = {
    closed: {
        ...panelClosed,
        transition: {
            height: motionTokens.spring.smooth,
            opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }
        }
    },
    open: {
        ...panelOpen,
        transition: {
            height: motionTokens.spring.smooth,
            opacity: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
        }
    }
}
const contentMotion: Variants = {
    closed: {
        ...contentClosed,
        transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }
    },
    open: {
        ...contentOpen,
        transition: {
            filter: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] },
            y: motionTokens.spring.smooth
        }
    }
}
/** Reduced motion: same end states in one step, so server and client render identical styles. */
const panelStill: Variants = {
    closed: { ...panelClosed, transition: { duration: 0 } },
    open: { ...panelOpen, transition: { duration: 0 } }
}
const contentStill: Variants = {
    closed: { ...contentClosed, transition: { duration: 0 } },
    open: { ...contentOpen, transition: { duration: 0 } }
}

export const Accordion = ({ items, defaultOpen = 0, size = 'md' }: AccordionProps) => {
    const initialValue = defaultOpen >= 0 && defaultOpen < items.length ? String(defaultOpen) : ''
    const [openValue, setOpenValue] = useState(initialValue)
    const reduced = useReducedMotion()
    return (
        <AccordionPrimitive.Root
            className={[styles.accordion, size === 'lg' ? styles.lg : ''].filter(Boolean).join(' ')}
            type="single"
            collapsible
            value={openValue}
            onValueChange={setOpenValue}
        >
            {items.map((item, index) => {
                const open = openValue === String(index)
                return (
                    <AccordionPrimitive.Item
                        className={styles.item}
                        value={String(index)}
                        key={`${item.title}-${index}`}
                    >
                        <AccordionPrimitive.Header className={styles.header}>
                            <AccordionPrimitive.Trigger className={styles.trigger}>
                                <span>{item.title}</span>
                                <motion.span
                                    className={styles.icon}
                                    initial={false}
                                    animate={{ rotate: open ? 180 : 0 }}
                                    transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}
                                >
                                    <ChevronDown width={17} height={17} aria-hidden="true" />
                                </motion.span>
                            </AccordionPrimitive.Trigger>
                        </AccordionPrimitive.Header>
                        {/* Radix keeps semantics and ids; motion owns the height so a toggle mid-flight retargets instead of restarting. */}
                        <AccordionPrimitive.Content forceMount asChild>
                            <motion.div
                                inert={!open}
                                className={styles.panel}
                                initial={false}
                                animate={open ? 'open' : 'closed'}
                                variants={reduced ? panelStill : panelMotion}
                            >
                                <motion.div
                                    className={styles.panelInner}
                                    variants={reduced ? contentStill : contentMotion}
                                >
                                    {item.content}
                                </motion.div>
                            </motion.div>
                        </AccordionPrimitive.Content>
                    </AccordionPrimitive.Item>
                )
            })}
        </AccordionPrimitive.Root>
    )
}

export default Accordion
