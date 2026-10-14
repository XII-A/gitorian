'use client'

import { Minus, Plus } from 'lucide-react'
import type { MotionValue, Variants } from 'motion/react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import type { KeyboardEvent, PointerEvent, Ref } from 'react'
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './number-field.module.css'

/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- The native label only suppresses a click after scrubbing. Its associated spinbutton supplies keyboard interaction. */

/** Text shown beside the number. A function receives the value, so a unit can follow it: `n => n === 1 ? " seat" : " seats"`. */
export type NumberFieldAffix = string | ((value: number) => string)

export interface NumberFieldProps {
    label: string
    value?: number
    defaultValue?: number
    onValueChange?: (value: number) => void
    min?: number
    max?: number
    step?: number
    /** PageUp, PageDown, and Shift with an arrow move this far. Defaults to ten steps. */
    largeStep?: number
    description?: string
    disabled?: boolean
    id?: string
    /** Text before the number, such as "$". */
    prefix?: NumberFieldAffix
    /** Text after the number, such as " seats". */
    suffix?: NumberFieldAffix
    /** Drag the label sideways to scrub the value, one step every few pixels. */
    scrub?: boolean
    /** Formatting locale. Fixed by default so server and client render the same digits. */
    locale?: string
    /** Fraction digits and grouping. Fraction digits follow the precision of `step` by default. */
    formatOptions?: { minimumFractionDigits?: number; maximumFractionDigits?: number; useGrouping?: boolean }
    /** Control height, type size, and default width. */
    size?: NumberFieldSize
    /** A short note beside the label when a press meets a limit or a typed value passes one. `false` hides it; a function writes the copy. */
    limitHint?: boolean | ((edge: 'min' | 'max', limit: number) => string)
}

export type NumberFieldSize = 'sm' | 'md' | 'lg'

type Source = 'button' | 'key' | 'scrub' | 'type'
type Part = { key: string; digit: number } | { key: string; text: string }

const { spring, duration, blur } = motionTokens
const enterEase = [...motionTokens.ease.enter] as [number, number, number, number]
const exitEase = [...motionTokens.ease.standard] as [number, number, number, number]
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
/** Pixels of label drag per step, the pause before a held control repeats, and the fastest repeat. */
const HOLD_DELAY = 400
const HOLD_FASTEST = 40
const SCRUB_PX = 6
/** A held press keeps leaning on a limit at this cadence, how long the limit note stays, and how long an under-minimum draft waits
 * before it warns (a short draft is often on its way to a larger number). */
const LIMIT_HINT_MS = 1500
const LIMIT_PUSH = 240
const UNDER_WARN_MS = 700
/** Pushes that arrive within this window count as one continued effort, so each strains a little further, up to the cap. */
const PUSH_CAP = 4
const PUSH_GAIN = 0.22
const PUSH_WINDOW = 700
/** A velocity kick on the value at a limit: it strains a few pixels toward the press and springs home. Motion drops velocity on
 * time-defined springs, so the kick runs the morph spring expressed as stiffness and damping. */
const BUMP_VELOCITY = 130
const kick = (() => {
    const root = (2 * Math.PI) / (spring.morph.visualDuration * 1.2)
    return { damping: 2 * (1 - spring.morph.bounce) * root, stiffness: root * root, type: 'spring' as const }
})()

const decimalsOf = (value: number) => (String(value).split('.')[1] ?? '').length
const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\-]/gu, '\\$&')
const affixText = (affix: NumberFieldAffix | undefined, value: number) =>
    typeof affix === 'function' ? affix(value) : (affix ?? '')
/** iOS style resistance: travel past a limit gives less and less, and never more than `limit` pixels. */
const rubber = (distance: number, limit = 10) =>
    Math.sign(distance) * (1 - 1 / ((Math.abs(distance) * 0.55) / limit + 1)) * limit

/** Split a formatted number into columns keyed by place value, so 9 → 10 keeps the ones column the ones column. */
const partsOf = (value: number, format: Intl.NumberFormat): Part[] => {
    const parts = format.formatToParts(value)
    let place = parts.reduce((count, part) => count + (part.type === 'integer' ? part.value.length : 0), 0)
    let fraction = 0
    return parts.flatMap((part, index): Part[] => {
        if (part.type === 'integer') {
            return [...part.value].map((char) => ({ digit: Number(char), key: `i${(place -= 1)}` }))
        }
        if (part.type === 'fraction') {
            return [...part.value].map((char) => ({ digit: Number(char), key: `f${(fraction += 1)}` }))
        }
        return [
            {
                key: (() => {
                    if (part.type === 'group') {
                        return `g${place}`
                    }
                    if (part.type === 'decimal') {
                        return 'd'
                    }
                    if (part.type === 'minusSign') {
                        return 'm'
                    }

                    return `${part.type}${index}`
                })(),
                text: part.value
            }
        ]
    })
}

