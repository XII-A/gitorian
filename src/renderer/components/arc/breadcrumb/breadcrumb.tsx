'use client'

import { CaretRightIcon as NavArrowRight } from '@phosphor-icons/react/dist/csr/CaretRight'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { MouseEvent } from 'react'

import { ArcLink } from '../lib/arc-provider'
import { motionTokens } from '../lib/motion-tokens'

import styles from './breadcrumb.module.css'

export interface BreadcrumbItem {
    label: string
    href?: string
    /** Runs when the crumb is chosen. Without an href the crumb renders as a button, for paths that live in local state. */
    onClick?: (event: MouseEvent<HTMLElement>) => void
}
export interface BreadcrumbProps {
    items: BreadcrumbItem[]
    ariaLabel?: string
}
/** Crumbs present on first render stay still; crumbs added later slide in from the path before them. */
export const Breadcrumb = ({ items, ariaLabel = 'Breadcrumb' }: BreadcrumbProps) => {
    const reduced = useReducedMotion() ?? false
    const still = { duration: 0 }
    const path = items.map((item) => item.label).join('/')
    return (
        <nav aria-label={ariaLabel}>
            <ol className={styles.list}>
                <AnimatePresence mode="popLayout" initial={false}>
                    {items.map((item, index) => {
                        const current = index === items.length - 1
                        return (
                            <motion.li
                                key={`${item.label}-${index}`}
                                layout={reduced ? false : 'position'}
                                layoutDependency={path}
                                initial={
                                    reduced
                                        ? false
                                        : { filter: `blur(${motionTokens.blur.subtle}px)`, opacity: 0, x: -8 }
                                }
                                animate={{ filter: 'blur(0px)', opacity: 1, x: 0 }}
                                exit={
                                    reduced
                                        ? { opacity: 0, transition: still }
                                        : {
                                              filter: `blur(${motionTokens.blur.subtle}px)`,
                                              opacity: 0,
                                              transition: {
                                                  duration: motionTokens.duration.instant,
                                                  ease: [...motionTokens.ease.standard]
                                              },
                                              x: -4
                                          }
                                }
                                transition={
                                    reduced
                                        ? still
                                        : {
                                              duration: motionTokens.duration.standard,
                                              ease: [...motionTokens.ease.enter],
                                              layout: motionTokens.spring.smooth
                                          }
                                }
                            >
                                {index > 0 && <NavArrowRight weight="bold" width={14} height={14} aria-hidden="true" />}
                                {(() => {
                                    if (!current && item.href) {
                                        return (
                                            <ArcLink href={item.href} data-label={item.label} onClick={item.onClick}>
                                                {item.label}
                                            </ArcLink>
                                        )
                                    }
                                    if (!current && item.onClick) {
                                        return (
                                            <button type="button" data-label={item.label} onClick={item.onClick}>
                                                {item.label}
                                            </button>
                                        )
                                    }
                                    return (
                                        <span aria-current={current ? 'page' : undefined} data-label={item.label}>
                                            {item.label}
                                        </span>
                                    )
                                })()}
                            </motion.li>
                        )
                    })}
                </AnimatePresence>
            </ol>
        </nav>
    )
}
