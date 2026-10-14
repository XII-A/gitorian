'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ForwardRefRenderFunction, InputHTMLAttributes } from 'react'
import { forwardRef, useEffect, useId, useRef, useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './input.module.css'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label: string
    description?: string
    error?: string
}

/* Digits roll up when a number grows and down when it shrinks; `custom` hands the latest direction to digits already leaving. */
const digit = {
    center: { filter: 'blur(0px)', opacity: 1, y: 0 },
    enter: (direction: number) => ({
        filter: `blur(${motionTokens.blur.subtle}px)`,
        opacity: 0,
        y: `${direction * 0.6}em`
    }),
    exit: (direction: number) => ({
        filter: `blur(${motionTokens.blur.subtle}px)`,
        opacity: 0,
        y: `${direction * -0.6}em`
    })
}
const isNumber = (word: string) => /^\d[\d.,/:]*%?$/u.test(word)

/** A count in the copy, such as "12 characters", rolls only the digits that changed; a gained or lost digit opens or closes its width. */
const RollingNumber = ({ word }: { word: string }) => {
    const reduced = useReducedMotion()
    const [shown, setShown] = useState({ direction: 1, word })
    if (shown.word !== word) {
        setShown({
            direction: Number(word.replaceAll(',', '')) < Number(shown.word.replaceAll(',', '')) ? -1 : 1,
            word
        })
    }
    const characters = word.split('')
    const transition = reduced
        ? { duration: 0 }
        : {
              filter: { duration: motionTokens.duration.fast },
              opacity: { duration: motionTokens.duration.fast },
              width: motionTokens.spring.morph,
              y: motionTokens.spring.snappy
          }
    return (
        <AnimatePresence initial={false}>
            {characters.map((character, index) => (
                <motion.span
                    key={characters.length - index}
                    className={styles.column}
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={transition}
                >
                    <AnimatePresence initial={false} mode="popLayout" custom={shown.direction}>
                        <motion.span
                            key={character}
                            custom={shown.direction}
                            variants={digit}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={transition}
                        >
                            {character}
                        </motion.span>
                    </AnimatePresence>
                </motion.span>
            ))}
        </AnimatePresence>
    )
}

/** Changed words rise in and unblur while unchanged words hold still, and numbers roll. Assistive tech reads the plain copy. */
const MotionText = ({ text }: { text: string }) => {
    const reduced = useReducedMotion()
    const words = text.split(' ')
    return (
        <>
            <span className={styles.srOnly}>{text}</span>
            <span className={styles.words} aria-hidden="true">
                <AnimatePresence initial={false} mode="popLayout">
                    {words.map((word, index) => (
                        <motion.span
                            key={`${index}:${isNumber(word) ? '#' : word}`}
                            className={styles.word}
                            initial={
                                reduced
                                    ? { opacity: 0 }
                                    : { filter: `blur(${motionTokens.blur.soft}px)`, opacity: 0, y: '0.35em' }
                            }
                            animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                            exit={
                                reduced
                                    ? { opacity: 0, transition: { duration: 0 } }
                                    : {
                                          filter: `blur(${motionTokens.blur.subtle}px)`,
                                          opacity: 0,
                                          transition: {
                                              duration: motionTokens.duration.exit,
                                              ease: [...motionTokens.ease.standard]
                                          },
                                          y: '-0.35em'
                                      }
                            }
                            transition={
                                reduced
                                    ? { duration: motionTokens.duration.instant }
                                    : { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
                            }
                        >
                            {isNumber(word) ? <RollingNumber word={word} /> : word}
                            {index < words.length - 1 ? ' ' : null}
                        </motion.span>
                    ))}
                </AnimatePresence>
            </span>
        </>
    )
}

/** Helper and error copy: the row opens its height on a spring, then the words settle in. */
const MessageRow = ({
    id,
    text,
    className,
    alert
}: {
    id?: string
    text: string
    className: string
    alert?: boolean
}) => {
    const reduced = useReducedMotion()
    const copyRef = useRef<HTMLSpanElement>(null)
    const [height, setHeight] = useState<number | 'auto'>('auto')
    useEffect(() => {
        const node = copyRef.current
        if (!node || typeof ResizeObserver === 'undefined') {
            return
        }
        const observer = new ResizeObserver(([entry]) => {
            setHeight(entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight)
        })
        observer.observe(node)
        return () => {
            observer.disconnect()
        }
    }, [])
    // Reduced motion mounts the row at full height: a zero-duration open would still paint one collapsed frame. The presence starts
    // with initial={false}, so rows present at hydration render the same on server and client either way.
    return (
        <motion.span
            className={styles.messageSlot}
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height, opacity: 1 }}
            exit={{
                height: 0,
                opacity: 0,
                transition: reduced
                    ? { duration: 0 }
                    : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.instant } }
            }}
            transition={
                reduced
                    ? { duration: 0 }
                    : { height: motionTokens.spring.smooth, opacity: { duration: motionTokens.duration.fast } }
            }
        >
            <motion.span
                ref={copyRef}
                id={id}
                className={className}
                role={alert ? 'alert' : undefined}
                initial={reduced ? false : { filter: `blur(${motionTokens.blur.soft}px)`, y: '0.35em' }}
                animate={{ filter: 'blur(0px)', y: 0 }}
                transition={{
                    duration: reduced ? 0 : motionTokens.duration.standard,
                    ease: [...motionTokens.ease.enter]
                }}
            >
                <MotionText text={text} />
            </motion.span>
        </motion.span>
    )
}

const FieldMessage = ({
    id,
    text,
    className,
    alert
}: {
    id?: string
    text?: string
    className: string
    alert?: boolean
}) => (
    <AnimatePresence initial={false}>
        {text ? <MessageRow key="message" id={id} text={text} className={className} alert={alert} /> : null}
    </AnimatePresence>
)

/** The row tracks the measured copy, so a longer message that wraps opens its next line instead of snapping. */

const InputRender: ForwardRefRenderFunction<HTMLInputElement, InputProps> = (
    { label, description, error, id, className, ...props },
    ref
) => {
    const generatedId = useId()
    const controlId = id ?? generatedId
    const hintId = description ? `${controlId}-description` : undefined
    const errorId = error ? `${controlId}-error` : undefined
    const describedBy = [props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined
    return (
        <div className={styles.field}>
            <label className={styles.label} htmlFor={controlId}>
                {label}
            </label>
            <input
                {...props}
                id={controlId}
                ref={ref}
                className={[styles.input, className].filter(Boolean).join(' ')}
                aria-invalid={error ? true : props['aria-invalid']}
                aria-describedby={describedBy}
            />
            <FieldMessage id={hintId} text={description} className={styles.description} />
            <FieldMessage id={errorId} text={error} className={styles.error} alert />
        </div>
    )
}
export const Input = forwardRef<HTMLInputElement, InputProps>(InputRender)

Input.displayName = 'Input'