/* A column or character opens its width while it rises in the direction of change, and closes on a critically damped spring so it never passes zero.
   Scale and opacity ride the same spring as width, so a digit grows with its slot instead of landing on its neighbours. */
const slot: Variants = {
    center: {
        filter: 'blur(0px)',
        opacity: 1,
        scale: 1,
        transition: {
            filter: { duration: 0.3, ease: exitEase },
            opacity: spring.morph,
            scale: spring.morph,
            width: spring.morph,
            y: spring.snappy
        },
        transitionEnd: { filter: 'none' },
        width: 'auto',
        y: 0
    },
    enter: (direction: number) => ({
        filter: `blur(${blur.soft}px)`,
        opacity: 0,
        scale: 0.6,
        width: 0,
        y: `${direction * 0.3}em`
    }),
    exit: (direction: number) => ({
        filter: `blur(${blur.subtle}px)`,
        opacity: 0,
        scale: 0.6,
        transition: {
            filter: { duration: duration.instant },
            opacity: { duration: duration.instant },
            scale: spring.smooth,
            width: spring.smooth,
            y: { duration: duration.fast, ease: exitEase }
        },
        width: 0,
        y: `${direction * -0.3}em`
    })
}
/* Reduced motion keeps a short fade and no travel. While typing, columns follow the draft at once so they never lag the caret.
   Every resting state matches `slot`, so a page hydrated with reduced motion renders the same styles as the server. */
const rest = (opacity: number) => ({ filter: 'none', opacity, scale: 1, width: 'auto', y: 0 })
const still: Variants = {
    center: { ...rest(1), transition: { duration: duration.instant } },
    enter: rest(0),
    exit: { opacity: 0, transition: { duration: 0 }, width: 0 }
}
const cut: Variants = {
    center: { ...rest(1), transition: { duration: 0 } },
    enter: rest(1),
    exit: { opacity: 0, transition: { duration: 0 }, width: 0 }
}

/** One digit on the wheel. Its distance from the wheel position sets where it sits, how clear it is, and whether it shows. */
const Glyph = ({ position, digit }: { position: MotionValue<number>; digit: number }) => {
    // Every style reads the wheel directly: a chained transform can update a frame late and leave the wheel blank on a jump.
    const offset = (current: number) => ((((digit - current) % 10) + 15) % 10) - 5
    const y = useTransform(position, (current) => `${offset(current) * 1.05}em`)
    // An eased falloff keeps a turning digit legible through the middle of the roll instead of washing out.
    const opacity = useTransform(position, (current) => Math.max(0, 1 - Math.abs(offset(current)) ** 1.5 * 1.1))
    const visibility = useTransform(position, (current) => (Math.abs(offset(current)) >= 1 ? 'hidden' : 'visible'))
    const filter = useTransform(position, (current) => {
        const distance = Math.abs(offset(current))
        return distance < 0.02 || distance >= 1 ? 'none' : `blur(${(distance * blur.soft * 0.75).toFixed(2)}px)`
    })
    return (
        <motion.span className={styles.glyph} style={{ filter, opacity, visibility, y }}>
            {digit}
        </motion.span>
    )
}

/** An odometer wheel. It turns the way the whole number moved, wraps 9 → 0, and retargets mid spin when steps arrive quickly. */
const Wheel = ({ digit, direction, instant }: { digit: number; direction: number; instant: boolean }) => {
    const reduced = useReducedMotion()
    const position = useMotionValue(digit)
    const wheel = useRef({ digit, target: digit })
    useLayoutEffect(() => {
        const state = wheel.current
        if (state.digit === digit) {
            return
        }
        // Turn the way the number moved, unless that is more than half a turn; then take the short way, so a big clamp never spins.
        let delta = direction > 0 ? (digit - state.digit + 10) % 10 : -((state.digit - digit + 10) % 10)
        if (Math.abs(delta) > 5) {
            delta -= Math.sign(delta) * 10
        }
        state.target += delta
        state.digit = digit
        if (instant || reduced) {
            position.jump(state.target)
        } else {
            animate(position, state.target, spring.snappy)
        }
    }, [digit, direction, instant, position, reduced])
    return (
        <>
            <span className={styles.sizer}>0</span>
            {DIGITS.map((item) => (
                <Glyph key={item} position={position} digit={item} />
            ))}
        </>
    )
}

