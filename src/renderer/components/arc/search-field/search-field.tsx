'use client'

import { Search, X as Xmark } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ForwardRefRenderFunction, InputHTMLAttributes } from 'react'
import { forwardRef, useId, useRef } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './search-field.module.css'

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label: string
    /** Keep the field's name available to assistive technology without a visible label. */
    hideLabel?: boolean
    value: string
    onValueChange: (value: string) => void
}
const SearchFieldRender: ForwardRefRenderFunction<HTMLInputElement, SearchFieldProps> = (
    { label, hideLabel = false, value, onValueChange, id, className, ...props },
    ref
) => {
    const generated = useId()
    const controlId = id ?? generated
    const reduced = useReducedMotion()
    const inputRef = useRef<HTMLInputElement | null>(null)
    const setRefs = (node: HTMLInputElement | null) => {
        inputRef.current = node
        if (typeof ref === 'function') {
            ref(node)
        } else if (ref) {
            ref.current = node
        }
    }
    // Clearing returns focus to the field, since the clear button unmounts under the pointer.
    const clear = () => {
        onValueChange('')
        inputRef.current?.focus()
    }
    return (
        <div className={styles.field}>
            <label htmlFor={controlId} className={hideLabel ? styles.srOnly : undefined}>
                {label}
            </label>
            <div className={styles.shell} data-filled={value ? 'true' : undefined}>
                <Search width={18} height={18} aria-hidden="true" />
                <input
                    {...props}
                    ref={setRefs}
                    id={controlId}
                    type="search"
                    value={value}
                    onChange={(event) => {
                        onValueChange(event.target.value)
                    }}
                    className={[styles.input, className].filter(Boolean).join(' ')}
                />
                {/* The clear button has a reserved slot, so the field never changes width when it appears or leaves. */}
                <span className={styles.clearSlot}>
                    <AnimatePresence initial={false}>
                        {value ? (
                            <motion.button
                                key="clear"
                                type="button"
                                tabIndex={0}
                                onClick={clear}
                                aria-label="Clear search"
                                initial={
                                    reduced
                                        ? { opacity: 0 }
                                        : { filter: `blur(${motionTokens.blur.subtle}px)`, opacity: 0, scale: 0.8 }
                                }
                                animate={{ filter: 'blur(0px)', opacity: 1, scale: 1 }}
                                exit={
                                    reduced
                                        ? { opacity: 0, transition: { duration: 0 } }
                                        : {
                                              filter: `blur(${motionTokens.blur.subtle}px)`,
                                              opacity: 0,
                                              scale: 0.8,
                                              transition: {
                                                  duration: motionTokens.duration.instant,
                                                  ease: [...motionTokens.ease.standard]
                                              }
                                          }
                                }
                                whileTap={
                                    reduced
                                        ? undefined
                                        : {
                                              scale: 0.96,
                                              transition: {
                                                  duration: motionTokens.duration.instant,
                                                  ease: [...motionTokens.ease.standard]
                                              }
                                          }
                                }
                                transition={
                                    reduced
                                        ? { duration: motionTokens.duration.instant }
                                        : {
                                              ...motionTokens.spring.snappy,
                                              filter: { duration: motionTokens.duration.fast },
                                              opacity: { duration: motionTokens.duration.fast }
                                          }
                                }
                            >
                                <Xmark width={16} height={16} aria-hidden="true" />
                            </motion.button>
                        ) : null}
                    </AnimatePresence>
                </span>
            </div>
        </div>
    )
}
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(SearchFieldRender)
