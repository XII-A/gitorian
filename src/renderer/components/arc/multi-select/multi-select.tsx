'use client'

import { ChevronDown, X } from 'lucide-react'
import type { Variants } from 'motion/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover'
import { ScrollArea } from '../scroll-area/scroll-area'

import styles from './multi-select.module.css'

const defaultDefaultValue: never[] = []

export interface MultiSelectOption {
    value: string
    label: string
    disabled?: boolean
}

export interface MultiSelectProps {
    label: string
    options: MultiSelectOption[]
    value?: string[]
    defaultValue?: string[]
    onValueChange?: (value: string[]) => void
    placeholder?: string
    description?: string
    maxVisible?: number
    disabled?: boolean
    className?: string
    /** Allow selected chips to wrap across lines inside a settings field. */
    wrapValues?: boolean
}

const { enter } = motionTokens.ease
const { standard } = motionTokens.ease
/** Each chip sits in a slot whose width opens and collapses on a spring, so neighbours travel with it and nothing overlaps. */
const slot: Variants = {
    gone: {
        opacity: 0,
        transition: {
            opacity: { duration: motionTokens.duration.instant, ease: standard },
            width: motionTokens.spring.smooth
        },
        width: 0
    },
    hidden: { opacity: 0, width: 0 },
    shown: {
        opacity: 1,
        transition: {
            opacity: { duration: motionTokens.duration.fast, ease: enter },
            width: motionTokens.spring.smooth
        },
        width: 'auto'
    }
}
/** The chip itself grows in from .9 with a soft blur and shrinks back as it leaves. */
const chip: Variants = {
    gone: {
        filter: `blur(${motionTokens.blur.subtle}px)`,
        scale: 0.9,
        transition: { duration: motionTokens.duration.instant, ease: standard }
    },
    hidden: { filter: `blur(${motionTokens.blur.soft}px)`, scale: 0.9 },
    shown: {
        filter: 'blur(0px)',
        scale: 1,
        transition: { ...motionTokens.spring.snappy, filter: { duration: motionTokens.duration.standard, ease: enter } }
    }
}
/** Reduced motion keeps short crossfades; resting states match the moving variants so server and client markup agree. */
const fade: Variants = {
    gone: { opacity: 0, transition: { duration: motionTokens.duration.instant } },
    hidden: { opacity: 0 },
    shown: { filter: 'blur(0px)', opacity: 1, transition: { duration: motionTokens.duration.instant }, y: 0 }
}
const slotFade: Variants = {
    gone: { opacity: 0, transition: { duration: motionTokens.duration.instant } },
    hidden: { opacity: 0 },
    shown: { opacity: 1, transition: { duration: motionTokens.duration.instant }, width: 'auto' }
}
const chipStill: Variants = {
    gone: { filter: 'blur(0px)', scale: 1 },
    hidden: { filter: 'blur(0px)', scale: 1 },
    shown: { filter: 'blur(0px)', scale: 1 }
}
/** The overflow count rolls: a larger number rises from below, a smaller one drops from above. */
const roll: Variants = {
    gone: (direction: number) => ({
        filter: `blur(${motionTokens.blur.subtle}px)`,
        opacity: 0,
        transition: { duration: motionTokens.duration.instant, ease: standard },
        y: `${direction * -0.5}em`
    }),
    hidden: (direction: number) => ({
        filter: `blur(${motionTokens.blur.subtle}px)`,
        opacity: 0,
        y: `${direction * 0.5}em`
    }),
    shown: {
        filter: 'blur(0px)',
        opacity: 1,
        transition: { duration: motionTokens.duration.standard, ease: enter },
        y: 0
    }
}