const Digits = ({
    value,
    format,
    direction,
    instant
}: {
    value: number
    format: Intl.NumberFormat
    direction: number
    instant: boolean
}) => {
    const reduced = useReducedMotion()
    const variants = (() => {
        if (instant) {
            return cut
        }
        if (reduced) {
            return still
        }
        return slot
    })()
    return (
        <AnimatePresence initial={false} custom={direction}>
            {partsOf(value, format).map((part) => (
                <motion.span
                    key={part.key}
                    className={'digit' in part ? styles.column : styles.symbol}
                    custom={direction}
                    variants={variants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                >
                    {'digit' in part ? <Wheel digit={part.digit} direction={direction} instant={instant} /> : part.text}
                </motion.span>
            ))}
        </AnimatePresence>
    )
}

/** Prefix and suffix characters are keyed by position, so "seat" → "seats" only opens the new "s" and the rest holds still. */
const AffixText = ({ text, direction, className }: { text: string; direction: number; className?: string }) => {
    const reduced = useReducedMotion()
    return (
        <span className={className}>
            <AnimatePresence initial={false} custom={direction}>
                {Array.from(
                    new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text),
                    (part) => part.segment
                ).map((char, index) => (
                    <motion.span
                        key={`${index}:${char}`}
                        className={styles.char}
                        custom={direction}
                        variants={reduced ? still : slot}
                        initial="enter"
                        animate="center"
                        exit="exit"
                    >
                        {char}
                    </motion.span>
                ))}
            </AnimatePresence>
        </span>
    )
}

const numberIn = (word?: string) => {
    const digits = word?.replaceAll(/[^\d.-]/gu, '')
    return digits && /\d/u.test(digits) && Number.isFinite(Number(digits)) ? Number(digits) : null
}
/** A number word rolls down when it shrank and up when it grew; any other changed word rises. */
const directionsBetween = (from: string, to: string) => {
    const before = from.split(' ')
    return to.split(' ').map((word, index) => {
        const a = numberIn(before[index])
        const b = numberIn(word)
        return a !== null && b !== null && b < a ? -1 : 1
    })
}

const wordRise: Variants = {
    enter: (direction: number) => ({ filter: `blur(${blur.soft}px)`, opacity: 0, y: `${direction * 0.3}em` }),
    // Opacity follows the slot's width spring, so a longer word never shows before its room has opened.
    center: {
        filter: 'blur(0px)',
        opacity: 1,
        transition: { duration: 0.22, ease: enterEase, opacity: spring.morph },
        transitionEnd: { filter: 'none' },
        y: 0
    },
    exit: (direction: number) => ({
        filter: `blur(${blur.subtle}px)`,
        opacity: 0,
        transition: { duration: 0.14, ease: exitEase },
        y: `${direction * -0.3}em`
    })
}
const wordFade: Variants = {
    center: { filter: 'none', opacity: 1, transition: { duration: duration.instant }, y: 0 },
    enter: { filter: 'none', opacity: 0, y: 0 },
    exit: { opacity: 0, transition: { duration: 0 } }
}

/** A word's width follows its new copy on a spring, so a price gaining a digit eases the rest of the line along instead of shoving it. */
const WordSlot = ({ word, direction }: { word: string; direction: number }) => {
    const reduced = useReducedMotion()
    const sizerRef = useRef<HTMLSpanElement>(null)
    const width = useMotionValue<number | 'auto'>('auto')
    const measured = useRef(false)
    useLayoutEffect(() => {
        const node = sizerRef.current
        if (!node || typeof ResizeObserver === 'undefined') {
            return
        }
        const observer = new ResizeObserver(() => {
            if (!measured.current || reduced) {
                width.jump(node.offsetWidth)
            } else {
                animate(width, node.offsetWidth, spring.morph)
            }
            measured.current = true
        })
        observer.observe(node)
        return () => {
            observer.disconnect()
        }
    }, [reduced, width])
    return (
        <motion.span className={styles.wordSlot} style={{ width }}>
            <span ref={sizerRef} className={styles.wordSizer}>
                {word}
            </span>
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                <motion.span
                    key={word}
                    className={styles.word}
                    custom={direction}
                    variants={reduced ? wordFade : wordRise}
                    initial="enter"
                    animate="center"
                    exit="exit"
                >
                    {word}
                </motion.span>
            </AnimatePresence>
        </motion.span>
    )
}

/** Changed words rise in and unblur while unchanged words hold still. Assistive tech reads the plain copy. */
const MotionText = ({ text }: { text: string }) => {
    const [trail, setTrail] = useState({ directions: [] as number[], text })
    if (trail.text !== text) {
        setTrail({ directions: directionsBetween(trail.text, text), text })
    }
    const directions = trail.text === text ? trail.directions : directionsBetween(trail.text, text)
    const words = text.split(' ')
    // Spaces live between the slots, so a word that is still opening its width never runs into the next one.
    return (
        <>
            <span className={styles.srOnly}>{text}</span>
            <span className={styles.words} aria-hidden="true">
                {words.map((word, index) => (
                    <Fragment key={index}>
                        {index > 0 && ' '}
                        <WordSlot word={word} direction={directions[index] ?? 1} />
                    </Fragment>
                ))}
            </span>
        </>
    )
}

