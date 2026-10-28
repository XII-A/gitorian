'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useFocusScopeBranch } from '@radix-ui/react-focus-scope'
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'
import { X } from 'lucide-react'
import { motionTokens } from '../motion-tokens'
import type { CoordinatedSurface } from '../coordinated-surface'
import styles from './dialog.module.css'

/** Mirrors the open state so the content can stay mounted while it animates out, and retarget mid-flight if it is reopened or closed early. */
const OpenContext = createContext<boolean | null>(null)

export function Dialog({
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
    const [uncontrolled, setUncontrolled] = useState(defaultOpen)
    const open = openProp ?? uncontrolled
    const setOpen = useCallback(
        (next: boolean) => {
            if (openProp === undefined) setUncontrolled(next)
            onOpenChange?.(next)
        },
        [openProp, onOpenChange]
    )
    return (
        <OpenContext.Provider value={open}>
            <DialogPrimitive.Root {...props} open={open} onOpenChange={setOpen} />
        </OpenContext.Provider>
    )
}

export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    /** External controller owns mounting and transform; default motion is unchanged. */
    coordinatedMotion?: CoordinatedSurface
    title: string
    description?: string
    /** Optional activity context or status displayed above the title. */
    headerContent?: ReactNode
    children: ReactNode
    /** Dim large data views without repainting the whole page through a backdrop blur. */
    backdrop?: 'blur' | 'dim' | 'none'
    /** Content-only reader surfaces keep an accessible title without visible dialog controls. */
    hideHeader?: boolean
    /** Hide the close affordance when a decision must be submitted before leaving. */
    showCloseButton?: boolean
    /** Allow a portalled companion to share its parent modal focus and scroll boundary. */
    registerAsBranch?: boolean
    /** Use a horizontal entrance and exit for a reader beside another surface. */
    motionPreset?: 'scale' | 'slide-right'
}

const fade: Transition = { duration: motionTokens.duration.instant }
const leave: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] }

/** When the title or description changes while open, the new copy rises in and the old copy leaves upward. */
function SwapText({ text }: { text: string }) {
    const reduced = useReducedMotion()
    return (
        <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
                key={text}
                className={styles.swap}
                initial={reduced ? false : { opacity: 0, y: '0.3em', filter: `blur(${motionTokens.blur.soft}px)` }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={
                    reduced
                        ? { opacity: 0, transition: { duration: 0 } }
                        : {
                              opacity: 0,
                              y: '-0.3em',
                              filter: `blur(${motionTokens.blur.subtle}px)`,
                              transition: {
                                  duration: motionTokens.duration.fast,
                                  ease: [...motionTokens.ease.standard]
                              }
                          }
                }
                transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}
            >
                {text}
            </motion.span>
        </AnimatePresence>
    )
}

