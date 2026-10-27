'use client'

import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { InputHTMLAttributes, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, ReactElement } from 'react'
import { motionTokens } from '../motion-tokens'
import styles from './combobox.module.css'
import { ScrollArea } from '../scroll-area/scroll-area'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../popover/popover'

export interface ComboboxOption {
    value: string
    label: string
    disabled?: boolean
    keywords?: string[]
}
export interface ComboboxTreeContext {
    id: string
    query: string
    selected: string
    select: (value: string) => void
    close: () => void
}

export interface ComboboxProps extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'onChange' | 'placeholder'
> {
    label: string
    options: ComboboxOption[]
    /** Open a single menu with search in its header from a toolbar button. */
    trigger?: ReactElement
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
    /** Observe the search text for remote results in the same popup. */
    onQueryChange?: (query: string) => void
    description?: string
    placeholder?: string
    emptyMessage?: string
    className?: string
    /** Compact, borderless field for a compound control such as a connection morph. */
    variant?: 'surface' | 'inline'
    hideLabel?: boolean
    renderTree?: (context: ComboboxTreeContext) => ReactNode
}

/** Follows the listbox height with a critically damped spring, so filtering never snaps the menu. */
function AutoHeight({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean | null }) {
    const innerRef = useRef<HTMLDivElement>(null)
    const [height, setHeight] = useState<number | 'auto'>('auto')
    useEffect(() => {
        const inner = innerRef.current
        if (!inner) return
        const observer = new ResizeObserver(() => setHeight(inner.offsetHeight))
        observer.observe(inner)
        return () => observer.disconnect()
    }, [])
    return (
        <motion.div
            className={styles.autoHeight}
            initial={false}
            animate={{ height }}
            transition={reduceMotion ? { duration: 0 } : motionTokens.spring.smooth}
        >
            <div ref={innerRef}>{children}</div>
        </motion.div>
    )
}

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
    {
        label,
        options,
        value: controlledValue,
        defaultValue = '',
        onValueChange,
        onQueryChange,
        description,
        placeholder = 'Search or select…',
        emptyMessage = 'No matches found',
        id,
        className,
        variant = 'surface',
        hideLabel = false,
        renderTree,
        trigger,
        disabled,
        onFocus,
        ...inputProps
    },
    forwardedRef
) {
    const generatedId = useId()
    const controlId = id ?? generatedId
    const listboxId = `${controlId}-listbox`
    const hintId = description ? `${controlId}-description` : undefined
    const rootRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const tabbedAway = useRef(false)
    const restoringFocus = useRef(false)
    const optionRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const optionsViewport = useRef<HTMLDivElement>(null)
    const reduceMotion = useReducedMotion()
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue)
    const [open, setOpen] = useState(false)
    const [keyboardMenu, setKeyboardMenu] = useState(true)
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(-1)
    const updateQuery = (next: string) => {
        setQuery(next)
        onQueryChange?.(next)
    }
    const selectedValue = controlledValue ?? uncontrolledValue
    const selectedOption = options.find((option) => option.value === selectedValue)

    useImperativeHandle(forwardedRef, () => inputRef.current!)

    // A chosen label settles into the field: it rises in from below with a soft blur. Clearing fades the
    // placeholder in instead of snapping from the old label.
    const settledValue = useRef(selectedValue)
    useEffect(() => {
        if (settledValue.current === selectedValue) return
        settledValue.current = selectedValue
        const input = inputRef.current
        if (trigger || !input || reduceMotion || keyboardMenu || variant === 'inline' || (selectedValue && open)) return
        const controls = selectedValue
            ? animate(
                  input,
                  { opacity: [0, 1], y: ['0.35em', '0em'], filter: [`blur(${motionTokens.blur.soft}px)`, 'blur(0px)'] },
                  { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }
              )
            : animate(
                  input,
                  { opacity: [0, 1] },
                  { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }
              )
        return () => controls.complete()
    }, [selectedValue, reduceMotion, open, keyboardMenu, variant, trigger])

    const filteredOptions = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase()
        if (!normalizedQuery) return options
        return options.filter((option) =>
            [option.label, ...(option.keywords ?? [])].some((term) =>
                term.toLocaleLowerCase().includes(normalizedQuery)
            )
        )
    }, [options, query])

    const enabledIndices = filteredOptions.reduce<number[]>((indices, option, index) => {
        if (!option.disabled) indices.push(index)
        return indices
    }, [])

    useEffect(() => {
        if (!open) return
        const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined
        const option = activeOption ? optionRefs.current[activeOption.value] : null
        const listbox = optionsViewport.current
        if (option && listbox) {
            const top = option.getBoundingClientRect().top - listbox.getBoundingClientRect().top + listbox.scrollTop
            const bottom = top + option.offsetHeight
            if (top < listbox.scrollTop) listbox.scrollTop = top
            else if (bottom > listbox.scrollTop + listbox.clientHeight)
                listbox.scrollTop = bottom - listbox.clientHeight
        }
    }, [activeIndex, filteredOptions, open])

    const choose = (option: ComboboxOption) => {
        if (option.disabled) return
        setUncontrolledValue(option.value)
        onValueChange?.(option.value)
        if (!trigger) updateQuery('')
        setOpen(false)
        restoringFocus.current = true
        if (trigger) triggerRef.current?.focus()
        else inputRef.current?.focus()
        restoringFocus.current = false
    }

    const clear = (event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        setUncontrolledValue('')
        onValueChange?.('')
        updateQuery('')
        setOpen(true)
        inputRef.current?.focus()
    }

    const openMenu = () => {
        if (disabled || open) return
        tabbedAway.current = false
        setOpen(true)
        updateQuery('')
        setActiveIndex(-1)
    }
    const closeTree = () => {
        setOpen(false)
        updateQuery('')
        restoringFocus.current = true
        if (!trigger) inputRef.current?.focus()
        restoringFocus.current = false
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return
        setKeyboardMenu(true)
        if (trigger && event.key === 'Tab' && open) {
            tabbedAway.current = true
            setOpen(false)
            triggerRef.current?.focus()
            return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (renderTree) {
                if (!open) openMenu()
                requestAnimationFrame(() =>
                    document
                        .getElementById(listboxId)
                        ?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
                        ?.focus()
                )
                return
            }
            if (!open) {
                openMenu()
                return
            }
            if (!enabledIndices.length) return
            const currentPosition = enabledIndices.indexOf(activeIndex)
            const nextPosition =
                event.key === 'ArrowDown'
                    ? (currentPosition + 1) % enabledIndices.length
                    : (currentPosition - 1 + enabledIndices.length) % enabledIndices.length
            setActiveIndex(enabledIndices[nextPosition])
            return
        }
        if (event.key === 'Enter' && open && activeIndex >= 0) {
            event.preventDefault()
            const option = filteredOptions[activeIndex]
            if (option) choose(option)
            return
        }
        if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            if (!trigger) updateQuery('')
            return
        }
    }

    const inputValue = trigger || open ? query : (selectedOption?.label ?? '')
    const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined
    const instantMenu = !!trigger || keyboardMenu || !!reduceMotion

    const searchControl = (
        <div
            className={[
                styles.control,
                trigger ? styles.menuSearch : '',
                variant === 'inline' ? styles.inline : '',
                open ? styles.open : '',
                disabled ? styles.disabled : '',
                !trigger ? (className ?? '') : ''
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <Search className={styles.searchIcon} size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
                {...inputProps}
                ref={inputRef}
                aria-label={trigger ? `Search ${label.toLowerCase()}` : inputProps['aria-label']}
                id={controlId}
                type="text"
                role="combobox"
                value={inputValue}
                // While searching, the chosen label stays in place as muted placeholder copy instead of vanishing.
                placeholder={trigger ? placeholder : (selectedOption?.label ?? placeholder)}
                disabled={disabled}
                aria-describedby={hintId}
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                aria-autocomplete="list"
                aria-haspopup={renderTree ? 'tree' : 'listbox'}
                aria-activedescendant={open && activeOption ? `${controlId}-option-${activeOption.value}` : undefined}
                onFocus={(event) => {
                    onFocus?.(event)
                    if (!trigger && !restoringFocus.current) openMenu()
                }}
                onClick={openMenu}
                onPointerDown={() => setKeyboardMenu(false)}
                onChange={(event) => {
                    updateQuery(event.target.value)
                    setOpen(true)
                    setActiveIndex(-1)
                }}
                onKeyDown={handleKeyDown}
            />
            <AnimatePresence initial={false}>
                {!trigger && selectedOption && !disabled && !renderTree && (
                    <motion.button
                        type="button"
                        className={styles.clear}
                        aria-label="Clear selection"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={clear}
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.95)' }}
                        animate={{
                            opacity: 1,
                            transform: 'scale(1)',
                            transition: reduceMotion
                                ? { duration: motionTokens.duration.instant }
                                : {
                                      ...motionTokens.spring.snappy,
                                      opacity: { duration: motionTokens.duration.fast }
                                  }
                        }}
                        exit={{
                            opacity: 0,
                            ...(reduceMotion ? {} : { transform: 'scale(0.95)' }),
                            transition: {
                                duration: motionTokens.duration.instant,
                                ease: [...motionTokens.ease.standard]
                            }
                        }}
                        whileTap={{
                            transform: reduceMotion ? 'scale(1)' : 'scale(0.97)',
                            transition: {
                                duration: motionTokens.duration.instant,
                                ease: [...motionTokens.ease.standard]
                            }
                        }}
                    >
                        <X size={16} strokeWidth={1.75} aria-hidden="true" />
                    </motion.button>
                )}
            </AnimatePresence>
            {!trigger && <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden="true" />}
        </div>
    )

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next)
                if (!next && !trigger) updateQuery('')
                else if (next && trigger) {
                    tabbedAway.current = false
                    updateQuery('')
                    setActiveIndex(options.findIndex((option) => option.value === selectedValue))
                }
            }}
        >
            <div
                ref={rootRef}
                className={[styles.field, trigger ? className : ''].filter(Boolean).join(' ')}
                data-open={open || undefined}
            >
                <label htmlFor={controlId} className={hideLabel ? styles.srOnly : undefined}>
                    {label}
                </label>
                {trigger ? (
                    <PopoverTrigger
                        asChild
                        ref={triggerRef}
                        disabled={disabled}
                        aria-label={label}
                        onPointerDown={() => setKeyboardMenu(false)}
                        onKeyDown={(event) => {
                            setKeyboardMenu(true)
                            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                event.preventDefault()
                                openMenu()
                            }
                        }}
                    >
                        {trigger}
                    </PopoverTrigger>
                ) : (
                    <PopoverAnchor asChild>{searchControl}</PopoverAnchor>
                )}
                {description && (
                    <span id={hintId} className={styles.hint}>
                        {description}
                    </span>
                )}
                <AnimatePresence initial={false}>
                    {open && (
                        <PopoverContent
                            asChild
                            forceMount
                            role={trigger ? 'dialog' : 'presentation'}
                            aria-label={trigger ? label : undefined}
                            align={trigger ? 'end' : 'start'}
                            onOpenAutoFocus={(event) => {
                                event.preventDefault()
                                if (trigger) inputRef.current?.focus()
                            }}
                            onCloseAutoFocus={(event) => {
                                if (!trigger || tabbedAway.current) event.preventDefault()
                                tabbedAway.current = false
                            }}
                            onEscapeKeyDown={(event) => {
                                setKeyboardMenu(true)
                                event.stopPropagation()
                            }}
                            onInteractOutside={(event) => {
                                if (event.target instanceof Node && rootRef.current?.contains(event.target))
                                    event.preventDefault()
                            }}
                        >
                            <motion.div
                                className={[
                                    styles.popover,
                                    trigger ? styles.triggerPopover : '',
                                    variant === 'inline' ? styles.inlinePopover : ''
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                initial={instantMenu ? false : { opacity: 0, transform: 'scale(0.97)' }}
                                animate={{
                                    opacity: 1,
                                    transform: 'scale(1)',
                                    transition: {
                                        duration: instantMenu ? 0 : motionTokens.duration.fast,
                                        ease: [...motionTokens.ease.enter]
                                    }
                                }}
                                exit={{
                                    opacity: 0,
                                    ...(instantMenu ? {} : { transform: 'scale(0.97)' }),
                                    transition: {
                                        duration: instantMenu ? 0 : motionTokens.duration.instant,
                                        ease: [...motionTokens.ease.standard]
                                    }
                                }}
                                role={trigger ? 'dialog' : 'presentation'}
                                aria-label={trigger ? label : undefined}
                                data-instant={instantMenu || undefined}
                            >
                                {trigger && searchControl}
                                <AutoHeight reduceMotion={instantMenu}>
                                    <ScrollArea
                                        maxHeight={
                                            trigger
                                                ? 'min(300px, 40dvh, calc(var(--radix-popover-content-available-height) - 64px))'
                                                : 'min(300px, 40dvh, calc(var(--radix-popover-content-available-height) - 12px))'
                                        }
                                        viewportRef={optionsViewport}
                                        viewportStyle={trigger ? { overscrollBehavior: 'contain' } : undefined}
                                        fade={8}
                                        label={`${label} options`}
                                    >
                                        {renderTree ? (
                                            renderTree({
                                                id: listboxId,
                                                query,
                                                selected: selectedValue,
                                                close: closeTree,
                                                select: (value) => {
                                                    const option = options.find((option) => option.value === value)
                                                    if (option) choose(option)
                                                }
                                            })
                                        ) : (
                                            <div
                                                id={listboxId}
                                                className={styles.listbox}
                                                role="listbox"
                                                aria-label={`${label} options`}
                                            >
                                                {filteredOptions.length ? (
                                                    filteredOptions.map((option, index) => (
                                                        <div
                                                            key={option.value}
                                                            ref={(element) => {
                                                                optionRefs.current[option.value] = element
                                                            }}
                                                            id={`${controlId}-option-${option.value}`}
                                                            className={styles.option}
                                                            data-active={index === activeIndex ? 'true' : undefined}
                                                            data-disabled={option.disabled ? 'true' : undefined}
                                                            role="option"
                                                            title={option.label}
                                                            tabIndex={-1}
                                                            aria-selected={option.value === selectedValue}
                                                            aria-disabled={option.disabled || undefined}
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onMouseEnter={() =>
                                                                !option.disabled && setActiveIndex(index)
                                                            }
                                                            onClick={() => choose(option)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault()
                                                                    choose(option)
                                                                }
                                                            }}
                                                        >
                                                            <span>{option.label}</span>
                                                            {option.value === selectedValue && (
                                                                <Check
                                                                    className={styles.check}
                                                                    size={16}
                                                                    strokeWidth={1.75}
                                                                    aria-hidden="true"
                                                                />
                                                            )}
                                                        </div>
                                                    ))
                                                ) : (
                                                    <motion.div
                                                        className={styles.empty}
                                                        role="status"
                                                        initial={
                                                            instantMenu
                                                                ? false
                                                                : {
                                                                      opacity: 0,
                                                                      transform: 'translateY(4px)'
                                                                  }
                                                        }
                                                        animate={{ opacity: 1, transform: 'translateY(0)' }}
                                                        transition={{
                                                            duration: motionTokens.duration.standard,
                                                            ease: [...motionTokens.ease.enter]
                                                        }}
                                                    >
                                                        {emptyMessage}
                                                    </motion.div>
                                                )}
                                            </div>
                                        )}
                                    </ScrollArea>
                                </AutoHeight>
                            </motion.div>
                        </PopoverContent>
                    )}
                </AnimatePresence>
            </div>
        </Popover>
    )
})

Combobox.displayName = 'Combobox'