/** Helper copy: the row opens its height on a spring, then the words settle in. */
const MessageRow = ({ id, text, className }: { id?: string; text: string; className?: string }) => {
    const reduced = useReducedMotion()
    const copyRef = useRef<HTMLSpanElement>(null)
    const [height, setHeight] = useState<number | 'auto'>('auto')
    useLayoutEffect(() => {
        const node = copyRef.current
        if (!node || typeof ResizeObserver === 'undefined') {
            return
        }
        const observer = new ResizeObserver(([entry]) => {
            setHeight(entry?.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight)
        })
        observer.observe(node)
        return () => {
            observer.disconnect()
        }
    }, [])
    return (
        <motion.span
            className={styles.messageSlot}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height, opacity: 1 }}
            exit={{
                height: 0,
                opacity: 0,
                transition: reduced
                    ? { duration: 0 }
                    : { height: spring.smooth, opacity: { duration: duration.instant } }
            }}
            transition={reduced ? { duration: 0 } : { height: spring.smooth, opacity: { duration: duration.fast } }}
        >
            <motion.span
                ref={copyRef}
                id={id}
                className={className}
                initial={reduced ? false : { filter: `blur(${blur.soft}px)`, y: '0.35em' }}
                animate={{ filter: 'blur(0px)', y: 0 }}
                transition={{ duration: reduced ? 0 : duration.standard, ease: enterEase }}
            >
                <MotionText text={text} />
            </motion.span>
        </motion.span>
    )
}

const FieldMessage = ({ id, text, className }: { id?: string; text?: string; className?: string }) => (
    <AnimatePresence initial={false}>
        {text ? <MessageRow key="message" id={id} text={text} className={className} /> : null}
    </AnimatePresence>
)

/** The row tracks the measured copy, so a longer message that wraps opens its next line instead of snapping. */

/** The limit note rises in from the side it guards (up for a maximum, down for a minimum) and fades out in place. */
const LimitNote = ({ id, edge, text }: { id: string; edge: 1 | -1 | 0; text: string }) => {
    const reduced = useReducedMotion()
    return (
        <AnimatePresence initial={false}>
            {edge !== 0 && (
                <motion.span
                    key="limit"
                    id={id}
                    className={styles.limit}
                    initial={
                        reduced
                            ? { opacity: 0 }
                            : { filter: `blur(${blur.subtle}px)`, opacity: 0, y: `${edge * 0.45}em` }
                    }
                    animate={{ filter: 'blur(0px)', opacity: 1, transitionEnd: { filter: 'none' }, y: 0 }}
                    exit={{
                        opacity: 0,
                        transition: { duration: reduced ? duration.instant : duration.standard, ease: exitEase }
                    }}
                    transition={
                        reduced
                            ? { duration: duration.instant }
                            : {
                                  filter: { duration: duration.fast },
                                  opacity: { duration: duration.fast },
                                  y: spring.snappy
                              }
                    }
                >
                    {text}
                </motion.span>
            )}
        </AnimatePresence>
    )
}

/** Pointer presses hold to repeat; keyboard and assistive clicks (detail 0) take one step. */
const StepButton = ({
    toward,
    label,
    disabled,
    controls,
    limit,
    pressed,
    iconRef,
    onPress,
    onRelease,
    onActivate
}: {
    toward: 1 | -1
    label: string
    disabled?: boolean
    controls: string
    limit: boolean
    pressed: boolean
    iconRef: Ref<HTMLSpanElement>
    onPress: () => void
    onRelease: () => void
    onActivate: () => void
}) => {
    const Icon = toward > 0 ? Plus : Minus
    // A limit dims the button but keeps it focusable, so a press there strains the value instead of dropping focus.
    // Mouse presses keep focus where it was: an open draft commits with the step, and the stepper never steals the ring.
    return (
        <button
            type="button"
            className={styles.step}
            disabled={disabled}
            aria-controls={controls}
            aria-label={`${toward > 0 ? 'Increase' : 'Decrease'} ${label}`}
            aria-disabled={limit || undefined}
            data-pressed={pressed || undefined}
            onPointerDown={(event) => {
                if (event.button === 0) {
                    onPress()
                }
            }}
            onPointerUp={onRelease}
            onPointerLeave={onRelease}
            onPointerCancel={onRelease}
            onMouseDown={(event) => {
                event.preventDefault()
            }}
            onClick={(event) => {
                if (event.detail === 0) {
                    onActivate()
                }
            }}
            onContextMenu={(event) => {
                event.preventDefault()
            }}
        >
            <span ref={iconRef} className={styles.icon}>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
            </span>
        </button>
    )
}