export function DialogContent({
    coordinatedMotion,
    registerAsBranch = false,
    title,
    description,
    headerContent,
    children,
    className,
    onPointerDownOutside,
    backdrop = 'blur',
    hideHeader = false,
    showCloseButton = true,
    motionPreset = 'scale',
    ...props
}: DialogContentProps) {
    const [branchNode, setBranchNode] = useState<HTMLDivElement | null>(null)
    useFocusScopeBranch(registerAsBranch ? branchNode : null)
    const coordinatedRef = coordinatedMotion?.ref
    const surfaceRef = useCallback(
        (node: HTMLDivElement | null) => {
            setBranchNode(node)
            if (typeof coordinatedRef === 'function') return coordinatedRef(node)
            if (coordinatedRef) coordinatedRef.current = node
        },
        [coordinatedRef]
    )
    const open = useContext(OpenContext)
    const reduced = useReducedMotion()
    // When the open state last changed. Radix waits for the click before treating a press as outside, and a press on the trigger
    // while the dialog leaves reopens it first, so that press must not close it again.
    const change = useRef({ open, at: 0 })
    useLayoutEffect(() => {
        change.current = { open, at: performance.now() }
    }, [open])
    const pressOutside: DialogContentProps['onPointerDownOutside'] = (event) => {
        onPointerDownOutside?.(event)
        if (open !== null && (!change.current.open || event.detail.originalEvent.timeStamp < change.current.at))
            event.preventDefault()
    }
    const classes = [styles.content, className].filter(Boolean).join(' ')
    const inner = (
        <>
            {hideHeader ? (
                <DialogPrimitive.Title className={styles.visuallyHidden}>{title}</DialogPrimitive.Title>
            ) : (
                <div className={styles.header} data-arc-dialog-header>
                    <div>
                        {headerContent ? <div className={styles.headerContent}>{headerContent}</div> : null}
                        <DialogPrimitive.Title className={styles.title}>
                            <SwapText text={title} />
                        </DialogPrimitive.Title>
                        {description ? (
                            <DialogPrimitive.Description className={styles.description}>
                                <SwapText text={description} />
                            </DialogPrimitive.Description>
                        ) : null}
                    </div>
                    {showCloseButton && (
                        <DialogPrimitive.Close className={styles.close} aria-label="Close dialog">
                            <X size={16} strokeWidth={1.75} aria-hidden="true" />
                        </DialogPrimitive.Close>
                    )}
                </div>
            )}
            <div className={styles.body} data-arc-dialog-body>
                {children}
            </div>
        </>
    )
    // Under a bare Radix root the open state is unknown here, so CSS keyframes keyed off data-state animate the layers instead.
    if (open === null)
        return (
            <DialogPrimitive.Portal>
                {backdrop !== 'none' && (
                    <DialogPrimitive.Overlay
                        data-arc-dialog-overlay
                        data-backdrop={backdrop}
                        className={`${styles.overlay} ${styles.keyframes}`}
                    />
                )}
                <DialogPrimitive.Content
                    {...props}
                    onPointerDownOutside={pressOutside}
                    className={`${classes} ${styles.keyframes}`}
                >
                    {inner}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        )
    if (coordinatedMotion) {
        return coordinatedMotion.present ? (
            <DialogPrimitive.Portal forceMount>
                <DialogPrimitive.Content {...props} onPointerDownOutside={pressOutside} forceMount asChild>
                    <div ref={surfaceRef} style={{ opacity: 0 }} className={classes}>
                        {inner}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        ) : null
    }

    // The overlay fades while the dialog rises 8px and scales up on a spring. Closing is shorter and quieter, and starts from wherever the entrance is.
    return (
        <AnimatePresence>
            {open && (
                <DialogPrimitive.Portal key="dialog" forceMount>
                    {backdrop !== 'none' && (
                        <DialogPrimitive.Overlay asChild forceMount>
                            <motion.div
                                data-arc-dialog-overlay
                                className={styles.overlay}
                                data-backdrop={backdrop}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, transition: reduced ? fade : leave }}
                                transition={
                                    reduced
                                        ? fade
                                        : {
                                              duration: motionTokens.duration.standard,
                                              ease: [...motionTokens.ease.enter]
                                          }
                                }
                            />
                        </DialogPrimitive.Overlay>
                    )}
                    <DialogPrimitive.Content {...props} onPointerDownOutside={pressOutside} asChild forceMount>
                        <motion.div
                            className={classes}
                            initial={
                                reduced
                                    ? { opacity: 0 }
                                    : motionPreset === 'slide-right'
                                      ? { opacity: 1, x: '100vw' }
                                      : { opacity: 0, y: 8, scale: 0.96 }
                            }
                            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                            exit={
                                reduced
                                    ? { opacity: 0, transition: fade }
                                    : motionPreset === 'slide-right'
                                      ? {
                                            x: '100vw',
                                            transition: {
                                                duration: motionTokens.duration.standard,
                                                ease: [...motionTokens.ease.standard]
                                            }
                                        }
                                      : { opacity: 0, y: 4, scale: 0.98, transition: leave }
                            }
                            transition={
                                reduced
                                    ? fade
                                    : {
                                          default: motionTokens.spring.smooth,
                                          opacity: {
                                              duration: motionTokens.duration.fast,
                                              ease: [...motionTokens.ease.enter]
                                          }
                                      }
                            }
                        >
                            {inner}
                        </motion.div>
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            )}
        </AnimatePresence>
    )
}
