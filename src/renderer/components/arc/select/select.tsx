'use client'

import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { Variants } from 'motion/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ComponentPropsWithoutRef, ForwardRefRenderFunction } from 'react'
import { forwardRef, useId, useState } from 'react'

import { motionTokens } from '../lib/motion-tokens'

import styles from './select.module.css'

export interface SelectProps extends Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, 'children'> {
    label: string
    description?: string
    placeholder?: string
    id?: string
    className?: string
    /** Ghost controls blend into toolbars and filter rows. */
    variant?: 'default' | 'ghost'
    /** Minimum menu width in pixels, still constrained to the viewport. */
    contentMinWidth?: number
    options: { value: string; label: string; disabled?: boolean; count?: number }[]
    'aria-labelledby'?: string
    'aria-label'?: string
}

/** The shown value rolls in the direction of the list: a later option rises from below, an earlier one drops from above. */
const valueRoll: Variants = {
    center: {
        filter: 'blur(0px)',
        opacity: 1,
        transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] },
        y: 0
    },
    enter: (direction: number) => ({
        filter: `blur(${motionTokens.blur.soft}px)`,
        opacity: 0,
        y: `${direction * 0.35}em`
    }),
    exit: (direction: number) => ({
        filter: `blur(${motionTokens.blur.subtle}px)`,
        opacity: 0,
        transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] },
        y: `${direction * -0.3}em`
    })
}
/** Reduced motion keeps a short crossfade; the resting state matches valueRoll so server and client markup agree. */
const valueFade: Variants = {
    center: { filter: 'blur(0px)', opacity: 1, transition: { duration: motionTokens.duration.instant }, y: 0 },
    enter: { opacity: 0 },
    exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } }
}

const SelectRender: ForwardRefRenderFunction<HTMLButtonElement, SelectProps> = (
    {
        label,
        description,
        placeholder = 'Select an option',
        options,
        id,
        className,
        variant = 'default',
        contentMinWidth,
        disabled,
        onValueChange,
        ...rootProps
    },
    ref
) => {
    const generatedId = useId()
    const controlId = id ?? generatedId
    const hintId = description ? `${controlId}-description` : undefined
    const reduceMotion = useReducedMotion()
    const [uncontrolledValue, setUncontrolledValue] = useState(rootProps.defaultValue ?? '')
    const currentValue = rootProps.value ?? uncontrolledValue
    const index = options.findIndex((option) => option.value === currentValue)
    const shown = currentValue ? (options[index]?.label ?? '') : placeholder
    const count = options[index]?.count
    const [previousIndex, setPreviousIndex] = useState(index)
    const [direction, setDirection] = useState(1)
    if (previousIndex !== index) {
        setPreviousIndex(index)
        setDirection(index > previousIndex ? 1 : -1)
    }

    return (
        <div className={styles.field}>
            {label && <label htmlFor={controlId}>{label}</label>}
            <SelectPrimitive.Root
                {...rootProps}
                disabled={disabled}
                onValueChange={(next) => {
                    setUncontrolledValue(next)
                    onValueChange?.(next)
                }}
            >
                <SelectPrimitive.Trigger
                    ref={ref}
                    id={controlId}
                    aria-labelledby={rootProps['aria-labelledby']}
                    aria-label={rootProps['aria-label']}
                    aria-describedby={hintId}
                    className={[styles.trigger, className].filter(Boolean).join(' ')}
                    data-variant={variant}
                >
                    {/* Radix keeps the real value for assistive tech; the visible copy below animates between values. */}
                    <span className={styles.srOnly}>
                        <SelectPrimitive.Value placeholder={placeholder} />
                    </span>
                    <span className={styles.valueText} aria-hidden="true">
                        <AnimatePresence initial={false} custom={direction}>
                            <motion.span
                                key={currentValue ? `value-${currentValue}` : 'placeholder'}
                                data-placeholder={currentValue ? undefined : ''}
                                custom={direction}
                                variants={reduceMotion ? valueFade : valueRoll}
                                initial="enter"
                                animate="center"
                                exit="exit"
                            >
                                <span className={styles.optionLabel}>{shown}</span>
                                {count !== undefined && <span className={styles.count}>{count}</span>}
                            </motion.span>
                        </AnimatePresence>
                    </span>
                    <SelectPrimitive.Icon className={styles.chevron}>
                        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                    </SelectPrimitive.Icon>
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal>
                    <SelectPrimitive.Content
                        className={styles.content}
                        position="popper"
                        sideOffset={4}
                        collisionPadding={12}
                        style={
                            contentMinWidth === undefined
                                ? undefined
                                : { minWidth: `max(var(--radix-select-trigger-width), ${contentMinWidth}px)` }
                        }
                    >
                        <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
                            <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
                        </SelectPrimitive.ScrollUpButton>
                        <SelectPrimitive.Viewport className={styles.viewport}>
                            {options.map((option) => (
                                <SelectPrimitive.Item
                                    key={option.value}
                                    value={option.value}
                                    disabled={option.disabled}
                                    className={styles.item}
                                >
                                    <SelectPrimitive.ItemText>
                                        {option.label}
                                        {option.count === undefined ? '' : ` ${option.count}`}
                                    </SelectPrimitive.ItemText>
                                    <SelectPrimitive.ItemIndicator className={styles.indicator}>
                                        <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                                    </SelectPrimitive.ItemIndicator>
                                </SelectPrimitive.Item>
                            ))}
                        </SelectPrimitive.Viewport>
                        <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
                            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                        </SelectPrimitive.ScrollDownButton>
                    </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
            </SelectPrimitive.Root>
            {description && (
                <span id={hintId} className={styles.hint}>
                    {description}
                </span>
            )}
        </div>
    )
}
export const Select = forwardRef<HTMLButtonElement, SelectProps>(SelectRender)