/**
 * A bounded number with odometer digits. Buttons and arrow keys repeat and speed up while held, PageUp and PageDown take
 * large steps, Home and End jump to the limits, and `scrub` lets the label be dragged. Typing edits a plain draft that
 * applies live while valid; the rolling digits return once it commits on Enter, blur, or the next step.
 */
export const NumberField = ({
    label,
    value,
    defaultValue = 0,
    onValueChange,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    step: stepProp = 1,
    largeStep,
    description,
    disabled,
    id,
    prefix,
    suffix,
    scrub = false,
    locale = 'en-US',
    formatOptions,
    size = 'md',
    limitHint = true
}: NumberFieldProps) => {
    const reduced = useReducedMotion()
    const generatedId = useId()
    const inputId = id ?? generatedId
    const hintId = description ? `${inputId}-description` : undefined
    const limitId = `${inputId}-limit`
    const step = stepProp > 0 ? stepProp : 1
    const [internal, setInternal] = useState(defaultValue)
    const current = value ?? internal
    const [draft, setDraft] = useState('')
    const [editing, setEditing] = useState(false)
    const [pressed, setPressed] = useState(0)
    const [scrubbing, setScrubbing] = useState(false)
    const [announcement, setAnnouncement] = useState('')
    /** The limit a press just met, shown for a moment; and whether a draft under the minimum has sat long enough to warn. */
    const [pushed, setPushed] = useState<1 | -1 | 0>(0)
    const [underWarn, setUnderWarn] = useState(false)
    const controlRef = useRef<HTMLDivElement>(null)
    const minusIcon = useRef<HTMLSpanElement>(null)
    const plusIcon = useRef<HTMLSpanElement>(null)
    const pushedTimer = useRef<number | undefined | null>(null)
    const underTimer = useRef<number | undefined | null>(null)
    const strainTimer = useRef<number | undefined | null>(null)
    const effort = useRef({ at: 0, count: 0, edge: 0 })
    const inputRef = useRef<HTMLInputElement>(null)
    const groupRef = useRef<HTMLSpanElement>(null)
    const latest = useRef(current)
    const editStart = useRef(current)
    const hold = useRef<number | undefined | null>(null)
    const drag = useRef<{ pointer: number; x: number; from: number; active: boolean } | null>(null)
    const suppressClick = useRef(false)
    const shiftFrom = useRef<number | null>(null)
    const selectNext = useRef(false)
    const live = useRef<(direction: 1 | -1, steps: number, source: Source) => boolean>(() => false)
    const bumpY = useMotionValue(0)
    const scrubX = useMotionValue(0)
    const shiftX = useMotionValue(0)
    const x = useTransform(() => scrubX.get() + shiftX.get())

    const base = Number.isFinite(min) ? min : 0
    const decimals = Math.max(decimalsOf(step), decimalsOf(base))
    const minFraction = formatOptions?.minimumFractionDigits ?? decimals
    const maxFraction = Math.max(minFraction, formatOptions?.maximumFractionDigits ?? decimals)
    const grouping = formatOptions?.useGrouping ?? true
    const format = useMemo(
        () =>
            new Intl.NumberFormat(locale, {
                maximumFractionDigits: maxFraction,
                minimumFractionDigits: minFraction,
                numberingSystem: 'latn',
                useGrouping: grouping
            }),
        [locale, minFraction, maxFraction, grouping]
    )
    const symbols = useMemo(() => {
        const parts = new Intl.NumberFormat(locale).formatToParts(-1234.5)
        return {
            decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
            group: parts.find((part) => part.type === 'group')?.value ?? ','
        }
    }, [locale])
    const round = (next: number) => Number(next.toFixed(decimals)) || 0
    const clamp = (next: number) => Math.min(max, Math.max(min, next))
    const snap = (next: number) => round(base + Math.round((next - base) / step) * step)
    /** Off-grid values move to the next grid line in the direction of travel, then whole steps from there. */
    const stepFrom = (from: number, steps: number) => {
        const index = (from - base) / step
        return round(base + ((steps > 0 ? Math.floor(index + 1e-7) : Math.ceil(index - 1e-7)) + steps) * step)
    }
    const spoken = (next: number) => `${affixText(prefix, next)}${format.format(next)}${affixText(suffix, next)}`.trim()
    const parse = (text: string) => {
        const normalized = text
            .split(symbols.group)
            .join('')
            .replace(symbols.decimal, '.')
            .replaceAll(/[^\d.-]/gu, '')
        if (!/\d/u.test(normalized)) {
            return null
        }
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : null
    }
    const typed = editing ? parse(draft) : null
    const shown = typed ?? current
    const [trail, setTrail] = useState({ direction: 1 as 1 | -1, value: shown })
    if (trail.value !== shown) {
        setTrail({ direction: shown > trail.value ? 1 : -1, value: shown })
    }
    const direction = (() => {
        if (trail.value === shown) {
            return trail.direction
        }
        if (shown > trail.value) {
            return 1
        }
        return -1
    })()

    useEffect(
        () => () => {
            window.clearTimeout(hold.current ?? undefined)
            window.clearTimeout(pushedTimer.current ?? undefined)
            window.clearTimeout(underTimer.current ?? undefined)
            window.clearTimeout(strainTimer.current ?? undefined)
        },
        []
    )

    /** A press past a limit. The value strains toward it and springs home, a little further with each push in a row (capped, like
     * overscroll); the refused button shakes once; the note names the limit. Reduced motion keeps only a brief color change. */
    const strain = (edge: 1 | -1, source: Source) => {
        const now = performance.now()
        const push = effort.current
        push.count = push.edge === edge && now - push.at < PUSH_WINDOW ? push.count + 1 : 1
        push.edge = edge
        push.at = now
        const control = controlRef.current
        if (control) {
            control.dataset.strain = edge > 0 ? 'max' : 'min'
            window.clearTimeout(strainTimer.current ?? undefined)
            strainTimer.current = window.setTimeout(() => {
                delete control.dataset.strain
            }, 420)
        }
        if (!reduced) {
            animate(bumpY, 0, {
                ...kick,
                velocity: -edge * BUMP_VELOCITY * (1 + Math.min(push.count - 1, PUSH_CAP) * PUSH_GAIN)
            })
            const icon = (edge > 0 ? plusIcon : minusIcon).current
            if (icon && (source === 'button' || source === 'key')) {
                animate(icon, { x: [0, -2.5, 2.5, -1.5, 1, 0] }, { duration: 0.32, ease: 'easeOut' })
            }
        }
        if (limitHint) {
            setPushed(edge)
            window.clearTimeout(pushedTimer.current ?? undefined)
            pushedTimer.current = window.setTimeout(() => {
                setPushed(0)
            }, LIMIT_HINT_MS)
        }
    }
    /** Every change lands here. A value past a limit clamps, strains toward it, and says which limit it met. */
    const commitValue = (next: number, source: Source) => {
        if (!Number.isFinite(next)) {
            return false
        }
        const clamped = clamp(next)
        const limit = Math.sign(next - clamped)
        if (limit && source !== 'scrub') {
            strain(limit > 0 ? 1 : -1, source)
            setAnnouncement(`${spoken(clamped)}, ${limit > 0 ? 'maximum' : 'minimum'}`)
        } else if (source === 'button' && clamped !== latest.current) {
            setAnnouncement(spoken(clamped))
        }
        if (clamped === latest.current) {
            return false
        }
        latest.current = clamped
        if (value === undefined) {
            setInternal(clamped)
        }
        onValueChange?.(clamped)
        return true
    }
    const nudge = (toward: 1 | -1, steps: number, source: Source) =>
        commitValue(stepFrom(latest.current, toward * steps), source)
    useLayoutEffect(() => {
        latest.current = current
        live.current = nudge
    })

    /** The group glides back to center when typing changes its width, instead of hopping half a character per key. */
    const captureShift = () => {
        const group = groupRef.current
        if (group && shiftFrom.current === null) {
            shiftFrom.current = group.getBoundingClientRect().left - scrubX.get() - shiftX.get()
        }
    }
    useLayoutEffect(() => {
        const from = shiftFrom.current
        const group = groupRef.current
        shiftFrom.current = null
        // After a commit the caret collapses to the end, so no selection box sits over the rolling digits.
        if (selectNext.current) {
            selectNext.current = false
            const input = inputRef.current
            if (input && document.activeElement === input) {
                const end = input.value.length
                input.setSelectionRange(end, end)
            }
        }
        if (from === null || !group) {
            return
        }
        const delta = from - (group.getBoundingClientRect().left - scrubX.get() - shiftX.get())
        if (Math.abs(delta) < 0.5) {
            return
        }
        shiftX.set(shiftX.get() + delta)
        if (reduced) {
            shiftX.jump(0)
        } else {
            animate(shiftX, 0, spring.morph)
        }
    })

    const clearUnder = () => {
        window.clearTimeout(underTimer.current ?? undefined)
        setUnderWarn(false)
    }
    const commitDraft = () => {
        if (!editing) {
            return
        }
        captureShift()
        setEditing(false)
        clearUnder()
        const parsed = parse(draft)
        if (parsed !== null) {
            commitValue(snap(parsed), 'type')
        }
    }
    const stopHold = () => {
        window.clearTimeout(hold.current ?? undefined)
        hold.current = undefined
        setPressed(0)
    }
    /** One step now; after a pause, repeats that speed up gently until release. Held into a limit, it keeps leaning on it at a
     * steady cadence, each push straining a little further, until the press lets go. */
    const startHold = (toward: 1 | -1, amount: number, source: Source) => {
        stopHold()
        commitDraft()
        const steps = Math.max(1, Math.round(amount / step))
        if (source === 'button') {
            setPressed(toward)
        }
        let count = 0
        const tick = () => {
            const moved = live.current(toward, steps, source)
            if (moved) {
                count += 1
            }
            hold.current = window.setTimeout(tick, moved ? Math.max(HOLD_FASTEST, 150 * 0.86 ** count) : LIMIT_PUSH)
        }
        hold.current = window.setTimeout(tick, nudge(toward, steps, source) ? HOLD_DELAY : LIMIT_PUSH + 120)
    }

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        const large = largeStep ?? step * 10
        const move = (
            {
                ArrowDown: [-1, event.shiftKey ? large : step],
                ArrowUp: [1, event.shiftKey ? large : step],
                PageDown: [-1, large],
                PageUp: [1, large]
            } as Record<string, [1 | -1, number]>
        )[event.key]
        if (move) {
            event.preventDefault()
            if (!event.repeat) {
                startHold(move[0], move[1], 'key')
            }
            return
        }
        // Home and End reach the limits; while a draft is open they move the caret as in any text field.
        if (
            !editing &&
            ((event.key === 'Home' && Number.isFinite(min)) || (event.key === 'End' && max < Number.MAX_SAFE_INTEGER))
        ) {
            event.preventDefault()
            commitValue(event.key === 'Home' ? min : max, 'key')
            return
        }
        if (event.key === 'Enter') {
            event.preventDefault()
            if (editing) {
                selectNext.current = true
                commitDraft()
            } else {
                event.currentTarget.select()
            }
        }
        if (event.key === 'Escape' && editing) {
            event.preventDefault()
            captureShift()
            setEditing(false)
            clearUnder()
            selectNext.current = true
            commitValue(editStart.current, 'type')
        }
    }
    const onChange = (text: string) => {
        const allowed = new RegExp(
            `[^0-9${escape(symbols.group)}${decimals || maxFraction ? escape(symbols.decimal) : ''}${min < 0 ? '\\-' : ''}]`,
            'gu'
        )
        const next = text.replace(allowed, '')
        if (!editing) {
            editStart.current = current
        }
        captureShift()
        setDraft(next)
        setEditing(true)
        // Valid drafts apply as they are typed, so anything that depends on the value follows along.
        const parsed = parse(next)
        if (parsed !== null && parsed >= min && parsed <= max && snap(parsed) === parsed) {
            commitValue(parsed, 'type')
        }
        // Past the maximum warns at once; under the minimum waits, since "1" is often the start of "12".
        clearUnder()
        if (parsed !== null && parsed < min) {
            underTimer.current = window.setTimeout(() => {
                setUnderWarn(true)
            }, UNDER_WARN_MS)
        }
    }

    const onScrubStart = (event: PointerEvent<HTMLLabelElement>) => {
        suppressClick.current = false
        if (!scrub || disabled || event.button !== 0) {
            return
        }
        commitDraft()
        drag.current = { active: false, from: latest.current, pointer: event.pointerId, x: event.clientX }
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const onScrubMove = (event: PointerEvent<HTMLLabelElement>) => {
        const state = drag.current
        if (!state || state.pointer !== event.pointerId) {
            return
        }
        const dx = event.clientX - state.x
        if (!state.active) {
            if (Math.abs(dx) < 3) {
                return
            }
            state.active = true
            setScrubbing(true)
        }
        const travel = dx / SCRUB_PX
        const steps = Math.trunc(travel)
        commitValue(steps ? stepFrom(state.from, steps) : state.from, 'scrub')
        // Past a limit the value follows the pointer with resistance, then springs back on release.
        const raw = state.from + travel * step
        const over = (() => {
            if (raw > max) {
                return ((raw - max) / step) * SCRUB_PX
            }
            if (raw < min) {
                return ((raw - min) / step) * SCRUB_PX
            }
            return 0
        })()
        scrubX.set(reduced ? 0 : rubber(over))
    }
    const onScrubEnd = (event: PointerEvent<HTMLLabelElement>) => {
        const state = drag.current
        if (!state || state.pointer !== event.pointerId) {
            return
        }
        drag.current = null
        if (!state.active) {
            return
        }
        suppressClick.current = true
        setScrubbing(false)
        animate(scrubX, 0, reduced ? { duration: 0 } : spring.snappy)
        setAnnouncement(spoken(latest.current))
    }

    const stepper = (toward: 1 | -1) => ({
        controls: inputId,
        disabled,
        label,
        limit: toward > 0 ? shown >= max : shown <= min,
        pressed: pressed === toward,
        toward
    })
    /** A typed value past a limit holds a calm warning until it commits and springs back. */
    const outside: 1 | -1 | 0 = (() => {
        if (typed === null) {
            return 0
        }
        if (typed > max) {
            return 1
        }
        if (typed < min && underWarn) {
            return -1
        }

        return 0
    })()
    const noteEdge = limitHint ? outside || pushed : 0
    const noteLimit = noteEdge > 0 ? max : min
    const noteText = (() => {
        if (noteEdge) {
            if (typeof limitHint === 'function') {
                return limitHint(noteEdge > 0 ? 'max' : 'min', noteLimit)
            }
            return `${noteEdge > 0 ? 'Max' : 'Min'} ${spoken(noteLimit)}`
        }
        return ''
    })()
    const describedBy = [hintId, outside && limitHint ? limitId : undefined].filter(Boolean).join(' ') || undefined

    return (
        <div className={styles.field} data-size={size}>
            <div className={styles.head}>
                <label
                    htmlFor={inputId}
                    className={styles.label}
                    data-scrub={(scrub && !disabled) || undefined}
                    onPointerDown={onScrubStart}
                    onPointerMove={onScrubMove}
                    onPointerUp={onScrubEnd}
                    onPointerCancel={onScrubEnd}
                    onClick={(event) => {
                        if (suppressClick.current) {
                            event.preventDefault()
                            suppressClick.current = false
                        }
                    }}
                >
                    {label}
                </label>
                <LimitNote id={limitId} edge={noteEdge} text={noteText} />
            </div>
            <div
                ref={controlRef}
                className={styles.control}
                data-scrubbing={scrubbing || undefined}
                data-disabled={disabled || undefined}
                data-warn={outside ? (outside > 0 ? 'max' : 'min') : undefined}
            >
                <StepButton
                    {...stepper(-1)}
                    iconRef={minusIcon}
                    onPress={() => {
                        startHold(-1, step, 'button')
                    }}
                    onRelease={stopHold}
                    onActivate={() => {
                        commitDraft()
                        nudge(-1, 1, 'button')
                    }}
                />
                <div
                    className={styles.valueWrap}
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target !== inputRef.current) {
                            event.preventDefault()
                        }
                    }}
                    onClick={(event) => {
                        if (!disabled && event.target !== inputRef.current) {
                            inputRef.current?.focus()
                            inputRef.current?.select()
                        }
                    }}
                >
                    <motion.span ref={groupRef} className={styles.value} style={{ x, y: bumpY }}>
                        <AffixText text={affixText(prefix, shown)} direction={direction} className={styles.affix} />
                        <span className={styles.number}>
                            <span className={styles.display} data-hidden={editing || undefined} aria-hidden="true">
                                <Digits value={shown} format={format} direction={direction} instant={editing} />
                            </span>
                            {editing && (
                                <span className={styles.mirror} aria-hidden="true">
                                    {draft}
                                </span>
                            )}
                            <input
                                ref={inputRef}
                                id={inputId}
                                className={styles.input}
                                type="text"
                                role="spinbutton"
                                inputMode={(() => {
                                    if (min < 0) {
                                        return 'text'
                                    }
                                    if (decimals || maxFraction) {
                                        return 'decimal'
                                    }
                                    return 'numeric'
                                })()}
                                autoComplete="off"
                                spellCheck={false}
                                value={editing ? draft : format.format(current)}
                                disabled={disabled}
                                aria-describedby={describedBy}
                                aria-invalid={outside ? true : undefined}
                                aria-valuenow={current}
                                aria-valuetext={spoken(current)}
                                aria-valuemin={Number.isFinite(min) ? min : undefined}
                                aria-valuemax={max < Number.MAX_SAFE_INTEGER ? max : undefined}
                                onChange={(event) => {
                                    onChange(event.currentTarget.value)
                                }}
                                onKeyDown={onKeyDown}
                                onKeyUp={(event) => {
                                    if (
                                        /^(?<group1>Arrow(?<group2>Up|Down)|Page(?<group3>Up|Down))$/u.test(event.key)
                                    ) {
                                        stopHold()
                                    }
                                }}
                                onBlur={() => {
                                    stopHold()
                                    commitDraft()
                                }}
                            />
                        </span>
                        <AffixText text={affixText(suffix, shown)} direction={direction} className={styles.affix} />
                    </motion.span>
                </div>
                <StepButton
                    {...stepper(1)}
                    iconRef={plusIcon}
                    onPress={() => {
                        startHold(1, step, 'button')
                    }}
                    onRelease={stopHold}
                    onActivate={() => {
                        commitDraft()
                        nudge(1, 1, 'button')
                    }}
                />
            </div>
            <FieldMessage id={hintId} text={description} className={styles.hint} />
            <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
                {announcement}
            </span>
        </div>
    )
}