/** A check that draws itself when an option is picked and retracts when it is removed. */
const CheckMark = ({ reduce }: { reduce: boolean | null }) => (
    <svg
        className={styles.check}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <motion.path
            d="M4 12.5 9 17.5 20 6.5"
            initial={reduce ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
            animate={{ opacity: 1, pathLength: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
            transition={
                reduce
                    ? { duration: motionTokens.duration.instant }
                    : {
                          opacity: { duration: motionTokens.duration.instant },
                          pathLength: { duration: motionTokens.duration.standard, ease: enter }
                      }
            }
        />
    </svg>
)

export const MultiSelect = ({
    label,
    options,
    value,
    defaultValue = defaultDefaultValue,
    onValueChange,
    placeholder = 'Select options',
    description,
    maxVisible = 2,
    disabled = false,
    className,
    wrapValues = false
}: MultiSelectProps) => {
    const id = useId()
    const labelId = `${id}-label`
    const valueId = `${id}-value`
    const rootRef = useRef<HTMLDivElement>(null)
    const [internal, setInternal] = useState(defaultValue)
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)
    const selected = value ?? internal
    const selectedSet = useMemo(() => new Set(selected), [selected])
    const labelFor = (item: string) => options.find((option) => option.value === item)?.label ?? item
    const visible = selected.slice(0, maxVisible).map((item) => ({ label: labelFor(item), value: item }))
    const remaining = Math.max(0, selected.length - visible.length)
    // A closed menu forgets its highlight, so the next open starts clean instead of on a stale hovered row.
    const [wasOpen, setWasOpen] = useState(open)
    if (wasOpen !== open) {
        setWasOpen(open)
        if (!open) {
            setActiveIndex(-1)
        }
    }
    const [previousRemaining, setPreviousRemaining] = useState(remaining)
    const [countDirection, setCountDirection] = useState(1)
    if (previousRemaining !== remaining) {
        setPreviousRemaining(remaining)
        setCountDirection(remaining > previousRemaining ? 1 : -1)
    }

    const update = (next: string[]) => {
        if (value === undefined) {
            setInternal(next)
        }
        onValueChange?.(next)
    }
    const toggle = (option: MultiSelectOption) => {
        if (disabled || option.disabled) {
            return
        }
        update(
            selectedSet.has(option.value)
                ? selected.filter((item) => item !== option.value)
                : [...selected, option.value]
        )
    }
    const clear = () => {
        update([])
        setOpen(false)
    }
    const enabled = options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0)
    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled) {
            return
        }
        if ((event.key === 'Enter' || event.key === ' ') && open && activeIndex >= 0) {
            event.preventDefault()
            toggle(options[activeIndex])
            return
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen((current) => !current)
            return
        }
        if (event.key === 'Escape' && open) {
            event.stopPropagation()
            setOpen(false)
            return
        }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && enabled.length) {
            event.preventDefault()
            setOpen(true)
            const current = enabled.indexOf(activeIndex)
            const next = (() => {
                if (current === -1) {
                    if (event.key === 'ArrowDown') {
                        return 0
                    }
                    return enabled.length - 1
                }
                if (event.key === 'ArrowDown') {
                    return (current + 1) % enabled.length
                }
                return (current - 1 + enabled.length) % enabled.length
            })()
            setActiveIndex(enabled[next])
        }
    }
    const reduce = useReducedMotion()
    useEffect(() => {
        if (open && activeIndex >= 0) {
            document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
        }
    }, [open, activeIndex, id])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <div
                ref={rootRef}
                className={[styles.field, className].filter(Boolean).join(' ')}
                data-wrap={wrapValues || undefined}
            >
                <span id={labelId} className={styles.label}>
                    {label}
                </span>
                <div className={styles.control}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            role="combobox"
                            className={`${styles.trigger} ${selected.length ? styles.hasClear : ''}`}
                            disabled={disabled}
                            aria-labelledby={`${labelId} ${valueId}`}
                            aria-haspopup="listbox"
                            aria-expanded={open}
                            aria-controls={`${id}-listbox`}
                            aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
                            onKeyDown={onKeyDown}
                        >
                            <span id={valueId} className={styles.srOnly}>
                                {selected.length ? selected.map(labelFor).join(', ') : placeholder}
                            </span>
                            <span className={styles.value} aria-hidden="true">
                                <AnimatePresence initial={false}>
                                    {visible.map((item) => (
                                        <motion.span
                                            key={`chip-${item.value}`}
                                            className={styles.slot}
                                            variants={reduce ? slotFade : slot}
                                            initial="hidden"
                                            animate="shown"
                                            exit="gone"
                                        >
                                            <motion.span
                                                className={styles.chip}
                                                title={item.label}
                                                variants={reduce ? chipStill : chip}
                                            >
                                                {item.label}
                                            </motion.span>
                                        </motion.span>
                                    ))}
                                    {remaining > 0 && (
                                        <motion.span
                                            key="more"
                                            className={styles.slot}
                                            variants={reduce ? slotFade : slot}
                                            initial="hidden"
                                            animate="shown"
                                            exit="gone"
                                        >
                                            <motion.span className={styles.more} variants={reduce ? chipStill : chip}>
                                                +
                                                <span className={styles.count}>
                                                    <AnimatePresence initial={false} custom={countDirection}>
                                                        <motion.span
                                                            key={remaining}
                                                            custom={countDirection}
                                                            variants={reduce ? fade : roll}
                                                            initial="hidden"
                                                            animate="shown"
                                                            exit="gone"
                                                        >
                                                            {remaining}
                                                        </motion.span>
                                                    </AnimatePresence>
                                                </span>
                                            </motion.span>
                                        </motion.span>
                                    )}
                                    {!selected.length && (
                                        <motion.span
                                            key="placeholder"
                                            className={styles.placeholder}
                                            variants={fade}
                                            initial="hidden"
                                            animate="shown"
                                            exit="gone"
                                        >
                                            {placeholder}
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                            </span>
                            <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
                        </button>
                    </PopoverTrigger>
                    <AnimatePresence initial={false}>
                        {selected.length > 0 && !disabled && (
                            <motion.button
                                type="button"
                                aria-label="Clear selections"
                                className={styles.clear}
                                onClick={clear}
                                initial={
                                    reduce
                                        ? { opacity: 0 }
                                        : { filter: `blur(${motionTokens.blur.subtle}px)`, opacity: 0, scale: 0.6 }
                                }
                                animate={{
                                    filter: 'blur(0px)',
                                    opacity: 1,
                                    scale: 1,
                                    transition: reduce
                                        ? { duration: motionTokens.duration.instant }
                                        : {
                                              ...motionTokens.spring.snappy,
                                              opacity: { duration: motionTokens.duration.fast }
                                          }
                                }}
                                exit={{
                                    opacity: 0,
                                    ...(reduce ? {} : { filter: `blur(${motionTokens.blur.subtle}px)`, scale: 0.6 }),
                                    transition: { duration: motionTokens.duration.instant, ease: standard }
                                }}
                                whileTap={{
                                    scale: reduce ? 1 : 0.96,
                                    transition: { duration: motionTokens.duration.instant, ease: standard }
                                }}
                            >
                                <X size={14} aria-hidden="true" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                    <AnimatePresence initial={false}>
                        {open && (
                            <PopoverContent
                                asChild
                                forceMount
                                onOpenAutoFocus={(event) => {
                                    event.preventDefault()
                                }}
                            >
                                <motion.div
                                    id={`${id}-listbox`}
                                    className={styles.menu}
                                    role="listbox"
                                    aria-label={label}
                                    aria-multiselectable="true"
                                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
                                    animate={{
                                        opacity: 1,
                                        scale: 1,
                                        transition: reduce
                                            ? { duration: motionTokens.duration.instant }
                                            : {
                                                  ...motionTokens.spring.snappy,
                                                  opacity: { duration: motionTokens.duration.fast, ease: enter }
                                              },
                                        y: 0
                                    }}
                                    exit={{
                                        opacity: 0,
                                        ...(reduce ? {} : { scale: 0.98, y: -4 }),
                                        transition: { duration: motionTokens.duration.instant, ease: standard }
                                    }}
                                >
                                    <ScrollArea
                                        label={`${label} options`}
                                        maxHeight="min(240px, calc(var(--radix-popover-content-available-height) - 12px))"
                                        fade={12}
                                    >
                                        {options.map((option, index) => (
                                            <button
                                                id={`${id}-option-${index}`}
                                                type="button"
                                                role="option"
                                                aria-selected={selectedSet.has(option.value)}
                                                aria-disabled={option.disabled || undefined}
                                                key={option.value}
                                                className={styles.option}
                                                data-active={activeIndex === index}
                                                disabled={option.disabled}
                                                onPointerMove={() => {
                                                    if (activeIndex !== index) {
                                                        setActiveIndex(index)
                                                    }
                                                }}
                                                onClick={() => {
                                                    toggle(option)
                                                }}
                                            >
                                                <span>{option.label}</span>
                                                <AnimatePresence initial={false}>
                                                    {selectedSet.has(option.value) && (
                                                        <CheckMark key="check" reduce={reduce} />
                                                    )}
                                                </AnimatePresence>
                                            </button>
                                        ))}
                                    </ScrollArea>
                                </motion.div>
                            </PopoverContent>
                        )}
                    </AnimatePresence>
                </div>
                {description && <span className={styles.description}>{description}</span>}
            </div>
        </Popover>
    )
}
